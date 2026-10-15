import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, count, eq, inArray, like } from "drizzle-orm";
import {
  catsTable,
  catUpdatesTable,
  db,
  mailOutboxTable,
  notificationsTable,
  observationsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";

// SYC-161 plan, PR 1: T-route, T-public, T-life and T-quiet. The model is
// mocked in every test; no real call is ever made.
const create = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create } } },
}));
// Every push is recorded instead of sent (T-quiet).
const pushes = vi.hoisted(() => [] as unknown[][]);
vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn(async (...args: unknown[]) => {
    pushes.push(args);
  }),
}));

import app from "../app";
import { deleteTestSightings } from "../test/sightings";
import { MODEL_VERSION } from "../lib/coatReading/reader";
import { sweepCoatReadings } from "../lib/coatReading/sweep";
import { loadCatRecords } from "../lib/observations";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-coatroute-${RUN}-`;
const DRAIN_TOKEN = randomBytes(24).toString("base64url");
const PEOPLE_TOKEN = randomBytes(24).toString("base64url");
const AT = { lat: 33.7127, lng: 20.6419 };
const SAVED_ENV = { ...process.env };
let n = 0;

beforeEach(() => {
  process.env["MAIL_DRAIN_TOKEN"] = DRAIN_TOKEN;
  process.env["INTERNAL_PEOPLE_TOKEN"] = PEOPLE_TOKEN;
  create.mockReset();
  create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ catCount: 1, photoClear: true, colours: ["ginger", "tabby"], confidence: 0.93 }) } }],
  });
  pushes.length = 0;
});

afterEach(() => {
  for (const k of ["MAIL_DRAIN_TOKEN", "INTERNAL_PEOPLE_TOKEN", "PRELAUNCH_GATE", "PRELAUNCH_SESSION_KEYS", "PRELAUNCH_TESTER_KEYS"]) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

afterAll(async () => {
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  const ids = cats.map((c) => c.id);
  if (ids.length) {
    await deleteTestSightings(inArray(sightingsTable.catId, ids));
    await db.delete(catsTable).where(inArray(catsTable.id, ids));
  }
  await pool.end();
});

/** A cat whose main photo, sightings and record are `daysOld` days old. */
async function seedCat(label: string, daysOld = 0): Promise<number> {
  const old = new Date(Date.now() - daysOld * 86_400_000);
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}${label}-${n++}`, data: Buffer.from(label).toString("base64"), mime: "image/jpeg", createdAt: old })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${label}-${n++}`,
      primaryPhotoId: p!.id,
      lat: AT.lat,
      lng: AT.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
      createdAt: old,
    })
    .returning({ id: catsTable.id });
  await db.insert(sightingsTable).values({
    catId: c!.id,
    photoId: p!.id,
    deviceId: `${PREFIX}spotter`,
    lat: AT.lat,
    lng: AT.lng,
    status: "resolved",
    createdAt: old,
  });
  return c!.id;
}

async function machineRowCount(): Promise<number> {
  const [r] = await db.select({ n: count() }).from(observationsTable).where(eq(observationsTable.provenance, "machine"));
  return r!.n;
}

function sweep(body: unknown, token: string | null = DRAIN_TOKEN) {
  const req = request(app).post("/api/internal/coat/sweep");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body as object);
}

describe("T-route: POST /api/internal/coat/sweep", () => {
  it("no token → 401; the people token → 401; no server token → 503; always no-store", async () => {
    const none = await sweep({}, null);
    expect(none.status).toBe(401);
    expect(none.headers["cache-control"]).toBe("no-store");
    expect((await sweep({}, PEOPLE_TOKEN)).status).toBe(401);
    expect((await sweep({}, "wrong")).status).toBe(401);
    delete process.env["MAIL_DRAIN_TOKEN"];
    const unconfigured = await sweep({}, DRAIN_TOKEN);
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.body).toEqual({ error: "not_configured" });
  });

  it("the mail-drain path is unchanged: still refused without its token", async () => {
    expect((await request(app).post("/api/internal/mail/drain")).status).toBe(401);
    expect((await request(app).post("/api/internal/mail/drain").set("Authorization", `Bearer ${PEOPLE_TOKEN}`)).status).toBe(401);
  });

  it("an empty body is a dry run: no call, no write", async () => {
    await seedCat("route-empty");
    const before = await machineRowCount();
    const res = await sweep({});
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("dry_run");
    expect(res.body.due).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
    expect(await machineRowCount()).toBe(before);
  });

  it("dry_run makes 0 calls and trial makes N, and neither writes a row", async () => {
    await seedCat("route-a");
    await seedCat("route-b");
    const before = await machineRowCount();
    const dry = await sweep({ mode: "dry_run", limit: 5 });
    expect(dry.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
    const expected = dry.body.calls as number;
    expect(expected).toBeGreaterThan(0);
    const trial = await sweep({ mode: "trial", limit: 5 });
    expect(trial.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(expected);
    expect(trial.body.calls).toBe(expected);
    expect(trial.body.cutoff).toBe(0.8);
    expect(trial.body.modelVersion).toBe(MODEL_VERSION);
    expect(trial.body.written).toBe(0);
    const read = (trial.body.items as { status: string; raw?: unknown }[]).filter((i) => i.status === "read");
    expect(read.length).toBe(expected);
    expect(read[0]!.raw).toMatchObject({ confidence: 0.93, catCount: 1, photoClear: true });
    expect(await machineRowCount()).toBe(before);
  });

  it("refuses a limit above 50, an unknown mode, a bad exclude and unknown keys", async () => {
    for (const body of [
      { limit: 51 },
      { limit: 0 },
      { limit: 2.5 },
      { mode: "fill_in" },
      { exclude: ["12"] },
      { exclude: [-1] },
      { mode: "write", force: true },
    ]) {
      const res = await sweep(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("the pre-launch gate lets this path through with the drain token, and with nothing else", async () => {
    process.env["PRELAUNCH_GATE"] = "on";
    process.env["PRELAUNCH_SESSION_KEYS"] = Buffer.alloc(32, 9).toString("base64url");
    process.env["PRELAUNCH_TESTER_KEYS"] = "a-tester-key";
    expect((await sweep({ mode: "dry_run", limit: 1 })).status).toBe(200);
    expect((await sweep({}, PEOPLE_TOKEN)).status).toBe(401);
    expect((await sweep({}, null)).status).toBe(401);
    expect((await request(app).post("/api/internal/coat/sweep").set("X-Prelaunch-Key", "a-tester-key").send({})).status).toBe(401);
    // Only POST, only exactly this path.
    expect((await request(app).get("/api/internal/coat/sweep").set("Authorization", `Bearer ${DRAIN_TOKEN}`)).status).toBe(401);
    expect((await request(app).post("/api/internal/coat/sweep/x").set("Authorization", `Bearer ${DRAIN_TOKEN}`)).status).toBe(401);
    expect((await request(app).post("/api/internal/coat").set("Authorization", `Bearer ${DRAIN_TOKEN}`)).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});

/** Every key at every depth of a JSON value. */
function allKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

describe("T-public: the public sees the colour and nothing else about the reading (spec test 20)", () => {
  it("GET /cats/:id carries coat; no reading detail anywhere; the shape is unchanged", async () => {
    const read = await seedCat("pub-read");
    const notSure = await seedCat("pub-notsure");
    const unread = await seedCat("pub-unread");
    const at = new Date(Date.now() - 7 * 60_000 - 123);
    await sweepCoatReadings({ mode: "write", limit: 50, catIds: [read], now: () => at });
    create.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ catCount: 2, photoClear: true, colours: ["black"], confidence: 0.99 }) } }],
    });
    await sweepCoatReadings({ mode: "write", limit: 50, catIds: [notSure], now: () => at });
    const [row] = await db
      .select()
      .from(observationsTable)
      .where(and(eq(observationsTable.catId, read), eq(observationsTable.provenance, "machine")));

    const readRes = await request(app).get(`/api/cats/${read}`);
    const notSureRes = await request(app).get(`/api/cats/${notSure}`);
    const unreadRes = await request(app).get(`/api/cats/${unread}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.cat.coat).toEqual(["ginger", "tabby"]);
    expect(notSureRes.body.cat.coat).toEqual([]);
    expect(unreadRes.body.cat.coat).toEqual([]);

    const text = JSON.stringify(readRes.body);
    for (const leak of ["system:vision", "coat-reader", MODEL_VERSION, at.toISOString(), "photoClear", "catCount", "notSureBecause"]) {
      expect(text, leak).not.toContain(leak);
    }
    const keys = allKeys(readRes.body);
    for (const k of ["modelVersion", "suggestedValue", "suggestionSource", "provenance", "accountId", "observedAt", "confidence"]) {
      if (k === "confidence") {
        // sterilised.confidence is already public (§10.4); coat is a list of
        // plain codes, so it carries none.
        expect(readRes.body.cat.coat.every((c: unknown) => typeof c === "string")).toBe(true);
        continue;
      }
      expect(keys.has(k), k).toBe(false);
    }
    // The reading's photo id is not named anywhere a reading would put it.
    expect(text).not.toContain(`"photoId":${row!.photoId}`);
    // The shape: a read cat has exactly the keys an unread one has.
    expect(Object.keys(readRes.body.cat).sort()).toEqual(Object.keys(unreadRes.body.cat).sort());

    const list = await request(app).get(`/api/cats?lat=${AT.lat}&lng=${AT.lng}&pageSize=50`);
    const listed = (list.body.cats as { id: number; coat: string[] }[]).find((c) => c.id === read);
    expect(listed?.coat).toEqual(["ginger", "tabby"]);
    expect(JSON.stringify(list.body)).not.toContain("system:vision");
  });
});

