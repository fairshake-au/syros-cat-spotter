import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  catUpdatesTable,
  deviceCredentialsTable,
  notificationsTable,
  observationsTable,
  pushTokensTable,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";

// SYC-130 Task 5: the owner lets go (claiming-a-cat.md §6, §8, §11). Every
// test makes its own cat and its own phones.

// Consonants only: random hex can spell leetspeak ("a55") that the note
// filter rightly refuses, which made this setup flaky.
const safeTag = () => [...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("");
const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatFollowers: vi.fn(actual.notifyCatFollowers) };
});

// Wrapped, so a test can see the withdrawal goes through writeObservation,
// inside the route's own transaction.
vi.mock("../lib/observations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/observations")>();
  return { ...actual, writeObservation: vi.fn(actual.writeObservation) };
});

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { sendPushNotification } from "../lib/push";
import { notifyCatFollowers } from "../lib/notifications";
import { WITHDRAWN, writeObservation } from "../lib/observations";
import { clearOwner } from "../lib/claiming";
import { blurPosition } from "../lib/blur";
import { _resetClaimLimitForTests } from "../middlewares/rateLimit";

const pushMock = vi.mocked(sendPushNotification);
const notifyMock = vi.mocked(notifyCatFollowers);
const writeMock = vi.mocked(writeObservation);

const PREFIX = "vitest-letgo-";
const NAME_PREFIX = "VitestLetGo";
const CAT = { lat: 37.4441, lng: 24.9412 };
const PUBLIC = blurPosition(CAT.lat, CAT.lng);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});
beforeEach(async () => {
  pushMock.mockClear();
  notifyMock.mockClear();
  writeMock.mockClear();
  await _resetClaimLimitForTests();
});

type Phone = { id: string; secret: string };
function phone(label: string): Phone {
  const tag = randomBytes(4).toString("hex");
  return { id: `${PREFIX}${label}-${tag}`, secret: `${PREFIX}secret-${label}-${tag}` };
}

async function bind(p: Phone) {
  const res = await request(app).get(`/api/profiles/${p.id}/username`).set("X-Device-Secret", p.secret);
  expect(res.status).toBe(200);
}

async function streetCat() {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${randomBytes(4).toString("hex")}`,
      description: "",
      primaryPhotoId: 0,
      lat: CAT.lat,
      lng: CAT.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
    })
    .returning();
  return c!;
}

async function met(catId: number, p: Phone) {
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId, deviceId: p.id, photoId: 0, lat: CAT.lat, lng: CAT.lng, status: "resolved", createdAt: daysAgo(5) })
    .returning();
  await db.insert(sightingMatchesTable).values({
    sightingId: s!.id,
    choice: "suggested",
    chosenCatId: catId,
    chosenAt: daysAgo(5),
    suggestedRank: 1,
  });
  await db.insert(pushTokensTable).values({ deviceId: p.id, token: `tok-${p.id}` }).onConflictDoNothing();
}

const NOTE = () => `Blue door ${safeTag()}`;
const claim = (catId: number, p: Phone, over: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/cats/${catId}/claim`)
    .set("X-Device-Secret", p.secret)
    .send({
      deviceId: p.id,
      livesOnSyros: true,
      livesInMyHome: true,
      homePin: { lat: PUBLIC.lat + 0.001, lng: PUBLIC.lng + 0.001 },
      homeNote: "Blue door",
      ...over,
    });
const letGo = (catId: number, p: Phone, secret = p.secret, extra: Record<string, unknown> = {}) =>
  request(app).post(`/api/cats/${catId}/let-go`).set("X-Device-Secret", secret).send({ deviceId: p.id, ...extra });
const detail = (catId: number, p?: Phone, secret?: string) => {
  const r = request(app).get(`/api/cats/${catId}`);
  if (p) r.set("X-Device-Id", p.id);
  if (secret) r.set("X-Device-Secret", secret);
  return r;
};

const reload = async (catId: number) => (await db.select().from(catsTable).where(eq(catsTable.id, catId)))[0]!;
const lifeObservations = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, catId), eq(observationsTable.kind, "life_status")));
const withdrawals = async (catId: number) =>
  (await lifeObservations(catId)).filter((o) => (o.value as { withdrawn?: boolean }).withdrawn === true);
