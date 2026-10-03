/**
 * Data spine PR 5 — matching hardening (DECISIONS.md Part 2h; the plan's PR 5,
 * docs/superpowers/plans/data-spine.md). SYC-39's exact-position 500 m
 * matching is kept (its own tests live in sightings.radius.test.ts and
 * candidateSelection.test.ts); this file covers the three protections PR 5
 * adds on top of it:
 *
 *   1. The candidate-matching rate limit counts per device, not per IP
 *      (§6.3 point 2).
 *   2. A candidate below the confidence threshold comes back with no catId
 *      and no name (§6.3 point 3).
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

  it("a low-confidence candidate has no id or name", async () => {
    const strong = await insertCatAt("Strong", 50);
    const weak = await insertCatAt("Weak", 60);

    matchCatPhoto.mockImplementationOnce(async (_photo, candidates: { catId: number }[]) => ({
      isCatPhoto: true,
      matches: candidates.map((c) => ({
        catId: c.catId,
        // Below CONFIDENCE_THRESHOLD (0.4) but above the 0.1 noise floor, so
        // it is still offered — just without anything that names the cat.
        confidence: c.catId === strong.id ? 0.8 : 0.2,
        reasoning: "test",
      })),
    }));

    const res = await submit(`${PREFIX}confidence-device`);
    expect(res.status).toBe(201);

    const byConfidence = (res.body.candidates as any[]).sort(
      (a, b) => b.confidence - a.confidence,
    );
    expect(byConfidence[0]).toMatchObject({ catId: strong.id, name: strong.name });
    expect(byConfidence[1]).toMatchObject({
      catId: null,
      name: null,
      photoUrl: null,
      confidence: 0.2,
    });
    expect(weak.id).toBeTypeOf("number"); // sanity: fixture really has an id
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
});
