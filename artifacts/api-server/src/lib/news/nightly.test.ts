/**
 * SYC-45 Slice 1: the nightly news check, against a real database
 * (docs/superpowers/plans/syc-344-email-capture.md, PR 1.1, tests T1-1 to
 * T1-13; each has a mutation probe in the plan's probe table).
 *
 * The check walks every followed cat in the database, including other test
 * files' cats, so every assertion is about this file's own cats, and every
 * test starts with a run that settles whatever is already there. A run is
 * once per Athens night, so `fresh()` forgets the claimed nights first (the
 * runs table is the check's own; T1-9 tests the claiming itself).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));
vi.mock("../logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import {
  catNewsBaselineTable,
  catNewsChangesTable,
  catNewsRunsTable,
  catSubscriptionsTable,
  catsTable,
  db,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import app from "../../app";
import { writeObservation } from "../observations";
import { deriveCatStatuses } from "../catHelpers";
import { resolveCat } from "../resolve";
import { loadCatRecords } from "../observations";
import { BULK_LIMIT, addCalendarMonths, runNightlyNewsCheck, seedNewsBaseline } from "./nightly";

const PREFIX = "VitestNews";
const DEVICE = "vitest-news-follower";
const TOKEN = "vitest-news-job-token-0123456789abcdef";
const DAY = 86_400_000;
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;
const myCats: number[] = [];

async function photo(): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  return p!.id;
}

/** A followed cat (so the check walks it). */
async function cat(opts: { createdAt?: Date; ownerDeviceId?: string; follow?: boolean } = {}): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: await photo(),
      lat: 37.4448,
      lng: 24.9425,
      discovererDeviceId: "vitest-news-seed",
      ownerDeviceId: opts.ownerDeviceId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  myCats.push(c!.id);
  if (opts.follow !== false) await db.insert(catSubscriptionsTable).values({ deviceId: DEVICE, catId: c!.id });
  return c!.id;
}

async function sighting(catId: number, at: Date, deviceId = "vitest-news-spotter"): Promise<number> {
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId, deviceId, photoId: await photo(), lat: 37.4448, lng: 24.9425, status: "resolved", createdAt: at })
    .returning();
  return s!.id;
}

function staff(catId: number, kind: "sterilised" | "life_status", value: unknown, opts: { observedAt?: Date; provenance?: string } = {}) {
  return writeObservation(db, {
    catId,
    kind,
    value,
    accountId: "staff-vitest-news",
    roleAtTime: "staff",
    observedAt: opts.observedAt ?? new Date(),
    ...(opts.provenance ? { provenance: opts.provenance } : {}),
  });
}
const sterilised = (catId: number, yes: boolean, opts?: { observedAt?: Date; provenance?: string }) =>
  staff(catId, "sterilised", { sterilised: yes }, opts);
const life = (catId: number, status: string, opts?: { observedAt?: Date; provenance?: string }) =>
  staff(catId, "life_status", { status }, opts);

/** Tonight's check, with any claimed night forgotten first. */
async function fresh(now?: Date) {
  await db.delete(catNewsRunsTable);
  const r = await runNightlyNewsCheck(now ? { now } : {});
  expect(r.status).toBe("ran");
  return r as Extract<typeof r, { status: "ran" }>;
}

async function changesFor(catIds: number[]) {
  if (catIds.length === 0) return [];
  return db.select().from(catNewsChangesTable).where(inArray(catNewsChangesTable.catId, catIds));
}

async function baselineOf(catId: number) {
  const [b] = await db.select().from(catNewsBaselineTable).where(eq(catNewsBaselineTable.catId, catId));
  return b;
}

beforeAll(async () => {
  process.env["NEWS_JOB_TOKEN"] = TOKEN;
  await fresh();
});

beforeEach(() => {
  spies.logLines.length = 0;
});