describe("T-life: a reading is not evidence of life (spec test 17)", () => {
  it("a fill-in run over cats with old photos moves no lastSeen, notSeenSince or life status", async () => {
    const ids = [await seedCat("life-a", 200), await seedCat("life-b", 45), await seedCat("life-c", 400)];
    const snap = async () =>
      Promise.all(
        ids.map(async (id) => {
          const { cat } = (await request(app).get(`/api/cats/${id}`)).body;
          return { lastSeenAt: cat.lastSeenAt, notSeenSince: cat.notSeenSince, lifeStatus: cat.lifeStatus };
        }),
      );
    const evidence = async () => {
      const records = await loadCatRecords(ids);
      return ids.map((id) => records.get(id)!.evidenceOfLife);
    };
    const before = await snap();
    const evBefore = await evidence();
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: ids });
    expect(r.written).toBe(3);
    expect(await snap()).toEqual(before);
    expect(await evidence()).toEqual(evBefore);
  });
});

describe("T-quiet: a run queues nothing", () => {
  it("no push, no notification, no cat update, no mail", async () => {
    const ids = [await seedCat("quiet-a"), await seedCat("quiet-b")];
    const counts = async () => {
      const [nn] = await db.select({ n: count() }).from(notificationsTable);
      const [uu] = await db.select({ n: count() }).from(catUpdatesTable);
      const [mm] = await db.select({ n: count() }).from(mailOutboxTable);
      return { notifications: nn!.n, updates: uu!.n, mail: mm!.n };
    };
    const before = await counts();
    const r = await sweepCoatReadings({ mode: "write", limit: 50, catIds: ids });
    expect(r.written).toBe(2);
    expect(await counts()).toEqual(before);
    expect(pushes).toHaveLength(0);
  });
});
