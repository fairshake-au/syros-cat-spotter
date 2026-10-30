import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { catsTable, db, photosTable, pool, sightingPhotosTable, sightingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// SYC-462 (spec §6 items 3 and 4; T11, T12, T12b): a photo removed for good is
// never sent to the matcher, on a new spot, on a repeat upload (both its
// reads), and never becomes a new cat's main photo.

const { matchCatPhoto } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(async (_photos: unknown, candidates: { catId: number }[]) => ({
    isCatPhoto: true,
    matches: candidates.map((c) => ({ catId: c.catId, confidence: 0.9, reasoning: "test" })),
  })),
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
// Several uploads from supertest's one local address; the per-address AI
// limiter isn't what's under test (as sightings.matchHardening.test.ts does).
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { _resetDeviceMatchLimitForTests } from "../middlewares/rateLimit";
import { signedPerson, type Signed } from "../test/roleKit";
import { markRemoved } from "../test/removalKit";
import { nameTag } from "../test/nameTag";

// Out at sea, away from every other file's cats (as matchHardening does).
const ORIGIN = { lat: 35.9, lng: 21.1 };
const PREFIX = "vitest-removal-match-";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let staff: Signed;
const secretFor = (deviceId: string) => `vitest-secret-${deviceId}-0123456789`;

async function photoRow(): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  return p!.id;
}

async function catAt(name: string, lat: number, lng: number): Promise<{ id: number; photoId: number }> {
  const photoId = await photoRow();
  const [c] = await db
    .insert(catsTable)
    .values({ name, description: "", primaryPhotoId: photoId, lat, lng, discovererDeviceId: `${PREFIX}seed` })
    .returning();
  return { id: c!.id, photoId };
}

function submit(deviceId: string, capturedAt: string) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", secretFor(deviceId))
    .send({ deviceId, lat: ORIGIN.lat, lng: ORIGIN.lng, photoBase64: TINY_JPEG_B64, capturedAt });
}

const sentCatIds = () =>
  matchCatPhoto.mock.calls.flatMap((call) => (call[1] as { catId: number }[]).map((c) => c.catId));

beforeAll(async () => {
  // signedPerson mints a session cookie, which needs a key (unused here).
  process.env["TEAM_SESSION_KEYS"] = "vitest-removalmatch-key-0123456789abcdef-0123456789";
  staff = await signedPerson("removal-match-staff", ["staff"]);
});
beforeEach(async () => {
  matchCatPhoto.mockClear();
  await _resetDeviceMatchLimitForTests();
});
afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("T12: a new spot never sends a nearby cat's removed main photo", () => {
  it("compares the live cat and leaves the removed one out", async () => {
    const live = await catAt(`VitestRemovalLive-${Date.now()}`, ORIGIN.lat, ORIGIN.lng + 0.0005);
    const gone = await catAt(`VitestRemovalGone-${Date.now()}`, ORIGIN.lat, ORIGIN.lng + 0.0004);
    await markRemoved(gone.photoId, staff.id);
    const r = await submit(`${PREFIX}t12`, new Date(Date.now() - 60_000).toISOString());
    expect(r.status).toBe(201);
    expect(matchCatPhoto).toHaveBeenCalled();
    expect(sentCatIds()).toContain(live.id);
    expect(sentCatIds()).not.toContain(gone.id);
  });
});

describe("T11: a repeat upload of a spot whose photo was removed calls no matcher", () => {
  it("T11a: with the spot's sighting_photos rows", async () => {
    const device = `${PREFIX}t11a`;
    const capturedAt = new Date(Date.now() - 120_000).toISOString();
    const first = await submit(device, capturedAt);
    expect(first.status).toBe(201);
    const rows = await db
      .select({ photoId: sightingPhotosTable.photoId })
      .from(sightingPhotosTable)
      .where(eq(sightingPhotosTable.sightingId, first.body.sightingId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) await markRemoved(row.photoId, staff.id);
    matchCatPhoto.mockClear();
    const again = await submit(device, capturedAt);
    expect(again.status).toBe(201);
    expect(again.body.sightingId).toBe(first.body.sightingId);
    expect(again.body.candidates).toEqual([]);
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });

  it("T11b: with only the older sightings.photo_id (no sighting_photos rows)", async () => {
    const device = `${PREFIX}t11b`;
    const capturedAt = new Date(Date.now() - 180_000);
    // Bind the device's secret, as a first upload would (TOFU), on a different moment.
    expect((await submit(device, new Date(Date.now() - 900_000).toISOString())).status).toBe(201);
    const photoId = await photoRow();
    const [old] = await db
      .insert(sightingsTable)
      .values({ deviceId: device, photoId, lat: ORIGIN.lat, lng: ORIGIN.lng, status: "pending", createdAt: capturedAt })
      .returning();
    await markRemoved(photoId, staff.id);
    matchCatPhoto.mockClear();
    const again = await submit(device, capturedAt.toISOString());
    expect(again.status).toBe(201);
    expect(again.body.sightingId).toBe(old!.id);
    expect(again.body.candidates).toEqual([]);
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });
});

describe("T12b: a removed cover never becomes a new cat's main photo", () => {
  it("resolving the spot as a new cat gives it no main photo", async () => {
    const device = `${PREFIX}t12b`;
    const first = await submit(device, new Date(Date.now() - 240_000).toISOString());
    expect(first.status).toBe(201);
    const [spot] = await db.select().from(sightingsTable).where(eq(sightingsTable.id, first.body.sightingId));
    await markRemoved(spot!.photoId, staff.id);
    const name = `VitestRemovalNew-${nameTag()}`;
    const r = await request(app)
      .post(`/api/sightings/${spot!.id}/resolve`)
      .set("X-Device-Secret", secretFor(device))
      .send({ deviceId: device, newCatName: name });
    expect(r.status).toBeLessThan(300);
    const [cat] = await db.select().from(catsTable).where(eq(catsTable.name, name));
    expect(cat!.primaryPhotoId).toBe(0);
  });
});