afterAll(async () => {
  delete process.env["NEWS_JOB_TOKEN"];
  if (myCats.length) {
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, myCats));
    await db.delete(catNewsChangesTable).where(inArray(catNewsChangesTable.catId, myCats));
    await db.delete(catNewsBaselineTable).where(inArray(catNewsBaselineTable.catId, myCats));
  }
  await db.delete(catNewsRunsTable);
  await pool.end();
});

describe("T1-1: confirmed sterilised is news; likely is not", () => {
  it("confirmed → one sterilised change, watched, with its evidence", async () => {
    const id = await cat();
    await fresh();
    const obs = await sterilised(id, true);
    await fresh();
    const rows = await changesFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "sterilised", state: "watched", silencedReason: null });
    expect(rows[0]!.evidenceIds).toContain(obs.id);
  });

  it("likely (a photographed clipped tip) → nothing", async () => {
    const id = await cat();
    await fresh();
    await writeObservation(db, {
      catId: id,
      kind: "ear_tip",
      value: { clipped: true },
      deviceId: "vitest-news-spotter",
      roleAtTime: "public",
      photoId: await photo(),
      observedAt: new Date(),
    });
    await fresh();
    const records = await loadCatRecords([id]);
    const snap = resolveCat(records.get(id)!.observations, records.get(id)!.evidenceOfLife, new Date());
    expect(snap.sterilised).toMatchObject({ value: true, confidence: "likely" });
    expect(await changesFor([id])).toHaveLength(0);
  });
});

describe("T1-2: a death, presumed death or confirmed not-sterilised is never a news row (F4)", () => {
  it("becoming deceased → no row", async () => {
    const id = await cat();
    await fresh();
    await life(id, "deceased");
    await fresh();
    expect(await changesFor([id])).toHaveLength(0);
    expect((await baselineOf(id))!.lifeStatus).toBe("deceased");
  });

  it("confirmed not sterilised → no row", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, false);
    await fresh();
    expect(await changesFor([id])).toHaveLength(0);
  });

  it("becoming presumed dead (no sign of life in 36 months) → no row", async () => {
    // Last sign of life 35 months ago: alive tonight, presumed dead in two months.
    const id = await cat({ createdAt: new Date(Date.now() - 35 * 30.5 * DAY) });
    await fresh();
    await fresh(new Date(Date.now() + 62 * DAY));
    const records = await loadCatRecords([id]);
    const later = resolveCat(records.get(id)!.observations, records.get(id)!.evidenceOfLife, new Date(Date.now() + 62 * DAY));
    expect(later.presumedDeceased).toBe(true);
    expect(await changesFor([id])).toHaveLength(0);
  });
});

describe("T1-2b: good news about a dead or presumed-dead cat is silenced 'deceased'", () => {
  it("sterilisation confirmed on a cat recorded as dead", async () => {
    const id = await cat();
    await life(id, "deceased", { observedAt: new Date(Date.now() - 2 * DAY) });
    await fresh();
    await sterilised(id, true);
    await fresh();
    const rows = await changesFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "sterilised", state: "silenced", silencedReason: "deceased" });
    expect(rows[0]!.causedByDevices).toBeNull();
  });

  it("sterilisation confirmed on a cat presumed dead", async () => {
    const id = await cat({ createdAt: new Date(Date.now() - 4 * 365 * DAY) });
    await fresh();
    // An operation four years ago: not a sign of life since, so still presumed dead.
    await sterilised(id, true, { observedAt: new Date(Date.now() - 4 * 365 * DAY + DAY) });
    await fresh();
    const rows = await changesFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "sterilised", state: "silenced", silencedReason: "deceased" });
  });

  it("homed on a cat presumed dead (a home recorded four years ago, nothing since)", async () => {
    const id = await cat({ createdAt: new Date(Date.now() - 4 * 365 * DAY) });
    await fresh();
    await life(id, "homed", { observedAt: new Date(Date.now() - 4 * 365 * DAY + DAY) });
    await fresh();
    const records = await loadCatRecords([id]);
    const snap = resolveCat(records.get(id)!.observations, records.get(id)!.evidenceOfLife, new Date());
    expect(snap).toMatchObject({ lifeStatus: "homed", presumedDeceased: true });
    const rows = await changesFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "homed", state: "silenced", silencedReason: "deceased" });
  });

  it("seen again after a long gap, on a cat recorded as dead and not cleared", async () => {
    // A dead cat's sighting before the death statement doesn't clear it.
    const id = await cat();
    await sighting(id, new Date("2025-01-10T12:00:00Z"));
    await fresh();
    await sighting(id, new Date("2025-06-10T12:00:00Z"));
    await life(id, "deceased", { observedAt: new Date("2025-07-01T12:00:00Z") });
    await fresh();
    const rows = await changesFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "seen_again", state: "silenced", silencedReason: "deceased" });
  });
});

