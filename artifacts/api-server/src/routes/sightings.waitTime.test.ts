/**
 * SYC-795 (launch-measures-report-design.md §4.4): the server's part of a
 * spotter's wait for look-alikes, from the request arriving to the match
 * record being written. Stored once, on the first check that worked, so a
 * resend or a recheck never shortens or lengthens the wait already recorded.
 *
 * Works far out at sea, like sightings.matchRecord.test.ts, so no cat seeded
 * by another test file is ever within 500 m. No assertion reads the wall
 * clock: a measured wait is only checked to be there and not negative, and
 * a kept wait is planted by SQL first.
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
  sightingMatchesTable,
  profilesTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";
import { type LatLng } from "@workspace/geo";
import { blurPosition } from "../lib/blur";

const { matchCatPhoto } = vi.hoisted(() => ({ matchCatPhoto: vi.fn() }));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
// The per-IP budget has its own tests (rateLimit.test.ts); this file's
// uploads all come from supertest's one local IP.
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { nameTag } from "../test/nameTag";

const DEVICE = "vitest-waittime-device";
const CAT_PREFIX = "VitestWaitTimeCat";
const SECRET = "vitest-waittime-secret-0123456789abcd";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let spots = 0;
/** Open sea south-east of Syros, about 5 km apart per test. */
function spot(): LatLng {
  return blurPosition(37.2, 25.1 + ++spots * 0.06);
}

let seq = 0;
async function seedCat(at: LatLng): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${++seq}-${nameTag()}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: at.lat,
      lng: at.lng,
      discovererDeviceId: `${DEVICE}-seed`,
    })
    .returning();
  return c!.id;
}

let tick = 0;
/** Send a spot; a repeat with the same capturedAt is the dedupe-hit path. */
async function send(device: string, at: LatLng, capturedAt: string) {
  const res = await request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, lat: at.lat, lng: at.lng, photoBase64: TINY_JPEG_B64, capturedAt });
  expect(res.status, `send refused: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.sightingId as number;
}

/** A capture instant of its own for each spot, a few minutes back. */
const nextCapturedAt = () => new Date(Date.now() - 300_000 + ++tick * 1000).toISOString();

function recheck(sightingId: number, device: string) {
  return request(app)
    .post(`/api/sightings/${sightingId}/recheck`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device });
}

async function serverWait(sightingId: number): Promise<number | null | undefined> {
  const [row] = await db
    .select({ serverWaitMs: sightingMatchesTable.serverWaitMs })
    .from(sightingMatchesTable)
    .where(eq(sightingMatchesTable.sightingId, sightingId));
  return row?.serverWaitMs;
}

async function plantServerWait(sightingId: number, ms: number) {
  await db
    .update(sightingMatchesTable)
    .set({ serverWaitMs: ms })
    .where(eq(sightingMatchesTable.sightingId, sightingId));
}

const fails = () => matchCatPhoto.mockRejectedValueOnce(new Error("Connection error."));
const finds = (catId: number) =>
  matchCatPhoto.mockResolvedValueOnce({
    isCatPhoto: true,
    matches: [{ catId, confidence: 0.9, reasoning: "test" }],
  });

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  const rows = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  if (rows.length > 0) {
    await db
      .delete(sightingMatchesTable)
      .where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
  }
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  if (cats.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
beforeEach(() => {
  matchCatPhoto.mockReset();
  matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, matches: [] }));
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("the server's part of the wait (SYC-795 §4.4)", () => {
  it("records the server wait on a first successful match", async () => {
    const at = spot();
    finds(await seedCat(at));
    const id = await send(`${DEVICE}-first`, at, nextCapturedAt());

    const ms = await serverWait(id);
    expect(ms).not.toBeNull();
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("a resend of the same photos keeps the first server wait", async () => {
    const at = spot();
    const device = `${DEVICE}-resend`;
    const cat = await seedCat(at);
    const capturedAt = nextCapturedAt();
    finds(cat);
    const id = await send(device, at, capturedAt);
    await plantServerWait(id, 1234);

    finds(cat);
    const again = await send(device, at, capturedAt);

    expect(again).toBe(id);
    expect(await serverWait(id)).toBe(1234);
  });

  it("a failed first match leaves it null, and a successful recheck fills it", async () => {
    const at = spot();
    const device = `${DEVICE}-recheck`;
    const cat = await seedCat(at);
    fails();
    const id = await send(device, at, nextCapturedAt());
    // A row exists (the failure is recorded), with no wait on it.
    expect(await serverWait(id)).toBeNull();

    finds(cat);
    const res = await recheck(id, device);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.matchCheck).toBe("done");

    const ms = await serverWait(id);
    expect(ms).not.toBeNull();
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("a match after a choice changes nothing", async () => {
    const at = spot();
    const device = `${DEVICE}-chosen`;
    const cat = await seedCat(at);
    const capturedAt = nextCapturedAt();
    finds(cat);
    const id = await send(device, at, capturedAt);
    const resolved = await request(app)
      .post(`/api/sightings/${id}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device, catId: cat });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    await plantServerWait(id, 1234);

    finds(cat);
    expect(await send(device, at, capturedAt)).toBe(id);

    expect(await serverWait(id)).toBe(1234);
  });
});
