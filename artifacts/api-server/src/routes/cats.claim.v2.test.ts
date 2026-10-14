import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  deviceCredentialsTable,
  observationsTable,
  pushTokensTable,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";
import { haversineKm } from "@workspace/geo";
import { deleteTestSightings } from "../test/sightings";

// SYC-130 Task 4: the claim route, `canClaim`, and the owner-only home note
// and pin (claiming-a-cat.md §3–§5, §8, §11, D9, D11, D13; review 2 HIGH-1,
// MEDIUM-9). Every test makes its own cat and its own phones, and uses dates
// relative to now.

// Consonants only: random hex can spell leetspeak ("a55") that the note
// filter rightly refuses, which made this setup flaky.
const safeTag = () => [...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("");
const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

// The logging test captures every line, with production's redaction and
// serialisers (as routes/me.delete.test.ts does).
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    {
      level: "trace",
      redact: actual.REDACT_PATHS,
      serializers: actual.LOG_SERIALIZERS,
    },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications")>();
  return { ...actual, notifyCatSpotters: vi.fn(actual.notifyCatSpotters) };
});

// Wrapped, so a test can see which executor the claim read the status
// through (§5: inside its own transaction).
vi.mock("../lib/claiming", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/claiming")>();
  return { ...actual, claimEligibility: vi.fn(actual.claimEligibility) };
});

// The resolve test uploads a sighting: no paid matcher, no per-address cap.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { sendPushNotification } from "../lib/push";
import { notifyCatSpotters } from "../lib/notifications";
import { claimEligibility, clearOwner } from "../lib/claiming";
import { blurPosition } from "../lib/blur";
import { WITHDRAWN, writeObservation } from "../lib/observations";
import { _resetClaimLimitForTests } from "../middlewares/rateLimit";

const pushMock = vi.mocked(sendPushNotification);
const notifyMock = vi.mocked(notifyCatSpotters);
const eligibilityMock = vi.mocked(claimEligibility);

const PREFIX = "vitest-claimv2-";
const NAME_PREFIX = "VitestClaimV2";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/** The cat's exact stored position. Its public cell centre is blurPosition(CAT). */
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
  eligibilityMock.mockClear();
  await _resetClaimLimitForTests();
});

type Phone = { id: string; secret: string };
function phone(label: string): Phone {
  const tag = randomBytes(4).toString("hex");
  return { id: `${PREFIX}${label}-${tag}`, secret: `${PREFIX}secret-${label}-${tag}` };
}

/** Binds the phone's secret (trust on first use), as the app does. */
async function bind(p: Phone) {
  const res = await request(app).get(`/api/profiles/${p.id}/username`).set("X-Device-Secret", p.secret);
  expect(res.status).toBe(200);
}