describe("T1-3: homed is news; seen again after four calendar months or more", () => {
  it("homed → one homed change", async () => {
    const id = await cat();
    await fresh();
    const obs = await life(id, "homed");
    await fresh();
    const rows = await changesFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "homed", state: "watched" });
    expect(rows[0]!.evidenceIds).toEqual([obs.id]);
  });

  async function gap(second: string) {
    const id = await cat();
    await sighting(id, new Date("2026-01-15T12:00:00Z"));
    await fresh();
    const s = await sighting(id, new Date(second), "vitest-news-respotter");
    await fresh();
    return { rows: await changesFor([id]), sightingId: s };
  }

  it("exactly four months apart → seen_again, caused by the spotter", async () => {
    const { rows, sightingId } = await gap("2026-05-15T12:00:00Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ change: "seen_again", state: "watched", evidenceIds: [sightingId] });
    expect(rows[0]!.causedByDevices).toEqual(["vitest-news-respotter"]);
  });

  it("one day short → nothing", async () => {
    expect((await gap("2026-05-14T12:00:00Z")).rows).toHaveLength(0);
  });

  it("one day over → seen_again", async () => {
    const { rows } = await gap("2026-05-16T12:00:00Z");
    expect(rows.map((r) => r.change)).toEqual(["seen_again"]);
  });

  it("calendar months clamp to the month's end", () => {
    expect(addCalendarMonths("2026-10-31", 4)).toBe("2027-02-28");
    expect(addCalendarMonths("2027-10-31", 4)).toBe("2028-02-29");
    expect(addCalendarMonths("2026-01-15", 4)).toBe("2026-05-15");
  });
});

describe("T1-3b: the gap is between sightings, not since the baseline was last walked", () => {
  it("a cat sighted every week, not walked for six months → no seen_again", async () => {
    const start = Date.now() - 190 * DAY;
    const id = await cat();
    await sighting(id, new Date(start));
    await fresh();
    // As if the check hadn't walked this cat for six months.
    await db
      .update(catNewsBaselineTable)
      .set({ updatedAt: new Date(start) })
      .where(eq(catNewsBaselineTable.catId, id));
    for (let t = start + 7 * DAY; t < Date.now() - DAY; t += 7 * DAY) await sighting(id, new Date(t));
    await fresh();
    expect(await changesFor([id])).toHaveLength(0);
  });
});

describe("T1-4: a change resting only on import or legacy observations is silenced", () => {
  it("import → silenced 'import'", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true, { provenance: "import" });
    await fresh();
    expect(await changesFor([id])).toMatchObject([{ change: "sterilised", state: "silenced", silencedReason: "import" }]);
  });

  it("legacy → silenced 'legacy'", async () => {
    const id = await cat();
    await fresh();
    await life(id, "homed", { provenance: "legacy" });
    await fresh();
    expect(await changesFor([id])).toMatchObject([{ change: "homed", state: "silenced", silencedReason: "legacy" }]);
  });

  it("import plus a volunteered statement → news", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true, { provenance: "import", observedAt: new Date(Date.now() - DAY) });
    await sterilised(id, true);
    await fresh();
    expect(await changesFor([id])).toMatchObject([{ change: "sterilised", state: "watched" }]);
  });
});

