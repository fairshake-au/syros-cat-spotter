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

// SYC-39 (DECISIONS.md, 30 Sep 2026): POST /sightings only compares the photo
// with cats whose stored position is within 500 m of the sighting, by exact
// distance. The matcher is mocked so we can see exactly which cats it was
// asked to compare, and control what it answers.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async (_photo: string, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({
      catId: c.catId,
      confidence: 0.9,
      reasoning: "test",
    })),
  })),
}));

import { matchCatPhoto } from "../lib/matching";
import app from "../app";

const matchMock = vi.mocked(matchCatPhoto);

const PREFIX = "vitest-radius-";
const NAME_PREFIX = "VitestRadiusCat";

// Far from every other fixture (they sit around 37.44, 24.9), so cats other
// test files leave behind can never fall inside this 500 m circle.
const ORIGIN = { lat: 36.1, lng: 23.1 };
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
  matchMock.mockClear();
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

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

function submit(deviceId: string) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", `vitest-secret-${deviceId}-0123456789`)
    .send({
      deviceId,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      photoBase64: TINY_JPEG_B64,
    });
}

function comparedCatIds(): number[] {
  expect(matchMock).toHaveBeenCalledTimes(1);
  return matchMock.mock.calls[0]![1].map((c) => c.catId);
}

describe("POST /api/sightings compares only cats within 500 m (SYC-39)", () => {
  it("offers a cat 499 m away and never a cat 501 m away", async () => {
    const near = await insertCatAt("Near", 499);
    const far = await insertCatAt("Far", 501);

    const res = await submit(`${PREFIX}a`);
    expect(res.status).toBe(201);

    expect(comparedCatIds()).toEqual([near.id]);
    expect(res.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([
      near.id,
    ]);
    expect(
      res.body.candidates.some((c: { catId: number }) => c.catId === far.id),
    ).toBe(false);
  });

  it("returns no candidates when no cat is within 500 m, so the app goes to 'add a new cat'", async () => {
    await insertCatAt("TooFar", 501);
    await insertCatAt("WayTooFar", 3_000);

    const res = await submit(`${PREFIX}b`);
    expect(res.status).toBe(201);
    expect(res.body.candidates).toEqual([]);
    // The matcher still runs with nothing to compare, so the "is this a
    // cat at all?" check keeps working.
    expect(comparedCatIds()).toEqual([]);
    expect(res.body.isCatPhoto).toBe(true);
    // The sighting is still stored, ready to become a new cat.
    const [row] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, res.body.sightingId));
    expect(row?.status).toBe("pending");
  });

  it("compares nearest first and at most ten, all within 500 m", async () => {
    const inside = [];
    for (let i = 0; i < 12; i++) {
      inside.push(await insertCatAt(`In${i}`, 480 - i * 40)); // 480 m down to 40 m
    }
    await insertCatAt("Out", 520);

    const res = await submit(`${PREFIX}c`);
    expect(res.status).toBe(201);

    const expected = [...inside].reverse().slice(0, 10).map((c) => c.id);
    expect(comparedCatIds()).toEqual(expected);
  });
});