async function streetCat(over: Partial<typeof catsTable.$inferInsert> = {}) {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${randomBytes(4).toString("hex")}`,
      description: "",
      primaryPhotoId: 0,
      lat: CAT.lat,
      lng: CAT.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
      ...over,
    })
    .returning();
  return c!;
}

/** A resolved sighting of the cat from this phone, matched by confirming
 * the suggestion (§3 rule 2), with a push token so fan-outs reach it. */
async function met(catId: number, p: Phone) {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      catId,
      deviceId: p.id,
      photoId: 0,
      lat: CAT.lat,
      lng: CAT.lng,
      status: "resolved",
      createdAt: daysAgo(5),
    })
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
const body = (deviceId: string, over: Record<string, unknown> = {}) => ({
  deviceId,
  livesOnSyros: true,
  livesInMyHome: true,
  homePin: { lat: PUBLIC.lat + 0.001, lng: PUBLIC.lng + 0.001 },
  homeNote: "Blue door",
  ...over,
});
const claim = (catId: number, p: Phone, over: Record<string, unknown> = {}) =>
  request(app).post(`/api/cats/${catId}/claim`).set("X-Device-Secret", p.secret).send(body(p.id, over));

const reload = async (catId: number) =>
  (await db.select().from(catsTable).where(eq(catsTable.id, catId)))[0]!;
const homedObservations = (catId: number) =>
  db
    .select()
    .from(observationsTable)
    .where(
      and(
        eq(observationsTable.catId, catId),
        eq(observationsTable.kind, "life_status"),
        sql`${observationsTable.value}->>'status' = 'homed'`,
      ),
    );

/** What letting go does (Task 5 adds the route): a withdrawal that
 * supersedes the owner's homed, and the owner cleared. */
async function letGo(catId: number, p: Phone) {
  const [homed] = await homedObservations(catId);
  await writeObservation(db, {
    catId,
    kind: "life_status",
    value: WITHDRAWN,
    allowWithdrawal: true,
    deviceId: p.id,
    roleAtTime: "public",
    authorityScope: "owner_of_this_cat",
    observedAt: new Date(),
    supersedesId: homed!.id,
    supersedeReason: "owner: doesn't live with me any more",
  });
  await clearOwner(db, catId);
}

/** A proven phone (or not) looking at the cat's page. */
const detail = (catId: number, p?: Phone, secret?: string) => {
  const r = request(app).get(`/api/cats/${catId}`);
  if (p) r.set("X-Device-Id", p.id);
  if (secret) r.set("X-Device-Secret", secret);
  return r;
};

describe("POST /api/cats/:catId/claim (SYC-130)", () => {
  it("claims: writes homed, links the owner, stores the pin to 5 places and the note", async () => {
    const c = await streetCat();
    const d = phone("ok");
    await met(c.id, d);
    const pin = { lat: PUBLIC.lat + 0.0012345678, lng: PUBLIC.lng - 0.0009876543 };
    const res = await claim(c.id, d, { homePin: pin, homeNote: "  Blue door  " });
    expect(res.status).toBe(200);
    expect(res.body.hasHome).toBe(true);
    // The owner's own payload carries the note and pin.
    expect(res.body.homeDescription).toBe("Blue door");
    expect(res.body.homePin).toEqual({ lat: Number(pin.lat.toFixed(5)), lng: Number(pin.lng.toFixed(5)) });
    const row = await reload(c.id);
    expect(row.ownerDeviceId).toBe(d.id);
    expect(row.homeDescription).toBe("Blue door");
    expect(row.homeLat).toBe(Number(pin.lat.toFixed(5)));
    expect(row.homeLng).toBe(Number(pin.lng.toFixed(5)));
    const homed = await homedObservations(c.id);
    expect(homed).toHaveLength(1);
    expect(homed[0]).toMatchObject({
      deviceId: d.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
    });
  });

  it("an empty note is stored as null", async () => {
    const c = await streetCat();
    const d = phone("nonote");
    await met(c.id, d);
    const res = await claim(c.id, d, { homeNote: "   " });
    expect(res.status).toBe(200);
    expect((await reload(c.id)).homeDescription).toBeNull();
  });

  describe("order of checks: rules 1 and 2 before the confirmations and the pin (§3, §11)", () => {
    it("NOT_MET 403 before anything about the pin, whatever pin is sent", async () => {
      const c = await streetCat();
      const stranger = phone("stranger");
      for (const homePin of [{ lat: 0, lng: 0 }, { lat: PUBLIC.lat + 0.001, lng: PUBLIC.lng }, { lat: 37.47, lng: 24.94 }]) {
        const res = await claim(c.id, stranger, { homePin });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: expect.any(String), code: "NOT_MET" });
      }
      // Nor the confirmations: an unconfirmed claim from a stranger is still NOT_MET.
      const res = await claim(c.id, stranger, { livesOnSyros: false, homePin: { lat: 0, lng: 0 } });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_MET");
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
      expect(await homedObservations(c.id)).toHaveLength(0);
    });

    it("ALREADY_HOMED 409 for someone else's cat whatever pin is sent", async () => {
      const owner = phone("owner");
      const c = await streetCat();
      const d = phone("late");
      await met(c.id, d);
      await met(c.id, owner);
      expect((await claim(c.id, owner)).status).toBe(200);
      const res = await claim(c.id, d, { homePin: { lat: 0, lng: 0 }, livesInMyHome: false });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: expect.any(String), code: "ALREADY_HOMED" });
    });

    it("NOT_ON_STREET 409 for a cat the team says is in care, whatever pin is sent", async () => {
      const c = await streetCat();
      const d = phone("incare");
      await met(c.id, d);
      await writeObservation(db, {
        catId: c.id,
        kind: "life_status",
        value: { status: "in_care" },
        accountId: "system:legacy-backfill",
        roleAtTime: "staff",
        observedAt: daysAgo(1),
      });
      const res = await claim(c.id, d, { homePin: { lat: 0, lng: 0 } });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: expect.any(String), code: "NOT_ON_STREET" });
    });
  });

  it.each(["in_care", "deceased"])(
    "critic M1: an owned %s cat answers exactly as an ownerless one (no hidden-owner oracle)",
    async (status) => {
      const owner = phone("m1owner");
      const d = phone("m1");
      const owned = await streetCat();
      const ownerless = await streetCat();
      for (const c of [owned, ownerless]) await met(c.id, d);
      await met(owned.id, owner);
      expect((await claim(owned.id, owner)).status).toBe(200);
      for (const c of [owned, ownerless]) {
        await writeObservation(db, {
          catId: c.id,
          kind: "life_status",
          value: { status },
          accountId: "system:legacy-backfill",
          roleAtTime: "staff",
          observedAt: new Date(),
        });
      }
      // The public sees both the same way.
      expect((await detail(owned.id)).body.cat.hasHome).toBe(false);
      const a = await claim(owned.id, d);
      const b = await claim(ownerless.id, d);
      expect(a.status).toBe(409);
      expect(a.text).toBe(b.text);
      expect(a.body.code).toBe("NOT_ON_STREET");
    },
  );

  it("NOT_CONFIRMED 422 when either box is false or missing", async () => {
    const c = await streetCat();
    const d = phone("unconfirmed");
    await met(c.id, d);
    for (const over of [
      { livesOnSyros: false },
      { livesInMyHome: false },
      { livesOnSyros: undefined },
      { livesInMyHome: undefined },
    ]) {
      const res = await claim(c.id, d, over);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: expect.any(String), code: "NOT_CONFIRMED" });
    }
    expect((await reload(c.id)).ownerDeviceId).toBeNull();
  });

  it("PIN_TOO_FAR 422 with no distance or direction in the body: the same answer north and south", async () => {
    const c = await streetCat();
    const d = phone("far");
    await met(c.id, d);
    const north = await claim(c.id, d, { homePin: { lat: 37.47, lng: 24.94 } });
    const south = await claim(c.id, d, { homePin: { lat: 37.40, lng: 24.94 } });
    expect(north.status).toBe(422);
    expect(north.body).toEqual({ error: expect.any(String), code: "PIN_TOO_FAR" });
    expect(south.text).toBe(north.text);
    expect(north.text).not.toMatch(/\d/);
    expect((await reload(c.id)).ownerDeviceId).toBeNull();
  });

  it("measures from the public cell centre, never the exact position (D11)", async () => {
    // A pin 990 m from the cell centre, on the far side from the exact spot:
    // allowed, because only the public centre counts.
    const c = await streetCat();
    const d = phone("edge");
    await met(c.id, d);
    const dLat = 990 / 111_195; // metres per degree of latitude
    const away = PUBLIC.lat >= CAT.lat ? 1 : -1;
    const homePin = { lat: PUBLIC.lat + away * dLat, lng: PUBLIC.lng };
    // The test only means something if the exact spot is out of reach.
    expect(haversineKm(CAT, homePin) * 1000).toBeGreaterThan(1000);
    const res = await claim(c.id, d, { homePin });
    expect(res.status).toBe(200);
  });

  it("400 for a pin that isn't a position, before anything is stored", async () => {
    const c = await streetCat();
    const d = phone("badpin");
    await met(c.id, d);
    for (const homePin of [
      { lat: 200, lng: 0 },
      { lat: -91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 0, lng: -180.5 },
      { lat: "37.44", lng: 24.94 },
      { lat: 37.44 },
      { lng: 24.94 },
      null,
      undefined,
      "37.44,24.94",
    ]) {
      const res = await claim(c.id, d, { homePin });
      expect(res.status, JSON.stringify(homePin)).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request" });
    }
    const row = await reload(c.id);
    expect(row.ownerDeviceId).toBeNull();
    expect(row.homeLat).toBeNull();
  });

  it("critic L3: a confirmation of the wrong type is a plain 400, not NOT_CONFIRMED", async () => {
    const c = await streetCat();
    const d = phone("wrongtype");
    await met(c.id, d);
    for (const over of [{ livesOnSyros: "true" }, { livesInMyHome: 1 }, { livesOnSyros: null }]) {
      const res = await claim(c.id, d, over);
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request" });
    }
  });

  it("nit: a note of only invisible characters is stored as null, at the claim and at PATCH", async () => {
    const invisible = "\u200B\u200C\u2060\uFEFF \u200D";
    const c = await streetCat();
    const d = phone("invisible");
    await met(c.id, d);
    const res = await claim(c.id, d, { homeNote: invisible });
    expect(res.status).toBe(200);
    expect((await reload(c.id)).homeDescription).toBeNull();
    expect(res.body.homeDescription).toBeNull();

    // A real note, then PATCHed to invisible-only: cleared, not kept invisible.
    const patch = (homeDescription: string) =>
      request(app)
        .patch(`/api/cats/${c.id}`)
        .set("X-Device-Secret", d.secret)
        .send({ deviceId: d.id, homeDescription });
    expect((await patch("Green gate")).status).toBe(200);
    expect((await reload(c.id)).homeDescription).toBe("Green gate");
    expect((await patch(invisible)).status).toBe(200);
    expect((await reload(c.id)).homeDescription).toBeNull();
  });

  it("PATCH by a phone that isn't the owner is 403 with code NOT_OWNER (the app reads the code)", async () => {
    const c = await streetCat();
    const d = phone("patchowner");
    await met(c.id, d);
    expect((await claim(c.id, d)).status).toBe(200);
    const other = phone("patchother");
    await request(app).get(`/api/profiles/${other.id}/username`).set("X-Device-Secret", other.secret);
    const res = await request(app)
      .patch(`/api/cats/${c.id}`)
      .set("X-Device-Secret", other.secret)
      .send({ deviceId: other.id, homeDescription: "mine now" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Only the cat's owner can update it", code: "NOT_OWNER" });
    expect((await reload(c.id)).homeDescription).not.toBe("mine now");
  });

  it("a note longer than 200 characters is a 400", async () => {
    const c = await streetCat();
    const d = phone("longnote");
    await met(c.id, d);
    const res = await claim(c.id, d, { homeNote: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("an offensive note is refused, and nothing is stored", async () => {
    const c = await streetCat();
    const d = phone("rude");
    await met(c.id, d);
    const res = await claim(c.id, d, { homeNote: "malakas lives here" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NOTE");
    expect((await reload(c.id)).ownerDeviceId).toBeNull();
  });

  it("same owner again: 200, no second observation, no push, nothing changed", async () => {
    const c = await streetCat();
    const d = phone("again");
    await met(c.id, d);
    expect((await claim(c.id, d)).status).toBe(200);
    notifyMock.mockClear();
    const before = await reload(c.id);
    const res = await claim(c.id, d, { homeNote: "Different", homePin: { lat: PUBLIC.lat, lng: PUBLIC.lng } });
    expect(res.status).toBe(200);
    expect(res.body.locationPrecision).toBe("exact");
    expect(await homedObservations(c.id)).toHaveLength(1);
    expect(notifyMock).not.toHaveBeenCalled();
    const after = await reload(c.id);
    expect(after.homeDescription).toBe(before.homeDescription);
    expect(after.homeLat).toBe(before.homeLat);
  });

  it("first claim pushes without the note or pin; a later claim of the same cat after let-go pushes nothing", async () => {
    const c = await streetCat();
    const d = phone("first");
    const spotter = phone("spotter");
    await met(c.id, d);
    await met(c.id, spotter);
    const note = NOTE();
    const res = await claim(c.id, d, { homeNote: note });
    expect(res.status).toBe(200);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    const sent = JSON.stringify([notifyMock.mock.calls, pushMock.mock.calls]);
    expect(sent).toContain("cat_claimed");
    expect(sent).not.toContain(note);
    expect(sent).not.toContain("Blue door");
    expect(sent).not.toContain(String((await reload(c.id)).homeLat));
    expect(pushMock.mock.calls.map(([token]) => token)).toEqual([`tok-${spotter.id}`]);

    // Let go, wait out the cooldown, and claim again: no second announcement.
    await letGo(c.id, d);
    const other = phone("second");
    await met(c.id, other);
    notifyMock.mockClear();
    pushMock.mockClear();
    const again = await claim(c.id, other);
    expect(again.status).toBe(200);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("re-claiming the same cat within 7 days of letting it go is 429 CLAIM_COOLDOWN; after 7 days it succeeds", async () => {
    const c = await streetCat();
    const d = phone("cooldown");
    await met(c.id, d);
    expect((await claim(c.id, d)).status).toBe(200);
    await letGo(c.id, d);
    const res = await claim(c.id, d);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: expect.any(String), code: "CLAIM_COOLDOWN" });
    expect((await reload(c.id)).ownerDeviceId).toBeNull();

    // A different cat isn't held back by it.
    const c2 = await streetCat();
    await met(c2.id, d);
    expect((await claim(c2.id, d)).status).toBe(200);

    // Eight days on (the withdrawal written eight days ago instead).
    const c3 = await streetCat();
    const d3 = phone("cooldown-old");
    await met(c3.id, d3);
    expect((await claim(c3.id, d3)).status).toBe(200);
    const [homed] = await homedObservations(c3.id);
    await db.insert(observationsTable).values({
      catId: c3.id,
      kind: "life_status",
      value: WITHDRAWN,
      deviceId: d3.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: daysAgo(8),
      createdAt: daysAgo(8),
      supersedesId: homed!.id,
    });
    await clearOwner(db, c3.id);
    expect((await claim(c3.id, d3)).status).toBe(200);
  });

  describe("the claim limit: 5 attempts per phone per 24 hours, refusals included (§11)", () => {
    it("the 6th attempt is 429, even after 5 refusals", async () => {
      const c = await streetCat();
      const d = phone("limit");
      await met(c.id, d);
      for (let i = 0; i < 5; i++) {
        const res = await claim(c.id, d, { livesOnSyros: false });
        expect(res.status).toBe(422);
      }
      const res = await claim(c.id, d);
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: expect.any(String), code: "CLAIM_LIMIT" });
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
    });

    it("when the counter itself is broken the claim limit fails closed: 503 + Retry-After (SYC-105)", async () => {
      const c = await streetCat();
      const d = phone("limitbroken");
      await met(c.id, d);
      await db.execute(sql`alter table rate_limit_counters rename to rate_limit_counters_gone`);
      try {
        const res = await claim(c.id, d);
        expect(res.status).toBe(503);
        expect(res.headers["retry-after"]).toBe("5");
        expect((await reload(c.id)).ownerDeviceId).toBeNull();
      } finally {
        await db.execute(sql`alter table rate_limit_counters_gone rename to rate_limit_counters`);
      }
    });

    it("NOT_MET and PIN_TOO_FAR refusals count too", async () => {
      const c = await streetCat();
      const d = phone("limit2");
      const elsewhere = await streetCat();
      await met(c.id, d);
      for (let i = 0; i < 3; i++) expect((await claim(elsewhere.id, d)).status).toBe(403);
      for (let i = 0; i < 2; i++) expect((await claim(c.id, d, { homePin: { lat: 37.47, lng: 24.94 } })).status).toBe(422);
      expect((await claim(c.id, d)).status).toBe(429);
    });

    it("critic L1: the owner's retries are never counted and never 429 (§3 rule 4)", async () => {
      const c = await streetCat();
      const d = phone("retry");
      await met(c.id, d);
      expect((await claim(c.id, d)).status).toBe(200);
      for (let i = 0; i < 6; i++) {
        const res = await claim(c.id, d);
        expect(res.status, `retry ${i + 1}`).toBe(200);
        expect(res.body.locationPrecision).toBe("exact");
      }
      expect(await homedObservations(c.id)).toHaveLength(1);
      // Refusals still count: after 4 more (5 with the first claim), the next is 429.
      const other = await streetCat();
      for (let i = 0; i < 4; i++) expect((await claim(other.id, d)).status).toBe(403);
      expect((await claim(other.id, d)).status).toBe(429);
    });

    it("is per phone: another phone still has its own five", async () => {
      const c = await streetCat();
      const a = phone("limit-a");
      const b = phone("limit-b");
      await met(c.id, b);
      for (let i = 0; i < 6; i++) await claim(c.id, a);
      expect((await claim(c.id, b)).status).toBe(200);
    });
  });

  describe("device identity", () => {
    it("a wrong secret is 403 from the secret check, and nothing is stored or counted", async () => {
      const c = await streetCat();
      const d = phone("wrongsecret");
      await bind(d);
      await met(c.id, d);
      const res = await request(app)
        .post(`/api/cats/${c.id}/claim`)
        .set("X-Device-Secret", `${d.secret}-not`)
        .send(body(d.id));
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Device secret does not match" });
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
      expect(eligibilityMock).not.toHaveBeenCalled();
      expect(notifyMock).not.toHaveBeenCalled();
    });

    it("no secret is 401", async () => {
      const c = await streetCat();
      const d = phone("nosecret");
      await met(c.id, d);
      const res = await request(app).post(`/api/cats/${c.id}/claim`).send(body(d.id));
      expect(res.status).toBe(401);
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
    });

    it("eligibility is asked only about the proven device", async () => {
      const c = await streetCat();
      const d = phone("proven");
      await met(c.id, d);
      expect((await claim(c.id, d)).status).toBe(200);
      expect(eligibilityMock).toHaveBeenCalled();
      for (const [, input] of eligibilityMock.mock.calls) expect(input).toEqual({ catId: c.id, deviceId: d.id });
    });
  });

  describe("the transaction (§5)", () => {
    it("re-checks eligibility through its own transaction, not the pool", async () => {
      const c = await streetCat();
      const d = phone("tx");
      await met(c.id, d);
      expect((await claim(c.id, d)).status).toBe(200);
      const execs = eligibilityMock.mock.calls.map(([exec]) => exec);
      expect(execs.length).toBeGreaterThanOrEqual(2);
      expect(execs.some((e) => e !== db)).toBe(true);
    });

    it("locks the cat row: a team statement committed while the claim waits wins", async () => {
      const c = await streetCat();
      const d = phone("lock");
      await met(c.id, d);
      let pending: Promise<request.Response> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(sql`select id from cats where id = ${c.id} for update`);
        pending = claim(c.id, d).then((r) => r);
        // Wait until the claim is blocked on this row.
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
        await writeObservation(tx, {
          catId: c.id,
          kind: "life_status",
          value: { status: "in_care" },
          accountId: "system:legacy-backfill",
          roleAtTime: "staff",
          observedAt: new Date(),
        });
      });
      const res = await pending!;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_ON_STREET");
      expect((await reload(c.id)).ownerDeviceId).toBeNull();
      expect(await homedObservations(c.id)).toHaveLength(0);
    });

    it("lets only one of two concurrent claims win", async () => {
      const c = await streetCat();
      const a = phone("race-a");
      const b = phone("race-b");
      await met(c.id, a);
      await met(c.id, b);
      const [r1, r2] = await Promise.all([claim(c.id, a), claim(c.id, b)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect(await homedObservations(c.id)).toHaveLength(1);
    });
  });

  it("the claim body is never logged: no note, no pin", async () => {
    const c = await streetCat();
    const d = phone("log");
    await met(c.id, d);
    const note = NOTE();
    const pin = { lat: PUBLIC.lat + 0.00123, lng: PUBLIC.lng + 0.00234 };
    spies.logLines.length = 0;
    // Every path: invalid, refused, too far, and a success.
    await claim(c.id, d, { homePin: { lat: 200, lng: pin.lng }, homeNote: note });
    await claim(c.id, d, { livesOnSyros: false, homePin: pin, homeNote: note });
    await claim(c.id, d, { homePin: { lat: 37.47123, lng: 24.94321 }, homeNote: note });
    expect((await claim(c.id, d, { homePin: pin, homeNote: note })).status).toBe(200);
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalled());
    const text = spies.logLines.join("\n");
    expect(text).toContain("/claim");
    expect(text).not.toContain(note);
    for (const v of [pin.lat, pin.lng, 37.47123, 24.94321, CAT.lat, CAT.lng]) {
      expect(text).not.toContain(String(v));
      expect(text).not.toContain(v.toFixed(5));
    }
  });
});

describe("the home note and pin never leave the owner (D9)", () => {
  async function ownedCat() {
    const c = await streetCat({ ownerName: "Maria" });
    const d = phone("owned");
    await met(c.id, d);
    const note = NOTE();
    expect((await claim(c.id, d, { homeNote: note })).status).toBe(200);
    return { c, d, note };
  }

  it("the public detail has neither; the proven owner's has both", async () => {
    const { c, d, note } = await ownedCat();
    const pub = await detail(c.id);
    expect(pub.status).toBe(200);
    expect(pub.body.cat.hasHome).toBe(true);
    expect(pub.body.cat.homeDescription).toBeNull();
    expect(pub.body.cat.homePin).toBeNull();
    expect(pub.body.cat.ownerName).toBeNull();
    expect(pub.text).not.toContain(note);

    // The owner's id without its secret is still the public view.
    const unproven = await detail(c.id, d);
    expect(unproven.body.cat.homeDescription).toBeNull();
    expect(unproven.body.cat.homePin).toBeNull();

    const own = await detail(c.id, d, d.secret);
    expect(own.body.cat.homeDescription).toBe(note);
    expect(own.body.cat.homePin).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(own.body.cat.ownerName).toBe("Maria");
  });

  it("the list (GET /cats) has neither", async () => {
    const { c, note } = await ownedCat();
    const res = await request(app).get("/api/cats").query({ pageSize: 100, lat: CAT.lat, lng: CAT.lng });
    expect(res.status).toBe(200);
    const entry = (res.body.cats as { id: number }[]).find((x) => x.id === c.id) as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry.homeDescription).toBeNull();
    expect(entry.homePin).toBeNull();
    expect(entry.ownerName).toBeNull();
    expect(res.text).not.toContain(note);
  });

  it("the resolve response's cat has neither", async () => {
    const { c, note } = await ownedCat();
    const s = phone("resolver");
    const up = await request(app)
      .post("/api/sightings")
      .set("X-Device-Secret", s.secret)
      .send({
        deviceId: s.id,
        lat: CAT.lat,
        lng: CAT.lng,
        photoBase64: TINY_JPEG_B64,
        capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
      });
    expect(up.status).toBe(201);
    const res = await request(app)
      .post(`/api/sightings/${up.body.sightingId}/resolve`)
      .set("X-Device-Secret", s.secret)
      .send({ deviceId: s.id, catId: c.id });
    expect(res.status).toBe(200);
    expect(res.body.cat.id).toBe(c.id);
    expect(res.body.cat.homeDescription).toBeNull();
    expect(res.body.cat.homePin).toBeNull();
    expect(res.body.cat.ownerName).toBeNull();
    expect(res.text).not.toContain(note);
  });
});

describe("canClaim on the cat's page (§4.1, §11)", () => {
  it("is true only for a proven device that may claim", async () => {
    const c = await streetCat();
    const d = phone("can");
    const stranger = phone("cannot");
    await bind(d);
    await bind(stranger);
    await met(c.id, d);

    expect((await detail(c.id)).body.canClaim).toBe(false);
    // The met phone's id with no secret, or the wrong one, proves nothing.
    expect((await detail(c.id, d)).body.canClaim).toBe(false);
    expect((await detail(c.id, d, stranger.secret)).body.canClaim).toBe(false);
    expect((await detail(c.id, stranger, stranger.secret)).body.canClaim).toBe(false);
    expect((await detail(c.id, d, d.secret)).body.canClaim).toBe(true);

    // Once it's theirs, they can't claim it again (they edit it instead).
    expect((await claim(c.id, d)).status).toBe(200);
    expect((await detail(c.id, d, d.secret)).body.canClaim).toBe(false);
  });

  it("critic M2: false within 7 days of this phone letting the cat go, true after", async () => {
    const c = await streetCat();
    const d = phone("canletgo");
    await bind(d);
    await met(c.id, d);
    expect((await claim(c.id, d)).status).toBe(200);
    await letGo(c.id, d);
    expect((await detail(c.id, d, d.secret)).body.canClaim).toBe(false);
    // Another phone that has met it is unaffected.
    const other = phone("canletgo-other");
    await bind(other);
    await met(c.id, other);
    expect((await detail(c.id, other, other.secret)).body.canClaim).toBe(true);

    // A withdrawal written eight days ago no longer holds the phone back.
    const c2 = await streetCat();
    const d2 = phone("canletgo-old");
    await bind(d2);
    await met(c2.id, d2);
    expect((await claim(c2.id, d2)).status).toBe(200);
    const [homed] = await homedObservations(c2.id);
    await db.insert(observationsTable).values({
      catId: c2.id,
      kind: "life_status",
      value: WITHDRAWN,
      deviceId: d2.id,
      roleAtTime: "public",
      authorityScope: "owner_of_this_cat",
      observedAt: daysAgo(8),
      createdAt: daysAgo(8),
      supersedesId: homed!.id,
    });
    await clearOwner(db, c2.id);
    expect((await detail(c2.id, d2, d2.secret)).body.canClaim).toBe(true);
  });

  it("critic M2: the 24-hour attempt limit does not turn canClaim off", async () => {
    const c = await streetCat();
    const d = phone("canlimit");
    await bind(d);
    await met(c.id, d);
    for (let i = 0; i < 6; i++) await claim(c.id, d, { livesOnSyros: false });
    expect((await claim(c.id, d)).status).toBe(429);
    expect((await detail(c.id, d, d.secret)).body.canClaim).toBe(true);
  });

  it("never binds a secret: looking doesn't register a phone", async () => {
    const c = await streetCat();
    const d = phone("nobind");
    await met(c.id, d);
    expect((await detail(c.id, d, d.secret)).body.canClaim).toBe(false);
    const rows = await db.select().from(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, d.id));
    expect(rows).toHaveLength(0);
  });
});

describe("PATCH /api/cats/:catId: the owner's note (invariant 7)", () => {
  it("moderates the note and stores nothing offensive", async () => {
    const c = await streetCat();
    const d = phone("patchrude");
    await met(c.id, d);
    expect((await claim(c.id, d)).status).toBe(200);
    notifyMock.mockClear();
    const res = await request(app)
      .patch(`/api/cats/${c.id}`)
      .set("X-Device-Secret", d.secret)
      .send({ deviceId: d.id, homeDescription: "malakas lives here" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OFFENSIVE_NOTE");
    expect((await reload(c.id)).homeDescription).toBe("Blue door");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("never pushes the note", async () => {
    const c = await streetCat();
    const d = phone("patchnote");
    const spotter = phone("patchspotter");
    await met(c.id, d);
    await met(c.id, spotter);
    expect((await claim(c.id, d)).status).toBe(200);
    notifyMock.mockClear();
    pushMock.mockClear();
    const note = NOTE();
    const res = await request(app)
      .patch(`/api/cats/${c.id}`)
      .set("X-Device-Secret", d.secret)
      .send({ deviceId: d.id, homeDescription: note });
    expect(res.status).toBe(200);
    expect(res.body.homeDescription).toBe(note);
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(JSON.stringify([notifyMock.mock.calls, pushMock.mock.calls])).not.toContain(note);
  });
});

describe("caching: per-phone answers are never stored by a shared cache", () => {
  it("GET /cats/:id with X-Device-Id is private, no-store, proven or not, and varies on the phone", async () => {
    const c = await streetCat();
    const d = phone("cache");
    await bind(d);
    await met(c.id, d);
    for (const res of [await detail(c.id, d, d.secret), await detail(c.id, d)]) {
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["vary"]).toMatch(/x-device-id/i);
    }
    expect((await claim(c.id, d)).status).toBe(200);
    const own = await detail(c.id, d, d.secret);
    expect(own.body.cat.locationPrecision).toBe("exact");
    expect(own.headers["cache-control"]).toBe("private, no-store");
    // The anonymous public page is the same for everyone; it still tells a
    // cache that a phone's headers change the answer.
    const anon = await detail(c.id);
    expect(anon.headers["cache-control"] ?? "").not.toMatch(/no-store/);
    expect(anon.headers["vary"]).toMatch(/x-device-id/i);
  });

  it("claim and PATCH responses are private, no-store, refusals included", async () => {
    const c = await streetCat();
    const d = phone("cache-claim");
    await met(c.id, d);
    const refused = await claim(c.id, d, { livesOnSyros: false });
    expect(refused.status).toBe(422);
    expect(refused.headers["cache-control"]).toBe("private, no-store");
    const ok = await claim(c.id, d);
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    const patched = await request(app)
      .patch(`/api/cats/${c.id}`)
      .set("X-Device-Secret", d.secret)
      .send({ deviceId: d.id, homeDescription: "Red door" });
    expect(patched.status).toBe(200);
    expect(patched.headers["cache-control"]).toBe("private, no-store");
  });
});

describe("POST /api/cats (removed, D7)", () => {
  it("returns 404", async () => {
    const res = await request(app)
      .post("/api/cats")
      .send({
        deviceId: "test-device",
        name: "Test Cat",
        ownerName: "Test Owner",
        homeDescription: "Test",
        lat: 37.44,
        lng: 24.9,
      });
    expect(res.status).toBe(404);
  });
});