const homed = async (catId: number) =>
  (await lifeObservations(catId)).filter((o) => (o.value as { status?: string }).status === "homed");

/** An owned cat: a street cat that `d` has met and claimed. */
async function ownedCat(label: string) {
  const c = await streetCat();
  const d = phone(label);
  await met(c.id, d);
  await bind(d);
  const note = NOTE();
  expect((await claim(c.id, d, { homeNote: note })).status).toBe(200);
  await db.update(catsTable).set({ ownerName: "Maria" }).where(eq(catsTable.id, c.id));
  return { c, d, note };
}

describe("POST /api/cats/:catId/let-go (SYC-130 §6)", () => {
  it("lets go: clears link, name, note and pin, withdraws the homed, status falls back to street", async () => {
    const { c, d } = await ownedCat("ok");
    const [h] = await homed(c.id);
    const res = await letGo(c.id, d);
    expect(res.status).toBe(200);
    const row = await reload(c.id);
    expect(row).toMatchObject({
      ownerDeviceId: null,
      ownerName: null,
      homeDescription: null,
      homeLat: null,
      homeLng: null,
    });
    const w = await withdrawals(c.id);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      supersedesId: h!.id,
      deviceId: d.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
    });
    expect(w[0]!.value).toEqual({ withdrawn: true });
    // The owner never writes a status of their own: only the one withdrawal
    // and the original homed exist.
    expect(await lifeObservations(c.id)).toHaveLength(2);
    expect(res.body.lifeStatus).toBe("street");
    expect(res.body.hasHome).toBe(false);
    expect((await detail(c.id)).body.cat.lifeStatus).toBe("street");
  });

  it("status falls back to what the team recorded before the claim (in_care)", async () => {
    const c = await streetCat();
    const d = phone("incare");
    await met(c.id, d);
    await bind(d);
    // A team in_care from before: it is older than the claim, so the claim
    // (written now) is the newest statement while it stands.
    expect((await claim(c.id, d)).status).toBe(200);
    await writeObservation(db, {
      catId: c.id,
      kind: "life_status",
      value: { status: "in_care" },
      accountId: "system:legacy-backfill",
      roleAtTime: "staff",
      observedAt: daysAgo(3),
    });
    expect((await detail(c.id)).body.cat.lifeStatus).toBe("homed");
    const res = await letGo(c.id, d);
    expect(res.status).toBe(200);
    expect(res.body.lifeStatus).toBe("in_care");
    expect((await detail(c.id)).body.cat.lifeStatus).toBe("in_care");
  });

  it("supersedes EVERY active owner homed of this phone, not just the newest", async () => {
    const { c, d } = await ownedCat("two");
    await writeObservation(db, {
      catId: c.id,
      kind: "life_status",
      value: { status: "homed" },
      deviceId: d.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: new Date(Date.now() + 1),
    });
    const hs = await homed(c.id);
    expect(hs).toHaveLength(2);
    const res = await letGo(c.id, d);
    expect(res.status).toBe(200);
    const w = await withdrawals(c.id);
    expect(w.map((o) => o.supersedesId).sort()).toEqual(hs.map((o) => o.id).sort());
    expect(res.body.lifeStatus).toBe("street");
    expect(res.body.hasHome).toBe(false);
  });

  it("an owner with no homed row (a legacy claim) still lets go: link cleared, nothing superseded", async () => {
    const c = await streetCat();
    const d = phone("legacy");
    await bind(d);
    await db
      .update(catsTable)
      .set({ ownerDeviceId: d.id, homeDescription: "old", homeLat: 37.44, homeLng: 24.94 })
      .where(eq(catsTable.id, c.id));
    const res = await letGo(c.id, d);
    expect(res.status).toBe(200);
    expect((await reload(c.id)).ownerDeviceId).toBeNull();
    expect(await withdrawals(c.id)).toHaveLength(0);
  });

  it("writes the withdrawal through writeObservation, in the route's own transaction, with the server's clock", async () => {
    const { c, d } = await ownedCat("clock");
    writeMock.mockClear();
    // A phone-supplied time is not read from the body at all.
    const res = await letGo(c.id, d, d.secret, {
      createdAt: "2001-01-01T00:00:00Z",
      observedAt: "2001-01-01T00:00:00Z",
    });
    expect(res.status).toBe(200);
    const calls = writeMock.mock.calls.filter(([, input]) => (input.value as object) === WITHDRAWN || JSON.stringify(input.value) === JSON.stringify(WITHDRAWN));
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).not.toBe(db);
    const [w] = await withdrawals(c.id);
    expect(Math.abs(w!.createdAt.getTime() - Date.now())).toBeLessThan(10_000);
    expect(Math.abs(w!.observedAt.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it("returns the PUBLIC payload: no note, pin, owner name or exact position", async () => {
    const { c, d, note } = await ownedCat("public");
    const res = await letGo(c.id, d);
    expect(res.status).toBe(200);
    expect(res.body.homeDescription).toBeNull();
    expect(res.body.homePin).toBeNull();
    expect(res.body.ownerName).toBeNull();
    expect(res.body.locationPrecision).not.toBe("exact");
    expect(res.text).not.toContain(note);
    expect(res.text).not.toContain(String(CAT.lat));
    expect(res.text).not.toContain(String(CAT.lng));
    // The same phone now sees the public view of the cat too.
    const own = await detail(c.id, d, d.secret);
    expect(own.body.cat.locationPrecision).not.toBe("exact");
    expect(own.body.cat.homeDescription).toBeNull();
  });

  it("tells nobody: no push, no cat update, no notification row", async () => {
    const c = await streetCat();
    const d = phone("quiet");
    const spotter = phone("spotter");
    await met(c.id, d);
    await met(c.id, spotter);
    await bind(d);
    expect((await claim(c.id, d)).status).toBe(200);
    // The first claim's fan-out has run and reached the other spotter.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    const count = async () => {
      const u = await db.select().from(catUpdatesTable).where(eq(catUpdatesTable.catId, c.id));
      const n = u.length
        ? await db.select().from(notificationsTable).where(inArray(notificationsTable.catUpdateId, u.map((x) => x.id)))
        : [];
      return [u.length, n.length];
    };
    const before = await count();
    notifyMock.mockClear();
    pushMock.mockClear();
    expect((await letGo(c.id, d)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(notifyMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(await count()).toEqual(before);
  });

  describe("who may let go", () => {
    it("a phone that is not the owner gets 403 NOT_OWNER, and nothing changes", async () => {
      const { c, d } = await ownedCat("notowner");
      const other = phone("other");
      await bind(other);
      const before = await reload(c.id);
      const obs = await lifeObservations(c.id);
      const res = await letGo(c.id, other);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: expect.any(String), code: "NOT_OWNER" });
      expect(await reload(c.id)).toEqual(before);
      expect(await lifeObservations(c.id)).toHaveLength(obs.length);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(before.ownerDeviceId).toBe(d.id);
    });

    it("a cat nobody owns is 403 NOT_OWNER", async () => {
      const c = await streetCat();
      const d = phone("ownerless");
      await bind(d);
      const res = await letGo(c.id, d);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_OWNER");
    });

    it("an unknown cat is 404, and a non-numeric id is 404", async () => {
      const d = phone("nocat");
      await bind(d);
      const a = await letGo(2_000_000_000, d);
      expect(a.status).toBe(404);
      expect(a.headers["cache-control"]).toBe("private, no-store");
      expect((await letGo("abc" as unknown as number, d)).status).toBe(404);
    });

    it("a bad body is a plain 400", async () => {
      const { c, d } = await ownedCat("badbody");
      const res = await request(app).post(`/api/cats/${c.id}/let-go`).set("X-Device-Secret", d.secret).send({});
      expect(res.status).toBe(400);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    });
  });

  describe("device identity", () => {
    it("a wrong secret is 403 from the secret check, and nothing changes", async () => {
      const { c, d } = await ownedCat("wrongsecret");
      const res = await letGo(c.id, d, `${d.secret}-not`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Device secret does not match" });
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
      expect(await withdrawals(c.id)).toHaveLength(0);
    });

    it("no secret is 401", async () => {
      const { c, d } = await ownedCat("nosecret");
      const res = await request(app).post(`/api/cats/${c.id}/let-go`).send({ deviceId: d.id });
      expect(res.status).toBe(401);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    });

    it("a deleted phone gets 410, like the claim", async () => {
      const c = await streetCat();
      const res = await request(app)
        .post(`/api/cats/${c.id}/let-go`)
        .set("X-Device-Secret", `${PREFIX}x`.padEnd(40, "x"))
        .send({ deviceId: "deleted:abc" });
      const claimRes = await request(app)
        .post(`/api/cats/${c.id}/claim`)
        .set("X-Device-Secret", `${PREFIX}x`.padEnd(40, "x"))
        .send({ deviceId: "deleted:abc", livesOnSyros: true, livesInMyHome: true, homePin: { lat: 37.44, lng: 24.9 } });
      expect(res.status).toBe(claimRes.status);
      expect(res.body).toEqual(claimRes.body);
    });

    it("only the proven device id counts: someone else's id with the owner's secret is refused", async () => {
      const { c, d } = await ownedCat("proven");
      const other = phone("proven-other");
      await bind(other);
      // The owner's id with the OTHER phone's secret: the secret check refuses.
      const res = await letGo(c.id, d, other.secret);
      expect(res.status).toBe(403);
      expect((await reload(c.id)).ownerDeviceId).toBe(d.id);
    });
  });

  describe("the transaction", () => {
    it("two let-gos at once: one wins, the other is NOT_OWNER and writes nothing", async () => {
      const { c, d } = await ownedCat("race");
      const [a, b] = await Promise.all([letGo(c.id, d), letGo(c.id, d)]);
      expect([a.status, b.status].sort()).toEqual([200, 403]);
      const loser = a.status === 403 ? a : b;
      expect(loser.body.code).toBe("NOT_OWNER");
      expect(await withdrawals(c.id)).toHaveLength(1);
    });

    it("locks the cat row and re-checks the owner under the lock: an owner removed while it waits wins", async () => {
      const { c, d } = await ownedCat("lock");
      let pending: Promise<request.Response> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(sql`select id from cats where id = ${c.id} for update`);
        pending = letGo(c.id, d).then((r) => r);
        await vi.waitFor(
          async () => {
            const r = await db.execute<{ n: number }>(sql`
              select count(*)::int as n from pg_stat_activity
               where datname = current_database()
                 and wait_event_type = 'Lock'
                 and query ilike '%cats%'`);
            expect(r.rows[0]!.n).toBeGreaterThan(0);
          },
          { timeout: 5000, interval: 25 },
        );
        // The team removes the owner meanwhile (as Task 6 will), in this transaction.
        await tx.update(catsTable).set({ ownerDeviceId: null, homeDescription: null }).where(eq(catsTable.id, c.id));
      });
      const res = await pending!;
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_OWNER");
      expect(await withdrawals(c.id)).toHaveLength(0);
    });
  });

  it("response is private, no-store (success and refusals)", async () => {
    const { c, d } = await ownedCat("cache");
    const refused = await letGo(c.id, phone("cache-other"));
    expect(refused.headers["cache-control"]).toBe("private, no-store");
    const ok = await letGo(c.id, d);
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, no-store");
  });

  describe("the 7-day cooldown (§11)", () => {
    it("after letting go, canClaim is false for this phone and a re-claim is 429 CLAIM_COOLDOWN", async () => {
      const { c, d } = await ownedCat("cooldown");
      expect((await letGo(c.id, d)).status).toBe(200);
      const page = await detail(c.id, d, d.secret);
      expect(page.body.canClaim).toBe(false);
      // The page can tell the app this is the cooldown, not "hasn't met it".
      expect(page.body.claimCooldown).toBe(true);
      // Never to a phone that hasn't proved who it is, nor to anyone else.
      expect((await detail(c.id)).body.claimCooldown).toBe(false);
      expect((await detail(c.id, d)).body.claimCooldown).toBe(false);
      expect((await detail(c.id, d, "wrong-secret-0123456789")).body.claimCooldown).toBe(false);
      const res = await claim(c.id, d);
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: expect.any(String), code: "CLAIM_COOLDOWN" });
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
      // Another phone that has met the cat isn't held back.
      const other = phone("cooldown-other");
      await met(c.id, other);
      await bind(other);
      expect((await detail(c.id, other, other.secret)).body.canClaim).toBe(true);
      expect((await detail(c.id, other, other.secret)).body.claimCooldown).toBe(false);
      expect((await claim(c.id, other)).status).toBe(200);
    });
    // The after-7-days side is covered in cats.claim.v2.test.ts: observations are
    // append-only, so a withdrawal can't be back-dated after the fact.
  });

  it("nothing about the note or pin reaches the request log", async () => {
    const c = await streetCat();
    const d = phone("log");
    await met(c.id, d);
    await bind(d);
    const note = NOTE();
    const pin = { lat: PUBLIC.lat + 0.00123, lng: PUBLIC.lng + 0.00234 };
    expect((await claim(c.id, d, { homePin: pin, homeNote: note })).status).toBe(200);
    spies.logLines.length = 0;
    await letGo(c.id, phone("log-other"));
    expect((await letGo(c.id, d)).status).toBe(200);
    await letGo(c.id, d);
    const text = spies.logLines.join("\n");
    expect(text).toContain("/let-go");
    expect(text).not.toContain(note);
    for (const v of [pin.lat, pin.lng, CAT.lat, CAT.lng]) {
      expect(text).not.toContain(String(v));
      expect(text).not.toContain(v.toFixed(5));
    }
  });
});