describe("T1-5: recorded more than 90 days after it was observed is old news", () => {
  it("91 days late → silenced 'old_news'", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true, { observedAt: new Date(Date.now() - 91 * DAY) });
    await fresh();
    expect(await changesFor([id])).toMatchObject([{ state: "silenced", silencedReason: "old_news" }]);
  });

  it("89 days late → news", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true, { observedAt: new Date(Date.now() - 89 * DAY) });
    await fresh();
    expect(await changesFor([id])).toMatchObject([{ state: "watched", silencedReason: null }]);
  });
});

describe("T1-6: first sight seeds the baseline and records nothing", () => {
  it("over 50 cats seen for the first time, all with good status → seeded, nothing send-able", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 55; i++) {
      const id = await cat();
      await sterilised(id, true);
      if (i % 2) await life(id, "homed");
      ids.push(id);
    }
    const r = await fresh();
    expect(r.silencedBulk).toBe(false);
    expect(await changesFor(ids)).toHaveLength(0);
    const seeded = await db.select().from(catNewsBaselineTable).where(inArray(catNewsBaselineTable.catId, ids));
    expect(seeded).toHaveLength(55);
    expect(seeded.every((b) => b.sterilisedConfirmed && b.notifiedSterilisedAt)).toBe(true);
  });
});

describe("T1-7: seedNewsBaseline records the status with no change", () => {
  it("a confirmation that lands with an import, seeded as it lands → no change, then or after", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true);
    const before = (await db.select({ n: sql<number>`count(*)::int` }).from(catNewsChangesTable))[0]!.n;
    expect(await seedNewsBaseline([id])).toBe(1);
    const after = (await db.select({ n: sql<number>`count(*)::int` }).from(catNewsChangesTable))[0]!.n;
    expect(after).toBe(before);
    expect((await baselineOf(id))!.sterilisedConfirmed).toBe(true);
    await fresh();
    expect(await changesFor([id])).toHaveLength(0);
  });
});

describe("T1-8: nothing that shows a cat's status reads cat_news_baseline (Risk 8)", () => {
  it("with the table gone, resolveCat, deriveCatStatuses and the cat page answer the same", async () => {
    const id = await cat();
    await sterilised(id, true);
    await fresh();
    const records = await loadCatRecords([id]);
    const now = new Date();
    const snapBefore = resolveCat(records.get(id)!.observations, records.get(id)!.evidenceOfLife, now);
    const derivedBefore = (await deriveCatStatuses([{ id, ownerDeviceId: null }])).get(id);
    const pageBefore = await request(app).get(`/api/cats/${id}`);
    expect(pageBefore.status).toBe(200);
    await db.execute(sql`alter table cat_news_baseline rename to cat_news_baseline_hidden`);
    try {
      const recordsAfter = await loadCatRecords([id]);
      expect(resolveCat(recordsAfter.get(id)!.observations, recordsAfter.get(id)!.evidenceOfLife, now)).toEqual(snapBefore);
      expect((await deriveCatStatuses([{ id, ownerDeviceId: null }])).get(id)).toEqual(derivedBefore);
      const pageAfter = await request(app).get(`/api/cats/${id}`);
      expect(pageAfter.status).toBe(200);
      expect(pageAfter.body.cat).toEqual(pageBefore.body.cat);
    } finally {
      await db.execute(sql`alter table cat_news_baseline_hidden rename to cat_news_baseline`);
    }
  });
});

