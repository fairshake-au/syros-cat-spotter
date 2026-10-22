import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { catsTable, db, photosTable, photoVisibilityEventsTable, pool, sightingsTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { formatSmoke, makeReadOnly, runSmokeCheck, smokePassesAt } from "./smokeCheck";
import type { Embedder } from "./embedders";

// SYC-527 piece 3, Task 4: the smoke check against the shared local test
// database. Only this run's rows are asserted on: every cat is named with
// PREFIX and the check's "active cats" are narrowed to those by the seam
// (opts.onlyCats). The models are replaced by a colour embedder, so no model
// is loaded here; the real DINOv2 path is covered in datasetCheck.test.ts.

const PREFIX = `vt-acc-${randomBytes(3).toString("hex")}-`;
const DEVICE = `${PREFIX}device`;
type Pool = typeof pool;
const WriterPool = pool.constructor as new (o: { connectionString: string }) => Pool;
const writer = new WriterPool({ connectionString: process.env["DATABASE_URL"]! });

/** Colour in, direction out: the stand-in model. Photos of nearly the same colour are close. */
const colourModel: Embedder = {
  name: "dinov2-small-q8",
  async embed(jpeg) {
    const { channels } = await sharp(jpeg).stats();
    const v = Float32Array.from([channels[0]!.mean - 128, channels[1]!.mean - 128, channels[2]!.mean - 128]);
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  },
};

const RED = "#e01010";
const GREEN = "#10e010";
const BLUE = "#1010e0";
const YELLOW = "#e0e010";
const CYAN = "#10e0e0";
const MAGENTA = "#e010e0";
const shade = (c: string) => `#${[1, 3, 5].map((i) => Math.min(255, parseInt(c.slice(i, i + 2), 16) + 12).toString(16).padStart(2, "0")).join("")}`;

let n = 0;
async function photo(colour: string, at: string): Promise<{ id: number; publicId: string }> {
  const data = (await sharp({ create: { width: 96, height: 96, channels: 3, background: colour } }).jpeg().toBuffer()).toString("base64");
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}p${n++}`, data, mime: "image/jpeg", createdAt: new Date(at) })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  return p!;
}

async function cat(key: string, displayPhotoId: number): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${PREFIX}${key}`, primaryPhotoId: displayPhotoId, lat: 37.4447, lng: 24.9417, discovererDeviceId: DEVICE })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function sighting(catId: number, photoId: number, status = "resolved") {
  await db.insert(sightingsTable).values({ catId, deviceId: DEVICE, photoId, lat: 37.4447, lng: 24.9417, status });
}

const DAY1 = "2026-10-01T10:00:00Z";
const DAY2 = "2026-10-03T10:00:00Z";
const ids: string[] = []; // every seeded public id and cat id, to prove none is printed
let hiddenPhoto: { id: number; publicId: string };

/** A cat with a display photo of `colour` on DAY1 and a second, resolved photo of `second` on `secondAt`. */
async function pair(key: string, colour: string, second: string, secondAt: string, status = "resolved") {
  const d = await photo(colour, DAY1);
  const q = await photo(second, secondAt);
  const id = await cat(key, d.id);
  await sighting(id, q.id, status);
  ids.push(String(id), d.publicId, q.publicId);
  return { id, d, q };
}

beforeAll(async () => {
  await pair("red", RED, shade(RED), DAY2);
  await pair("green", GREEN, shade(GREEN), DAY2);
  await pair("blue", BLUE, shade(BLUE), DAY2);
  // Looks like blue, not like its own display photo: the right cat is not first.
  await pair("yellow", YELLOW, shade(BLUE), DAY2);
  // Never a pair:
  await pair("same-day", CYAN, shade(CYAN), "2026-10-01T15:00:00Z");
  await pair("pending", MAGENTA, shade(MAGENTA), DAY2, "pending");
  const h = await pair("hidden", "#808080", shade("#808080"), DAY2);
  hiddenPhoto = h.q;
  await db.insert(photoVisibilityEventsTable).values({ photoId: h.q.id, action: "hide", author: `report:${PREFIX}h` });
  // A cat with only its display photo.
  const solo = await photo("#404040", DAY1);
  ids.push(String(await cat("solo", solo.id)), solo.publicId);
});