describe("after the team removes an owner: 30 days (Samuel, 14 Oct 2026)", () => {
  /** What Remove owner writes: a staff withdrawal of the owner's homed, and
   * the owner cleared. `ageDays` back-dates it (observations are append-only,
   * so it is inserted that way, as the 'cooldown-old' case does). */
  async function teamRemoves(catId: number, ageDays = 0) {
    const [h] = await homed(catId);
    if (ageDays === 0) {
      await writeObservation(db, {
        catId,
        kind: "life_status",
        value: WITHDRAWN,
        allowWithdrawal: true,
        accountId: "system:legacy-backfill",
        roleAtTime: "staff",
        observedAt: new Date(),
        supersedesId: h!.id,
      });
    } else {
      await db.insert(observationsTable).values({
        catId,
        kind: "life_status",
        value: WITHDRAWN,
        accountId: "system:legacy-backfill",
        roleAtTime: "staff",
        observedAt: daysAgo(ageDays),
        createdAt: daysAgo(ageDays),
        supersedesId: h!.id,
      });
    }
    await clearOwner(db, catId);
  }

  it("the removed phone: canClaim false, claimCooldown true, claim 429 CLAIM_COOLDOWN, on the day and at 29 days", async () => {
    for (const age of [0, 29]) {
      const { c, d } = await ownedCat(`removed-${age}`);
      await teamRemoves(c.id, age);
      const page = await detail(c.id, d, d.secret);
      expect(page.body.canClaim).toBe(false);
      expect(page.body.claimCooldown).toBe(true);
      const res = await claim(c.id, d);
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: expect.any(String), code: "CLAIM_COOLDOWN" });
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
    }
  });

  it("after 31 days it can claim again", async () => {
    const { c, d } = await ownedCat("removed-31");
    await teamRemoves(c.id, 31);
    const page = await detail(c.id, d, d.secret);
    expect(page.body.canClaim).toBe(true);
    expect(page.body.claimCooldown).toBe(false);
    expect((await claim(c.id, d)).status).toBe(200);
  });

  it("another phone that met the cat can claim straight away", async () => {
    const { c } = await ownedCat("removed-other");
    await teamRemoves(c.id);
    const other = phone("removed-other2");
    await met(c.id, other);
    await bind(other);
    expect((await detail(c.id, other, other.secret)).body.canClaim).toBe(true);
    expect((await claim(c.id, other)).status).toBe(200);
  });

  it("the block is for that cat only", async () => {
    const { c, d } = await ownedCat("removed-cat");
    await teamRemoves(c.id);
    const c2 = await streetCat();
    await met(c2.id, d);
    expect((await claim(c2.id, d)).status).toBe(200);
  });

  it("an owner's own let-go is still 7 days, not 30", async () => {
    const { c, d } = await ownedCat("own-letgo");
    expect((await letGo(c.id, d)).status).toBe(200);
    // Back-date that let-go to 10 days: free again (a 30-day rule would still block).
    const [w] = await withdrawals(c.id);
    await db.execute(sql`alter table observations disable trigger user`);
    try {
      await db.update(observationsTable).set({ createdAt: daysAgo(10) }).where(eq(observationsTable.id, w!.id));
    } finally {
      await db.execute(sql`alter table observations enable trigger user`);
    }
    expect((await detail(c.id, d, d.secret)).body.canClaim).toBe(true);
  });
});
