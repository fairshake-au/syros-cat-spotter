/**
 * Data spine PR 5 — matching hardening (DECISIONS.md Part 2h; the plan's PR 5,
 * docs/superpowers/plans/data-spine.md). SYC-39's exact-position 500 m
 * matching is kept (its own tests live in sightings.radius.test.ts and
 * candidateSelection.test.ts); this file covers the protections PR 5 adds on
 * top of it, plus the fixes from an adversarial review of PR #64:
 *
 *   1. The candidate-matching rate limit counts per device, not per IP
 *      (§6.3 point 2) — checked only after the device secret, never on the
 *      raw body.deviceId (review S5, mutant M6).
 *   2. A candidate below the confidence threshold is left out of the
 *      response entirely, not nulled-out-but-present (§6.3 point 3; review
 *      S1), including at the exact boundary (review S5, mutant M2).
 *   3. The response is never ordered by true distance — ties in confidence
 *      break on cat id (§6.3 point 3).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  sightingsTable,
  deviceCredentialsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

const { matchCatPhoto } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(async (_photo: string, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.9, reasoning: "test" })),
  })),
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
// This file's whole point is many requests (several per test, well past 20
// across the file) from supertest's one shared local IP, to prove the
// per-device limiter — not the IP — is what's actually being exercised.
// Review of PR #64 (B1) restored the real, IP-keyed `aiLimiter` on this
// route; without stubbing it out here the way sightings.matchRecord.test.ts
// already does, this file's own request volume would 429 against it well
// before any test finished, for a reason that has nothing to do with what
// each test is checking.
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { _resetDeviceMatchLimitForTests } from "../middlewares/rateLimit";

const PREFIX = "vitest-matchharden-";
const NAME_PREFIX = "VitestMatchHardenCat";

// Far out at sea so no other test file's fixtures land inside the 500 m
// radius (same trick as sightings.radius.test.ts and
// sightings.matchRecord.test.ts).
const ORIGIN = { lat: 35.2, lng: 22.4 };
const DEG_PER_METRE = 180 / (Math.PI * 6371 * 1000);

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const insertedPhotoIds: number[] = [];

async function cleanup() {
  const sightingRows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  const photoIds = [...insertedPhotoIds, ...sightingRows.map((r) => r.photoId)];
  if (photoIds.length) {
    await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  }
  insertedPhotoIds.length = 0;
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  matchCatPhoto.mockClear();
  _resetDeviceMatchLimitForTests();
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

function secretFor(deviceId: string): string {
  return `vitest-secret-${deviceId}-0123456789`;
}

let captureOffsetMs = 0;

function submit(deviceId: string, at: { lat: number; lng: number } = ORIGIN) {
  // Each call gets its own capturedAt, strictly in the past and strictly
  // increasing, so the dedupe lookup (§3.6) never treats two of these calls
  // as the same retried sighting.
  captureOffsetMs += 1000;
  const capturedAt = new Date(Date.now() - 86_400_000 - captureOffsetMs).toISOString();
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", secretFor(deviceId))
    .send({
      deviceId,
      lat: at.lat,
      lng: at.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt,
    });
}

async function insertCatAt(nameSuffix: string, metresNorth: number) {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  insertedPhotoIds.push(photo!.id);
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${nameSuffix}`,
      description: "",
      primaryPhotoId: photo!.id,
      lat: ORIGIN.lat + metresNorth * DEG_PER_METRE,
      lng: ORIGIN.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
    })
    .returning();
  return cat!;
}

describe("POST /api/sightings matching hardening (data spine PR 5)", () => {
  it("the per-device limit refuses the 21st request from one device and not a second device on the same IP", async () => {
    const device = `${PREFIX}limited-device`;
    const otherDevice = `${PREFIX}other-device`;

    for (let i = 0; i < 20; i++) {
      const res = await submit(device);
      expect(res.status).toBe(201);
    }

    const blocked = await submit(device);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "Too many requests. Please try again later.",
    });

    // supertest's requests all originate from the same local address, so
    // this proves the budget is keyed on the device, not the IP: a second
    // device sharing that address is not caught by the first device's limit.
    const otherRes = await submit(otherDevice);
    expect(otherRes.status).toBe(201);
  });

  // Review of PR #64 (S1): the first cut of this nulled catId/name/photoUrl
  // but still returned the candidate — confidence, and critically
  // `reasoning`, intact. Spec §6.3 point 3 says a below-threshold candidate
  // is "not returned ... at all", not "returned with some fields blanked".
  it("a below-threshold candidate is left out of the response entirely", async () => {
    const strong = await insertCatAt("Strong", 50);
    const weak = await insertCatAt("Weak", 60);

    matchCatPhoto.mockImplementationOnce(async (_photo, candidates: { catId: number }[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({
        catId: c.catId,
        // Below CONFIDENCE_THRESHOLD (0.4) but above the 0.1 noise floor —
        // compared, scored, but never shown.
        confidence: c.catId === strong.id ? 0.8 : 0.2,
        reasoning: "test",
      })),
    }));

    const res = await submit(`${PREFIX}confidence-device`);
    expect(res.status).toBe(201);

    // Not "present with nulled fields" — absent. Only the strong candidate
    // appears anywhere in the response at all.
    expect(res.body.candidates).toEqual([
      expect.objectContaining({ catId: strong.id, name: strong.name }),
    ]);
    expect(weak.id).toBeTypeOf("number"); // sanity: fixture really has an id
  });

  // Review of PR #64 (S1): the vision model's own `reasoning` routinely
  // echoes a candidate's name ("different coat from Agatha") — a nulled
  // catId/name doesn't stop that reasoning text, sitting right there in the
  // same response, from naming the cat anyway. Omitting the whole candidate
  // (above) is what actually closes this; this test asserts directly on the
  // serialised response body, so a regression that reintroduces a
  // below-threshold entry under some other key would still be caught.
  it("a weak candidate's reasoning, which can name the cat, appears nowhere in the response", async () => {
    const weak = await insertCatAt("NamedInReasoning", 50);

    matchCatPhoto.mockImplementationOnce(async (_photo, candidates: { catId: number }[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({
        catId: c.catId,
        confidence: 0.2,
        reasoning: `Different coat from ${weak.name}, but could be the same cat`,
      })),
    }));

    const res = await submit(`${PREFIX}reasoning-leak-device`);
    expect(res.status).toBe(201);
    expect(res.body.candidates).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(weak.name);
  });

  // Review of PR #64 (S5, mutant M2): locks in which side of the threshold
  // "below" means. The route's own comment says "at or above this threshold
  // a candidate is shown" (comment on CONFIDENCE_THRESHOLD, sightings.ts) —
  // this test fails if that boundary is ever flipped to `<=`.
  it("a candidate at exactly the confidence threshold is shown; just below it is not", async () => {
    const atThreshold = await insertCatAt("AtThreshold", 50);
    const justBelow = await insertCatAt("JustBelow", 60);

    matchCatPhoto.mockImplementationOnce(async (_photo, candidates: { catId: number }[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({
        catId: c.catId,
        confidence: c.catId === atThreshold.id ? 0.4 : 0.399,
        reasoning: "boundary",
      })),
    }));

    const res = await submit(`${PREFIX}boundary-device`);
    expect(res.status).toBe(201);
    expect(res.body.candidates).toEqual([
      expect.objectContaining({ catId: atThreshold.id, name: atThreshold.name }),
    ]);
  });

  it("two candidates with equal confidence come back in cat-id order whatever their distances", async () => {
    // Inserted far-first so the farther cat gets the SMALLER id — if the
    // response were ever ordered (or tie-broken) by true distance instead
    // of cat id, the nearer cat (the larger id) would come first.
    const far = await insertCatAt("Far", 400);
    const near = await insertCatAt("Near", 50);
    expect(far.id).toBeLessThan(near.id);

    matchCatPhoto.mockImplementationOnce(async (_photo, candidates: { catId: number }[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.75, reasoning: "tie" })),
    }));

    const res = await submit(`${PREFIX}tie-device`);
    expect(res.status).toBe(201);
    expect(res.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([
      far.id,
      near.id,
    ]);
  });

  // Review of PR #64 (S5, mutant M6): the per-device limit is checked only
  // after verifyDeviceSecret has proven the caller holds the device's
  // secret, keyed on the id it returns — never on the raw, unverified
  // body.deviceId. If the limit were ever checked earlier, or kept on the
  // body's deviceId regardless of the secret, an attacker who merely knows
  // (or guesses) a victim's device id could burn the victim's budget with
  // wrong-secret requests, without ever authenticating as them.
  it("wrong-secret requests naming a victim's device id do not use up the victim's budget", async () => {
    const victim = `${PREFIX}victim-device`;

    // Bind the victim's real secret first (TOFU, deviceAuth.ts) — otherwise
    // an attacker's "wrong" secret would be the one that binds, which is a
    // different attack (and one TOFU accepts: see SYC-92/SYC-107) from the
    // one this test is checking.
    const first = await submit(victim);
    expect(first.status).toBe(201);

    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post("/api/sightings")
        .set("X-Device-Secret", "wrong-secret-0123456789ab")
        .send({
          deviceId: victim,
          lat: ORIGIN.lat,
          lng: ORIGIN.lng,
          photoBase64: TINY_JPEG_B64,
          capturedAt: new Date(Date.now() - 86_400_000).toISOString(),
        });
      expect(res.status).toBe(403);
    }

    // The victim's own, correctly-authenticated requests still have their
    // full budget (minus the one spent above) — none of the 25 wrong-secret
    // attempts counted against it.
    for (let i = 0; i < 19; i++) {
      const res = await submit(victim);
      expect(res.status).toBe(201);
    }
    const blocked = await submit(victim);
    expect(blocked.status).toBe(429);
  });
});
