/**
 * SYC-503 (docs/specs/when-the-photo-check-fails.md §4, §7): when the
 * look-alike check fails the phone is told so, never "no look-alikes", and
 * the check can be run again, only after a failure.
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
import { nameTag } from "../test/nameTag";

/** The person a removal names (photos_removed_ck); left in place, like removalKit says. */
let staff: { id: string };

const DEVICE = "vitest-recheck-device";
const OTHER = "vitest-recheck-other";
const CAT_PREFIX = "VitestRecheckCat";
const SECRET = "vitest-recheck-secret-0123456789abcdef";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let spots = 0;
/** Open sea south-east of Syros, about 5 km apart per test. */
function spot(): LatLng {
  return blurPosition(37.25, 25.1 + ++spots * 0.06);
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
    .where(like(sightingsTable.deviceId, "vitest-recheck-%"));
  if (rows.length > 0) {
    await db
      .delete(sightingMatchesTable)
      .where(inArray(sightingMatchesTable.sightingId, rows.map((r) => r.id)));
  }
  await deleteTestSightings(like(sightingsTable.deviceId, "vitest-recheck-%"));
  if (cats.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, "vitest-recheck-%"));
}

beforeAll(async () => {
  await cleanup();
  [staff] = await db
    .insert(peopleTable)
    .values({ email: `vitest-recheck-staff-${nameTag()}@example.test`, name: "Recheck staff" })
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

describe("sending a spot says whether the check worked", () => {
  it("a failed check answers matchCheck failed, with no candidates, never 'not a cat'", async () => {
    const at = spot();
    await seedCat(at);
    fails();
    const res = await send(DEVICE, at);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      matchCheck: "failed",
      canRecheck: true,
      isCatPhoto: true,
      candidates: [],
    });
    expect((await record(res.body.sightingId))!.matcherFailed).toBe(true);
  });

  it("a check that worked answers done, even with no look-alikes", async () => {
    const res = await send(DEVICE, spot());
    expect(res.body).toMatchObject({ matchCheck: "done", canRecheck: false, candidates: [] });
  });

  it("a check that worked with a look-alike answers done with the candidate", async () => {
    const at = spot();
    const catId = await seedCat(at);
    finds(catId);
    const res = await send(DEVICE, at);
    expect(res.body.matchCheck).toBe("done");
    expect(res.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([catId]);
  });

  it("a repeat send whose check fails also answers failed", async () => {
    const at = spot();
    const capturedAt = new Date(Date.now() - 200_000).toISOString();
    expect((await send(DEVICE, at, capturedAt)).body.matchCheck).toBe("done");
    fails();
    const again = await send(DEVICE, at, capturedAt);
    expect(again.body).toMatchObject({ matchCheck: "failed", canRecheck: true });
  });

  it("a repeat send whose photo has gone answers failed and can't be re-checked", async () => {
    const at = spot();
    const capturedAt = new Date(Date.now() - 100_000).toISOString();
    const first = await send(DEVICE, at, capturedAt);
    await removePhotos(first.body.sightingId);
    matchCatPhoto.mockClear();
    const again = await send(DEVICE, at, capturedAt);
    expect(again.body).toMatchObject({
      sightingId: first.body.sightingId,
      matchCheck: "failed",
      canRecheck: false,
      candidates: [],
    });
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });
});

describe("check again", () => {
  it("re-runs a failed check for its owner and replaces the record", async () => {
    const { id, at } = await failedSpot();
    const catId = await seedCat(at);
    finds(catId);
    const res = await recheck(id, DEVICE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ sightingId: id, matchCheck: "done", canRecheck: false });
    expect(res.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([catId]);
    const row = await record(id);
    expect(row!.matcherFailed).toBe(false);
    expect(row!.comparedCatIds).toContain(catId);
  });

  it("answers failed again when the check fails again, and can still be tried", async () => {
    const { id } = await failedSpot();
    fails();
    const res = await recheck(id, DEVICE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matchCheck: "failed", canRecheck: true, candidates: [] });
    expect((await record(id))!.matcherFailed).toBe(true);
  });

  it("answers with nothing the send didn't (no location, no match record)", async () => {
    const { id } = await failedSpot();
    const res = await recheck(id, DEVICE);
    expect(Object.keys(res.body).sort()).toEqual(
      ["canRecheck", "candidates", "isCatPhoto", "matchCheck", "sightingId"].sort(),
    );
  });

  it("uses the sighting's stored location, never one from the phone", async () => {
    const { id, at } = await failedSpot();
    const near = await seedCat(at);
    const elsewhere = spot();
    const far = await seedCat(elsewhere);
    const res = await recheck(id, DEVICE, { lat: elsewhere.lat, lng: elsewhere.lng });
    expect(res.status).toBe(200);
    const compared = (await record(id))!.comparedCatIds ?? [];
    expect(compared).toContain(near);
    expect(compared).not.toContain(far);
  });

  it("refuses a sighting that doesn't exist (404)", async () => {
    expect((await recheck(2_000_000_000, DEVICE)).status).toBe(404);
  });

  it("refuses another phone's sighting (403) without running the check", async () => {
    const { id } = await failedSpot();
    matchCatPhoto.mockClear();
    const res = await recheck(id, OTHER);
    expect(res.status).toBe(403);
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });

  it("refuses the right device id with the wrong secret", async () => {
    const { id } = await failedSpot();
    const res = await request(app)
      .post(`/api/sightings/${id}/recheck`)
      .set("X-Device-Secret", "vitest-recheck-wrong-secret-0123456789")
      .send({ deviceId: DEVICE });
    expect(res.status).toBe(403);
  });

  it("a check that worked is final: asking again returns its answer, with no new check", async () => {
    const at = spot();
    const catId = await seedCat(at);
    const withheld = await seedCat(at);
    matchCatPhoto.mockResolvedValueOnce({
      isCatPhoto: true,
      matches: [
        { catId, confidence: 0.9, reasoning: "test" },
        { catId: withheld, confidence: 0.2, reasoning: "test" },
      ],
    });
    const res = await send(DEVICE, at);
    expect(res.body.matchCheck).toBe("done");
    matchCatPhoto.mockClear();
    limit.calls = 0;
    const again = await recheck(res.body.sightingId, DEVICE);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ matchCheck: "done", canRecheck: false, isCatPhoto: true });
    // Only what the send showed: the withheld, below-threshold cat never appears.
    expect(again.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([catId]);
    expect(matchCatPhoto).not.toHaveBeenCalled();
    expect(limit.calls).toBe(0);
  });

  it("the phone that never heard its recheck worked gets the look-alikes, not a dead end", async () => {
    const { id, at } = await failedSpot();
    const catId = await seedCat(at);
    finds(catId);
    expect((await recheck(id, DEVICE)).body.matchCheck).toBe("done");
    matchCatPhoto.mockClear();
    const again = await recheck(id, DEVICE);
    expect(again.status).toBe(200);
    expect(again.body.candidates.map((c: { catId: number }) => c.catId)).toEqual([catId]);
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });

  it("a stored 'no cat in the photo' comes back as not a cat", async () => {
    matchCatPhoto.mockResolvedValueOnce({ isCatPhoto: false, matches: [] });
    const res = await send(DEVICE, spot());
    const again = await recheck(res.body.sightingId, DEVICE);
    expect(again.body).toMatchObject({ matchCheck: "done", isCatPhoto: false });
  });

  it("a failure that was never written down can't be re-checked (409 NOT_CHECKABLE)", async () => {
    const { id } = await failedSpot();
    await db.delete(sightingMatchesTable).where(eq(sightingMatchesTable.sightingId, id));
    const res = await recheck(id, DEVICE);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_CHECKABLE");
  });

  it("refuses a resolved sighting (409)", async () => {
    const { id } = await failedSpot();
    const resolved = await request(app)
      .post(`/api/sightings/${id}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, newCatName: `${CAT_PREFIX}-resolved-${nameTag()}` });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    const res = await recheck(id, DEVICE);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RESOLVED");
  });

  it("refuses a second check while one is running (409)", async () => {
    const { id } = await failedSpot();
    let finish!: () => void;
    matchCatPhoto.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = () => r({ isCatPhoto: true, matches: [] });
        }),
    );
    const first = recheck(id, DEVICE).then((r) => r);
    await vi.waitFor(() => expect(matchCatPhoto).toHaveBeenCalledTimes(2));
    const second = await recheck(id, DEVICE);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("CHECK_RUNNING");
    finish();
    expect((await first).status).toBe(200);
  });

  it("a cat chosen while the check ran makes its answer moot (409 RESOLVED)", async () => {
    const { id } = await failedSpot();
    let finish!: () => void;
    matchCatPhoto.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = () => r({ isCatPhoto: true, matches: [] });
        }),
    );
    const running = recheck(id, DEVICE).then((r) => r);
    await vi.waitFor(() => expect(matchCatPhoto).toHaveBeenCalledTimes(2));
    const resolved = await request(app)
      .post(`/api/sightings/${id}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, newCatName: `${CAT_PREFIX}-mid-${nameTag()}` });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    finish();
    const res = await running;
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RESOLVED");
  });

  it("counts against the per-device limit, and says when to try again (429)", async () => {
    const { id } = await failedSpot();
    limit.ok = false;
    limit.calls = 0;
    matchCatPhoto.mockClear();
    const res = await recheck(id, DEVICE);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(limit.calls).toBe(1);
    expect(matchCatPhoto).not.toHaveBeenCalled();
  });

  it("with the photo gone answers failed, can't recheck, and calls nothing", async () => {
    const { id } = await failedSpot();
    await removePhotos(id);
    matchCatPhoto.mockClear();
    limit.calls = 0;
    const res = await recheck(id, DEVICE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matchCheck: "failed", canRecheck: false });
    expect(matchCatPhoto).not.toHaveBeenCalled();
    expect(limit.calls).toBe(0);
  });
});
