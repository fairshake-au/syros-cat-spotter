import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { inArray, like } from "drizzle-orm";
import {
  catsTable,
  catUpdatesTable,
  db,
  deviceCredentialsTable,
  notificationsTable,
  photosTable,
  pool,
  sightingsTable,
} from "@workspace/db";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";

// SYC-166 slice 2 (spec photo-location-from-library.md §9 tests 8 and 9; plan
// P11). The phone apps now date a library photo to when it was taken, up to
// 21 days back. A backdated sighting must still reach the public as a date
// only, never a time; and two photos from the same second, which the phone
// moves one millisecond apart, must be two sightings, while a real retry of
// one send (the same instant) is still one.

const PREFIX = "vitest-backdated-";
const DEVICE = `${PREFIX}device`;
const SECRET = "vitest-backdated-secret-0123456789abcdef";
const ORIGIN = { lat: 34.6311, lng: 21.1422 };
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const NAME = `${PREFIX}Agatha`;
const DAY_MS = 86_400_000;
let catId: number;

async function cleanup() {
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (cats.length > 0) {
    const ids = cats.map((c) => c.id);
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, ids));
    if (updates.length > 0) {
      await db.delete(notificationsTable).where(inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)));
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, ids));
  }
  const photoIds = (
    await db
      .select({ photoId: sightingsTable.photoId })
      .from(sightingsTable)
      .where(like(sightingsTable.deviceId, `${PREFIX}%`))
  ).map((r) => r.photoId);
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  const [photo] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}main`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: NAME,
      primaryPhotoId: photo!.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      discovererDeviceId: `${PREFIX}discoverer`,
      createdAt: new Date(Date.now() - 25 * DAY_MS),
    })
    .returning({ id: catsTable.id });
  catId = cat!.id;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

function submit(capturedAt: string) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: DEVICE, lat: ORIGIN.lat, lng: ORIGIN.lng, photoBase64: TINY_JPEG_B64, capturedAt });
}

/** Every string anywhere in a parsed JSON value. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

describe("a sighting dated from a photo 20 days old", () => {
  it("reaches the public with its true date and never a time", async () => {
    // A photo taken 20 days ago, with seconds and milliseconds of its own.
    const taken = new Date(Date.now() - 20 * DAY_MS);
    taken.setUTCHours(13, 37, 42, 123);
    const capturedAt = taken.toISOString();
    const day = capturedAt.slice(0, 10);

    const sent = await submit(capturedAt);
    expect(sent.status).toBe(201);
    const resolved = await request(app)
      .post(`/api/sightings/${sent.body.sightingId}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, catId });
    expect(resolved.status).toBe(200);

    // Stored as the photo's own instant (the clamp leaves 20 days alone).
    const [row] = await db
      .select({ createdAt: sightingsTable.createdAt })
      .from(sightingsTable)
      .where(like(sightingsTable.deviceId, DEVICE));
    expect(row!.createdAt.toISOString()).toBe(capturedAt);

    const list = await request(app).get(`/api/cats?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&pageSize=200`);
    expect(list.status).toBe(200);
    const entry = (list.body.cats as { id: number; lastSeenAt: string }[]).find((c) => c.id === catId);
    expect(entry).toBeDefined();
    expect(entry!.lastSeenAt).toBe(day);

    const page = await request(app).get(`/api/cats/${catId}`);
    expect(page.status).toBe(200);

    for (const [label, body] of [
      ["cat list", entry],
      ["cat page", page.body],
    ] as const) {
      const all = strings(body);
      // The true date is there...
      expect(all, label).toContain(day);
      // ...and nothing carries that day with a time, nor the time itself.
      for (const s of all) {
        expect(s, label).not.toContain(`${day}T`);
        expect(s, label).not.toContain("13:37");
      }
    }
  });
});

describe("two photos from the same second (Decision 2 B, server side)", () => {
  it("one millisecond apart are two sightings; the same instant again is a retry", async () => {
    const t = new Date(Date.now() - 3 * DAY_MS);
    t.setUTCMilliseconds(0);
    const first = await submit(t.toISOString());
    const second = await submit(new Date(t.getTime() + 1).toISOString());
    const retry = await submit(t.toISOString());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(second.body.sightingId).not.toBe(first.body.sightingId);
    expect(retry.body.sightingId).toBe(first.body.sightingId);
  });
});
