/**
 * SYC-677 D: a look-alike candidate that is a cat Syros Cats left for
 * spotters to name carries namePending, so the phone shows "No name yet"
 * rather than its SYR number. Both builders: a send, and a stored answer.
 *
 * Works far out at sea, like sightings.matchRecord.test.ts, so no cat seeded
 * by another test file is ever within 500 m.
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
  sightingPhotosTable,
  profilesTable,
  peopleTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";
import { type LatLng } from "@workspace/geo";
import { blurPosition } from "../lib/blur";

const { matchCatPhoto, limit } = vi.hoisted(() => ({
  matchCatPhoto: vi.fn(),
  limit: { ok: true, calls: 0 },
}));
vi.mock("../lib/matching", () => ({ matchCatPhoto }));
// The per-IP budget has its own tests; the per-device one is controlled here
// so a test can hit it without twenty real uploads.
vi.mock("../middlewares/rateLimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/rateLimit")>()),
  aiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  checkDeviceMatchLimit: async () => {
    limit.calls += 1;
    return limit.ok;
  },
  deviceMatchResetAt: async () => Date.now() + 60_000,
}));

import app from "../app";
import { markRemoved } from "../test/removalKit";

/** The person a removal names (photos_removed_ck); left in place, like removalKit says. */
let staff: { id: string };

const DEVICE = "vitest-pendcand-device";
const OTHER = "vitest-pendcand-other";
const CAT_PREFIX = "VitestPendCandCat";
const SECRET = "vitest-pendcand-secret-0123456789abcdef";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let spots = 0;
/** Open sea south-east of Syros, about 5 km apart per test. */
function spot(): LatLng {
  return blurPosition(37.25, 25.1 + ++spots * 0.06);
}

let seq = 0;
async function seedCat(at: LatLng, pending = false): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: at.lat,
      lng: at.lng,
      discovererDeviceId: `${DEVICE}-seed`,
      ...(pending ? { namePending: true } : {}),
    })
    .returning();
  return c!.id;
}

let tick = 0;
function send(device: string, at: LatLng, capturedAt?: string) {
  return request(app)
    .post("/api/sightings")
    .set("X-Device-Secret", SECRET)
    .send({
      deviceId: device,
      lat: at.lat,
      lng: at.lng,
      photoBase64: TINY_JPEG_B64,
      capturedAt: capturedAt ?? new Date(Date.now() - 300_000 + ++tick * 1000).toISOString(),
    });
}

function recheck(sightingId: number, device: string, extra: object = {}) {
  return request(app)
    .post(`/api/sightings/${sightingId}/recheck`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, ...extra });
}

async function record(sightingId: number) {
  const [row] = await db
    .select()
    .from(sightingMatchesTable)
    .where(eq(sightingMatchesTable.sightingId, sightingId));
  return row;
}

const fails = () => matchCatPhoto.mockRejectedValueOnce(new Error("Connection error."));
const finds = (catId: number, confidence = 0.9) =>
  matchCatPhoto.mockResolvedValueOnce({
    isCatPhoto: true,
    matches: [{ catId, confidence, reasoning: "test" }],
  });

/** A sent spot whose check failed. */
async function failedSpot(device = DEVICE, at = spot()) {
  fails();
  const res = await send(device, at);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.sightingId as number, at };
}

/** Removes every photo of a spot for good (SYC-462): nothing left to check. */
async function removePhotos(sightingId: number) {
  const links = await db
    .select({ photoId: sightingPhotosTable.photoId })
    .from(sightingPhotosTable)
    .where(eq(sightingPhotosTable.sightingId, sightingId));
  const [s] = await db.select().from(sightingsTable).where(eq(sightingsTable.id, sightingId));
  const ids = new Set([...links.map((l) => l.photoId), s!.photoId]);
  for (const id of ids) await markRemoved(id, staff.id);
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  const rows = await db
    .select({ id: sightingsTable.id, photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, "vitest-pendcand-%"));
  if (rows.length > 0) {
    await db
      .delete(sightingMatchesTable)
      .where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
  }
  await deleteTestSightings(like(sightingsTable.deviceId, "vitest-pendcand-%"));
  if (cats.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, "vitest-pendcand-%"));
}

beforeAll(async () => {
  await cleanup();
  [staff] = await db
    .insert(peopleTable)
    .values({ email: `vitest-pendcand-staff-${Date.now()}@example.test`, name: "PendCand staff" })
    .returning({ id: peopleTable.id });
});
beforeEach(() => {
  matchCatPhoto.mockReset();
  matchCatPhoto.mockImplementation(async () => ({ isCatPhoto: true, matches: [] }));
  limit.ok = true;
  limit.calls = 0;
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("a pending cat as a look-alike candidate", () => {
  it("a send marks a pending candidate namePending, and a named one false", async () => {
    const at = spot();
    const pendingId = await seedCat(at, true);
    const namedId = await seedCat(at);
    matchCatPhoto.mockResolvedValueOnce({
      isCatPhoto: true,
      matches: [
        { catId: pendingId, confidence: 0.9, reasoning: "a" },
        { catId: namedId, confidence: 0.8, reasoning: "b" },
      ],
    });
    const res = await send(DEVICE, at);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const by = new Map(res.body.candidates.map((c: { catId: number }) => [c.catId, c]));
    expect(by.get(pendingId)).toMatchObject({ namePending: true });
    expect(by.get(namedId)).toMatchObject({ namePending: false });
  });

  it("a stored answer (check again after a good check) keeps namePending", async () => {
    const at = spot();
    const pendingId = await seedCat(at, true);
    matchCatPhoto.mockResolvedValueOnce({
      isCatPhoto: true,
      matches: [{ catId: pendingId, confidence: 0.9, reasoning: "a" }],
    });
    const sent = await send(DEVICE, at);
    const res = await recheck(sent.body.sightingId, DEVICE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0]).toMatchObject({ catId: pendingId, namePending: true });
  });
});