afterAll(async () => {
  const c = await writer.connect();
  try {
    await c.query("begin");
    await c.query("alter table sightings disable trigger sightings_append_only");
    await c.query("delete from sightings where device_id like $1", [`${PREFIX}%`]);
    await c.query("alter table sightings enable trigger sightings_append_only");
    await c.query("commit");
    await c.query("delete from cats where name like $1", [`${PREFIX}%`]);
    // A photo with a visibility event stays: those events are add-only.
    await c.query(
      "delete from photos where public_id like $1 and not exists (select 1 from photo_visibility_events e where e.photo_id = photos.id)",
      [`${PREFIX}%`],
    );
  } finally {
    c.release();
    await writer.end();
  }
});

const own = { onlyCats: (c: { name: string }) => c.name.startsWith(PREFIX) };

/** The check as the script runs it: over a read-only session (undone after, because the test harness writes to the same pool). */
async function readOnly<T>(run: () => Promise<T>): Promise<T> {
  const undo = await makeReadOnly(pool);
  try {
    return await run();
  } finally {
    await undo();
  }
}
const check = (models: Embedder[], o: Parameters<typeof runSmokeCheck>[1] = own) => readOnly(() => runSmokeCheck(models, o));

describe("the smoke check", () => {
  it("finds exactly the real pairs and ranks the right cat", async () => {
    const r = await check([colourModel]);
    // 8 cats have a display photo; 4 have a second confirmed, visible photo from another Athens day.
    expect(r.galleryCats).toBe(8);
    expect(r.pairs).toHaveLength(4);
    const ranks = r.pairs.map((p) => p.rank["dinov2-small-q8"]!).sort((a, b) => a - b);
    expect(ranks.slice(0, 3)).toEqual([1, 1, 1]);
    expect(ranks[3]).toBeGreaterThan(1);
    expect(smokePassesAt(r, "dinov2-small-q8", 20)).toBe(true);
    expect(r.pairs.map((p) => p.index)).toEqual([1, 2, 3, 4]);
    for (const p of r.pairs) expect(typeof p.mostlyOneArea["dinov2-small-q8"]).toBe("boolean");
  });

  it("counts Athens days, not UTC days", async () => {
    // Display photo made 23:30 on 1 Oct in Athens (UTC+3), second at 00:30 on 2 Oct: different Athens days, same UTC day.
    const a = await photo("#c0a010", "2026-10-01T20:30:00Z");
    const idA = await cat("athens-split", a.id);
    await sighting(idA, (await photo(shade("#c0a010"), "2026-10-01T21:30:00Z")).id);
    // Different UTC days (1 Oct 22:30Z and 2 Oct 01:00Z) but the same Athens day (2 Oct 01:30 and 04:00).
    const b = await photo("#10a0c0", "2026-10-01T22:30:00Z");
    const idB = await cat("athens-same", b.id);
    await sighting(idB, (await photo(shade("#10a0c0"), "2026-10-02T01:00:00Z")).id);
    const r = await check([colourModel]);
    expect(r.pairs).toHaveLength(5); // the four, plus athens-split only
  });

  it("prints ranks and counts only: no id, public id, name or prefix", async () => {
    const r = await check([colourModel]);
    const text = formatSmoke(r, ["dinov2-small-q8"]).join("\n");
    expect(text).toContain("pair 1: dinov2-small-q8 rank");
    expect(text).toContain("smoke");
    expect(text).not.toContain(PREFIX);
    expect(text).not.toContain(hiddenPhoto.publicId);
    for (const secret of ids) expect(text.includes(secret) && secret.length > 6).toBe(false);
    // No long numbers (ids, positions, vectors); ranks and counts are short.
    expect(text).not.toMatch(/\d{4,}/);
  });

  it("writes nothing: no photo version is saved", async () => {
    const before = await writer.query("select count(*)::int as n from photo_variants");
    await check([colourModel]);
    const after = await writer.query("select count(*)::int as n from photo_variants");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("with no pairs says so rather than pass", async () => {
    const r = await check([colourModel], { onlyCats: () => false });
    expect(r).toEqual({ galleryCats: 0, pairs: [] });
    expect(formatSmoke(r, ["dinov2-small-q8"]).join("\n")).toContain("cannot pass or fail");
    expect(smokePassesAt(r, "dinov2-small-q8", 10)).toBe(false);
  });
});

describe("removed photos", () => {
  it("a removed display photo is never read: the check refuses rather than use it", async () => {
    // jpegOf selects removed_at is null and data is not null; a row failing that gives no bytes.
    const src = (await import("node:fs")).readFileSync(new URL("./smokeCheck.ts", import.meta.url), "utf8");
    expect(src).toMatch(/isNull\(photosTable\.removedAt\), isNotNull\(photosTable\.data\)/);
  });
});

describe("the read-only connection", () => {
  it("refuses an INSERT, UPDATE or DELETE through the script's own connection", async () => {
    await readOnly(async () => {
      await expect(pool.query("insert into photos (public_id, data, mime) values ($1, 'x', 'image/jpeg')", [`${PREFIX}nope`])).rejects.toThrow(/read-only/i);
      await expect(db.insert(photosTable).values({ publicId: `${PREFIX}nope2`, data: "x" })).rejects.toThrow();
      await expect(db.update(catsTable).set({ name: "x" }).where(eq(catsTable.name, `${PREFIX}red`))).rejects.toThrow();
      await expect(db.delete(catsTable).where(eq(catsTable.name, `${PREFIX}red`))).rejects.toThrow();
    });
    const left = await writer.query("select count(*)::int as n from photos where public_id like $1", [`${PREFIX}nope%`]);
    expect(left.rows[0].n).toBe(0);
    const red = await writer.query("select count(*)::int as n from cats where name = $1", [`${PREFIX}red`]);
    expect(red.rows[0].n).toBe(1);
  });

  it("narrows the pool to one connection: those open before are closed, and every query runs read-only on it", async () => {
    // Open several connections first, then switch on.
    const held = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    held.forEach((c) => c.release());
    await readOnly(async () => {
      expect(pool.totalCount).toBe(1);
      expect(pool.options.max).toBe(1);
      // Several queries at once queue on the one connection; each sees read-only.
      const answers = await Promise.all([1, 2, 3, 4].map(() => pool.query("show transaction_read_only")));
      for (const a of answers) expect(a.rows[0].transaction_read_only).toBe("on");
      expect(pool.totalCount).toBe(1);
    });
  });

  it("a second query on the connection is read-only too: the write fails after a read has run", async () => {
    await readOnly(async () => {
      expect((await pool.query("show transaction_read_only")).rows[0].transaction_read_only).toBe("on");
      await expect(pool.query("insert into photos (public_id, data, mime) values ($1, 'x', 'image/jpeg')", [`${PREFIX}nope3`])).rejects.toThrow(/read-only/i);
      expect((await pool.query("show transaction_read_only")).rows[0].transaction_read_only).toBe("on");
      await expect(pool.query("update cats set name = name where name = $1", [`${PREFIX}red`])).rejects.toThrow(/read-only/i);
    });
    const left = await writer.query("select count(*)::int as n from photos where public_id like $1", [`${PREFIX}nope%`]);
    expect(left.rows[0].n).toBe(0);
  });

  it("refuses to run when the session cannot be proven read-only, and when a connection is in use", async () => {
    const busy = await pool.connect();
    try {
      await expect(makeReadOnly(pool)).rejects.toThrow(/in use/);
    } finally {
      busy.release();
    }
    const fake = {
      options: { max: 10, idleTimeoutMillis: 10_000 },
      totalCount: 0,
      idleCount: 0,
      on: () => undefined,
      off: () => undefined,
      connect: async () => ({
        query: async (q: string) => (q.startsWith("SHOW") ? { rows: [{ transaction_read_only: "off" }] } : {}),
        release: () => undefined,
      }),
    } as unknown as typeof pool;
    await expect(makeReadOnly(fake)).rejects.toThrow(/not read-only/);
  });

  it("reads still work", async () => {
    await readOnly(async () => {
      const rows = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
      expect(rows.length).toBeGreaterThan(5);
    });
  });
});
