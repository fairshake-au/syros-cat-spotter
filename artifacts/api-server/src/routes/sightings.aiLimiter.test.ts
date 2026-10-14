/**
 * Review of PR #64 (B1): `aiLimiter` (the per-IP cost ceiling on paid OpenAI
 * vision calls) had been dropped from POST /sightings entirely when the
 * per-device limiter was added, leaving the route unlimited per IP as long
 * as an attacker minted a fresh device id per request (device ids are
 * free to mint — TOFU in deviceAuth.ts). Restored alongside the per-device
 * limiter in sightings.ts.
 *
 * Deliberately its own file, with `aiLimiter` not mocked: every other test
 * file touching this route stubs `aiLimiter` out
 * (sightings.matchHardening.test.ts, sightings.matchRecord.test.ts) because
 * their own request volumes would otherwise trip it for reasons unrelated
 * to what they're testing — which means none of them would notice if this
 * restoration were ever reverted. This file exists so that *something*
 * would fail if it were.
 *
 * SYC-301: `matchCatPhoto` IS mocked, to fail at once the way an unreachable
 * OpenAI does (the route then answers 201 with no candidates, as before). Left
 * real, each upload went to the dead test address and the OpenAI client's two
 * backoff retries cost ~1.3 s, so the 21 uploads took ~26.5 s of the 30 s
 * budget and timed out under load. The limiter is still the real one.
 */
import { deleteTestSightings } from "../test/sightings";
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
import { inArray, like } from "drizzle-orm";
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => {
    throw new Error("Connection error.");
  }),
}));

import app from "../app";
import { _resetDeviceMatchLimitForTests } from "../middlewares/rateLimit";
import { _resetNewDeviceLimitForTests } from "../middlewares/newDeviceLimit";

const PREFIX = "vitest-ailimiter-";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const insertedPhotoIds: number[] = [];

async function cleanup() {
  const sightingRows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${PREFIX}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  const photoIds = [...insertedPhotoIds, ...sightingRows.map((r) => r.photoId)];
  if (photoIds.length) {
    await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  }
  insertedPhotoIds.length = 0;
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.discovererDeviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  await _resetDeviceMatchLimitForTests();
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

function secretFor(deviceId: string): string {
  return `vitest-secret-${deviceId}-0123456789`;
}

let offsetMs = 0;
function submitFromDevice(deviceId: string) {
  offsetMs += 1000;
  const capturedAt = new Date(Date.now() - 86_400_000 - offsetMs).toISOString();
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", secretFor(deviceId))
    .send({
      deviceId,
      lat: 35.9,
      lng: 24.1,
      photoBase64: TINY_JPEG_B64,
      capturedAt,
    });
}

describe("POST /api/sightings per-IP cost ceiling (data spine PR 5, review of #64)", () => {
  it("refuses the 21st request from one IP even across 21 different devices", async () => {
    // Each device is used exactly once, so the per-device limiter (20 per
    // device) never has a reason to fire — if the 21st request is refused,
    // it can only be aiLimiter's per-IP budget (supertest's requests all
    // originate from one local address).
    // SYC-301: the new-device cap (SYC-195) is also 20 per address, so
    // without a fresh allowance before each upload the 21st new phone was
    // refused by that cap, and this test passed with aiLimiter removed. The
    // message tells the two 429s apart.
    for (let i = 0; i < 20; i++) {
      await _resetNewDeviceLimitForTests();
      const res = await submitFromDevice(`${PREFIX}device-${i}`);
      expect(res.status).toBe(201);
    }
    await _resetNewDeviceLimitForTests();
    const blocked = await submitFromDevice(`${PREFIX}device-20`);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "Too many requests. Please try again later.",
    });
  }, 30_000);
});