describe("T1-9: one run per Athens night, claimed only when it finishes", () => {
  it("a second call the same night does nothing", async () => {
    await fresh();
    const second = await runNightlyNewsCheck();
    expect(second.status).toBe("already");
  });

  it("a run that crashes before finishing claims nothing, and the next call runs it", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true);
    await db.delete(catNewsRunsTable);
    await expect(
      runNightlyNewsCheck({
        beforeFinish: () => {
          throw new Error("crash");
        },
      }),
    ).rejects.toThrow("crash");
    expect(await db.select().from(catNewsRunsTable)).toHaveLength(0);
    expect(await changesFor([id])).toHaveLength(0);
    const next = await runNightlyNewsCheck();
    expect(next.status).toBe("ran");
    expect(await changesFor([id])).toMatchObject([{ change: "sterilised", state: "watched" }]);
  });

  it("two callers at once: one runs, the other is busy or finds it done", async () => {
    await db.delete(catNewsRunsTable);
    const [a, b] = await Promise.all([runNightlyNewsCheck(), runNightlyNewsCheck()]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining(["ran"]));
    expect([a.status, b.status].filter((s) => s === "ran")).toHaveLength(1);
    expect(await db.select().from(catNewsRunsTable)).toHaveLength(1);
  });
});

describe("T1-10: the endpoint takes only NEWS_JOB_TOKEN, and never logs it", () => {
  it("missing or wrong token → 401; no token configured → 503; the right one → 200", async () => {
    expect((await request(app).post("/api/internal/news/nightly")).status).toBe(401);
    expect((await request(app).post("/api/internal/news/nightly").set("Authorization", "Bearer nope")).status).toBe(401);
    expect((await request(app).get("/api/internal/news/last-run").set("Authorization", "Bearer nope")).status).toBe(401);
    const drain = process.env["MAIL_DRAIN_TOKEN"];
    process.env["MAIL_DRAIN_TOKEN"] = "vitest-drain-token-not-news";
    try {
      expect(
        (await request(app).post("/api/internal/news/nightly").set("Authorization", "Bearer vitest-drain-token-not-news")).status,
      ).toBe(401);
    } finally {
      if (drain === undefined) delete process.env["MAIL_DRAIN_TOKEN"];
      else process.env["MAIL_DRAIN_TOKEN"] = drain;
    }
    delete process.env["NEWS_JOB_TOKEN"];
    try {
      expect((await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(503);
    } finally {
      process.env["NEWS_JOB_TOKEN"] = TOKEN;
    }
    await db.delete(catNewsRunsTable);
    const ran = await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}`);
    expect(ran.status).toBe(200);
    expect(ran.body).toMatchObject({ silencedBulk: false });
    expect(typeof ran.body.catsWalked).toBe("number");
    const again = await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}`);
    expect(again.body).toMatchObject({ already: true });
    const last = await request(app).get("/api/internal/news/last-run").set("Authorization", `Bearer ${TOKEN}`);
    expect(last.status).toBe(200);
    expect(Date.parse(last.body.lastRun.finishedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("the pre-launch gate lets the news paths through with NEWS_JOB_TOKEN only", async () => {
    const before = process.env["PRELAUNCH_GATE"];
    process.env["PRELAUNCH_GATE"] = "on";
    try {
      expect((await request(app).post("/api/internal/news/nightly")).status).toBe(401);
      await db.delete(catNewsRunsTable);
      expect((await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
      expect((await request(app).get("/api/internal/news/last-run").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
      // The news token opens nothing else.
      expect((await request(app).post("/api/internal/mail/drain").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(401);
    } finally {
      if (before === undefined) delete process.env["PRELAUNCH_GATE"];
      else process.env["PRELAUNCH_GATE"] = before;
    }
  });

  it("no log line carries the token", async () => {
    await db.delete(catNewsRunsTable);
    await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}`);
    await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}x`);
    await request(app).get("/api/internal/news/last-run").set("Authorization", `Bearer ${TOKEN}`);
    expect(spies.logLines.filter((l) => l.includes('"request completed"')).length).toBeGreaterThanOrEqual(3);
    for (const line of spies.logLines) expect(line).not.toContain(TOKEN);
  });
});

describe("T1-11: the check sees the same status as the cat page (data spine §9.1)", () => {
  it("for 30 cats in every state, the baseline matches GET /api/cats/:id", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) {
      // Some have an owner on the old column but no homed statement, some a
      // homed statement and no owner: the old (pre-PR 3) path disagrees on both.
      const id = await cat(i % 5 === 0 ? { ownerDeviceId: `vitest-news-owner-${i}` } : {});
      switch (i % 6) {
        case 0:
          await sterilised(id, true);
          break;
        case 1:
          await sterilised(id, false);
          break;
        case 2:
          await life(id, "homed");
          break;
        case 3:
          await life(id, "in_care");
          await sterilised(id, true);
          break;
        case 4:
          await life(id, "deceased");
          break;
        default:
          await writeObservation(db, {
            catId: id,
            kind: "ear_tip",
            value: { clipped: true },
            deviceId: "vitest-news-spotter",
            roleAtTime: "public",
            photoId: await photo(),
            observedAt: new Date(),
          });
      }
      ids.push(id);
    }
    await fresh();
    for (const id of ids) {
      const page = await request(app).get(`/api/cats/${id}`);
      expect(page.status).toBe(200);
      const b = (await baselineOf(id))!;
      const shown = page.body.cat as { lifeStatus: string; sterilised: { value: boolean | null; confidence: string } };
      expect({ catId: id, lifeStatus: b.lifeStatus, sterilisedConfirmed: b.sterilisedConfirmed }).toEqual({
        catId: id,
        lifeStatus: shown.lifeStatus,
        sterilisedConfirmed: shown.sterilised.value === true && shown.sterilised.confidence === "confirmed",
      });
    }
  });
});

describe("T1-12: the ratchet: a status that flips is announced once", () => {
  it("sterilised, then not, then sterilised again → one sterilised change ever", async () => {
    const id = await cat();
    await fresh();
    await sterilised(id, true, { observedAt: new Date(Date.now() - 3 * 60_000) });
    await fresh();
    await sterilised(id, false, { observedAt: new Date(Date.now() - 2 * 60_000) });
    await fresh();
    expect((await baselineOf(id))!.sterilisedConfirmed).toBe(false);
    await sterilised(id, true, { observedAt: new Date(Date.now() - 60_000) });
    await fresh();
    expect(await changesFor([id])).toHaveLength(1);
  });

  it("homed, then street, then homed again → one homed change ever", async () => {
    const id = await cat();
    await fresh();
    await life(id, "homed", { observedAt: new Date(Date.now() - 3 * 60_000) });
    await fresh();
    await life(id, "street", { observedAt: new Date(Date.now() - 2 * 60_000) });
    await fresh();
    await life(id, "homed", { observedAt: new Date(Date.now() - 60_000) });
    await fresh();
    expect((await changesFor([id])).map((r) => r.change)).toEqual(["homed"]);
  });
});

describe("T1-13: more than 50 news changes in one night silences them all", () => {
  async function confirmed(n: number) {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(await cat());
    await fresh();
    for (const id of ids) await sterilised(id, true);
    return ids;
  }

  it("51 → every one silenced 'bulk', and the endpoint says so (the Worker alarms on it)", async () => {
    expect(BULK_LIMIT).toBe(50);
    const ids = await confirmed(51);
    await db.delete(catNewsRunsTable);
    const res = await request(app).post("/api/internal/news/nightly").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ silencedBulk: true, news: 0 });
    const rows = await changesFor(ids);
    expect(rows).toHaveLength(51);
    expect(rows.every((r) => r.state === "silenced" && r.silencedReason === "bulk" && r.causedByDevices === null)).toBe(true);
    const [run] = await db.select().from(catNewsRunsTable);
    expect(run!.silencedBulk).toBe(true);
  });

  it("50 → none silenced", async () => {
    const ids = await confirmed(50);
    const r = await fresh();
    expect(r.silencedBulk).toBe(false);
    const rows = await changesFor(ids);
    expect(rows).toHaveLength(50);
    expect(rows.every((x) => x.state === "watched")).toBe(true);
  });
});
