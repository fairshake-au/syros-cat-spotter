import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, photosTable, sightingsTable, deviceCredentialsTable } from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";

// §3.6 of offline-queue-on-web.md / review finding F5: the server must not
// create a second sighting when a client retries a submission whose response
// it never saw. Keep the AI matcher out of these tests — only the dedupe
// lookup and row counts are under test.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const DEVICE = "vitest-dedupe-device";

// 1x1 white JPEG — small enough to skip the resize path, valid enough to
// clear validatePhotoBase64.
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function cleanup() {
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const r of rows) {
    await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  }
  await db
    .delete(deviceCredentialsTable)
    .where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

// SYC-92: POST /api/sightings now requires the device secret. TOFU binds
// the secret to whatever device id first presents it, so a fixed secret per
// device id (derived from the id, so different devices don't collide) is
// enough here — these tests aren't about auth, they're about dedupe.
function secretFor(deviceId: string): string {
  return `vitest-secret-${deviceId}-0123456789`;
}

function submit(deviceId: string, capturedAt?: string) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", secretFor(deviceId))
    .send({
      deviceId,
      lat: 37.44,
      lng: 24.9,
      photoBase64: TINY_JPEG_B64,
      ...(capturedAt ? { capturedAt } : {}),
    });
}

describe("POST /api/sightings dedupe (§3.6)", () => {
  it("(a) same device + same capturedAt twice creates one sighting row, and the second response carries the same sightingId", async () => {
    const device = `${DEVICE}-a`;
    const capturedAt = new Date(Date.now() - 60_000).toISOString();

    const first = await submit(device, capturedAt);
    expect(first.status).toBe(201);
    expect(first.body.sightingId).toBeTypeOf("number");

    const second = await submit(device, capturedAt);
    expect(second.status).toBe(201);
    expect(second.body.sightingId).toBe(first.body.sightingId);
    // The response shape is unchanged on a repeat.
    expect(second.body).toHaveProperty("isCatPhoto");
    expect(second.body).toHaveProperty("candidates");

    const rows = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    expect(rows).toHaveLength(1);
  });

  it("(b) same device, different capturedAt creates two sightings", async () => {
    const device = `${DEVICE}-b`;
    const capturedAt1 = new Date(Date.now() - 60_000).toISOString();
    const capturedAt2 = new Date(Date.now() - 59_000).toISOString();

    const first = await submit(device, capturedAt1);
    const second = await submit(device, capturedAt2);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.sightingId).not.toBe(first.body.sightingId);

    const rows = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    expect(rows).toHaveLength(2);
  });

  it("(c) different device, same capturedAt creates two sightings", async () => {
    const deviceA = `${DEVICE}-c1`;
    const deviceB = `${DEVICE}-c2`;
    const capturedAt = new Date(Date.now() - 60_000).toISOString();

    const first = await submit(deviceA, capturedAt);
    const second = await submit(deviceB, capturedAt);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.sightingId).not.toBe(first.body.sightingId);

    const rowsA = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, deviceA));
    const rowsB = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, deviceB));
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });

  it("(d) a repeat does not create a second photo row", async () => {
    const device = `${DEVICE}-d`;
    const capturedAt = new Date(Date.now() - 60_000).toISOString();

    const first = await submit(device, capturedAt);
    expect(first.status).toBe(201);

    // Snapshot the whole photos table (not just this device's rows — photos
    // carry no device id) immediately before the repeat, then again after.
    // fileParallelism is off (vitest.config.ts) and no other test in this
    // file runs concurrently, so this window is exclusive.
    const [{ n: countBefore }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(photosTable);

    const second = await submit(device, capturedAt);
    expect(second.status).toBe(201);
    expect(second.body.sightingId).toBe(first.body.sightingId);

    const [{ n: countAfter }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(photosTable);
    expect(countAfter).toBe(countBefore);

    const [sighting] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    expect(sighting!.id).toBe(first.body.sightingId);
    const [photo] = await db
      .select()
      .from(photosTable)
      .where(eq(photosTable.id, sighting!.photoId));
    expect(photo).toBeDefined();
  });

  it("(e) a repeat for a sighting whose photo has been deleted returns that sighting, not a 500", async () => {
    const device = `${DEVICE}-e`;
    const capturedAt = new Date(Date.now() - 60_000).toISOString();

    const first = await submit(device, capturedAt);
    expect(first.status).toBe(201);

    // photo_id carries no foreign key, so the photo row can go while the
    // sighting stays — which the approved deletion work will do.
    const [sighting] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    await db.delete(photosTable).where(eq(photosTable.id, sighting!.photoId));

    const second = await submit(device, capturedAt);
    expect(second.status).toBe(201);
    expect(second.body.sightingId).toBe(first.body.sightingId);
    expect(second.body.candidates).toEqual([]);

    const rows = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.deviceId, device));
    expect(rows).toHaveLength(1);
  });
});
