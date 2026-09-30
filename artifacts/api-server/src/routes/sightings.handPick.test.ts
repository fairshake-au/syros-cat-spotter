/**
 * SYC-119 Slice A1: the server's nearby check on a hand pick, and what a hand
 * pick earns. docs/specs/choose-a-different-cat.md §4.8 and §10; the plan's
 * "Tests" table (docs/superpowers/plans/syc-119-choose-a-different-cat.md).
 *
 * Distances are built with lib/geo so the geometry here is the same geometry
 * the phone uses (test 25 lives on the phone side and in lib/geo).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  sightingsTable,
  profilesTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";
import { squareCentre, type LatLng } from "@workspace/geo";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { POINTS_CONFIRM } from "./sightings";

const DEVICE = "vitest-handpick-device";
const CAT_PREFIX = "VitestHandPickCat";
const SECRET = "vitest-handpick-secret-0123456789ab";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/** A square centre in Ermoupoli, so offsets inside its square are exact. */
const SQUARE = squareCentre({ lat: 37.4448, lng: 24.9425 });

/** A point exactly `km` due north of `p` (negative: south). */
function northOf(p: LatLng, km: number): LatLng {
  return { lat: p.lat + ((km / 6371) * 180) / Math.PI, lng: p.lng };
}

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function insertSighting(deviceId: string, at: LatLng): Promise<number> {
  const photoId = await insertPhoto();
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId, lat: at.lat, lng: at.lng, status: "pending" })
    .returning();
  return s!.id;
}

let seq = 0;
async function seedCat(at: LatLng): Promise<{ id: number; photoId: number }> {
  const photoId = await insertPhoto();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: photoId,
      lat: at.lat,
      lng: at.lng,
      discovererDeviceId: `${DEVICE}-seed`,
    })
    .returning();
  return { id: c!.id, photoId };
}

function resolve(sightingId: number, device: string, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, ...body });
}

async function sightingRow(id: number) {
  const [s] = await db
    .select()
    .from(sightingsTable)
    .where(eq(sightingsTable.id, id));
  return s!;
}

async function pointsOf(device: string): Promise<number> {
  const [p] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, device));
  return p?.points ?? 0;
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    if (updates.length > 0) {
      await db.delete(notificationsTable).where(
        inArray(
          notificationsTable.catUpdateId,
          updates.map((u) => u.id),
        ),
      );
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db
      .delete(catSubscriptionsTable)
      .where(inArray(catSubscriptionsTable.catId, catIds));
  }
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await db.delete(sightingsTable).where(like(sightingsTable.deviceId, `${DEVICE}%`));
  const photoIds = [...rows.map((r) => r.photoId), ...cats.map((c) => c.photoId)];
  if (catIds.length > 0) await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  if (photoIds.length > 0) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  await db
    .delete(catSubscriptionsTable)
    .where(like(catSubscriptionsTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("hand pick: the server's nearby check (spec §4.8)", () => {
  it("test 22: refuses a cat whose published square is beyond 1.5 km, and changes nothing", async () => {
    const device = `${DEVICE}-far`;
    const cat = await seedCat(SQUARE);
    const sightingId = await insertSighting(device, northOf(SQUARE, 3));

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NOT_NEARBY");
    const s = await sightingRow(sightingId);
    expect(s.status).toBe("pending");
    expect(s.catId).toBeNull();
    expect(await pointsOf(device)).toBe(0);
  });

  it("test 22: accepts a cat whose published square is exactly 1.5 km away", async () => {
    const device = `${DEVICE}-edge`;
    const cat = await seedCat(SQUARE);
    const sightingId = await insertSighting(device, northOf(SQUARE, 1.5));

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(200);
    expect(res.body.cat.id).toBe(cat.id);
  });

  it("test 23: accepts any cat within 500 m on exact positions, which every suggestion is", async () => {
    // Suggested cats are within 500 m exactly (DECISIONS Part 2h). Put the cat
    // 499 m from the photo, at the edge of its square nearest the photo, so
    // its published centre is as far from the photo as it can be: the worst
    // case for the published-square check.
    const device = `${DEVICE}-suggested`;
    const catAt = northOf(SQUARE, 0.124);
    const cat = await seedCat(catAt);
    const sightingId = await insertSighting(device, northOf(catAt, 0.499));

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(200);
  });

  it("test 24: accepts a cat whose exact position is beyond 1.5 km when its published square is within", async () => {
    const device = `${DEVICE}-exact-far`;
    const cat = await seedCat(northOf(SQUARE, -0.1)); // exact: 1.55 km away
    const sightingId = await insertSighting(device, northOf(SQUARE, 1.45));

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(200);
  });

  it("test 24: refuses a cat whose exact position is within 1.5 km when its published square is beyond", async () => {
    const device = `${DEVICE}-exact-near`;
    const cat = await seedCat(northOf(SQUARE, 0.1)); // exact: 1.45 km away
    const sightingId = await insertSighting(device, northOf(SQUARE, 1.55));

    const res = await resolve(sightingId, device, { catId: cat.id });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NOT_NEARBY");
  });

  it("test 24: every refusal is identical in status, message and shape, whatever the reason", async () => {
    const device = `${DEVICE}-identical`;
    const farCat = await seedCat(SQUARE);
    const edgeCat = await seedCat(northOf(SQUARE, 0.1));

    const s1 = await insertSighting(device, northOf(SQUARE, 5));
    const s2 = await insertSighting(device, northOf(SQUARE, 1.55));
    const s3 = await insertSighting(device, SQUARE);

    const far = await resolve(s1, device, { catId: farCat.id });
    const edge = await resolve(s2, device, { catId: edgeCat.id });
    const missing = await resolve(s3, device, { catId: 999_999_999 });

    for (const res of [far, edge, missing]) {
      expect(res.status).toBe(422);
      expect(res.body).toEqual(far.body);
      expect(res.headers["content-type"]).toBe(far.headers["content-type"]);
    }
    expect(Object.keys(far.body).sort()).toEqual(["code", "error"]);
    expect(far.body.error).toBe(
      "That cat isn't listed near where you took this photo.",
    );
  });

  it("checks ownership before distance, so nobody can probe with another device's sighting", async () => {
    const owner = `${DEVICE}-probe-owner`;
    const cat = await seedCat(SQUARE);
    const sightingId = await insertSighting(owner, northOf(SQUARE, 3));

    const res = await resolve(sightingId, `${DEVICE}-probe-other`, {
      catId: cat.id,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
  });

  it("accepts the optional pickedFrom field and ignores it", async () => {
    const device = `${DEVICE}-picked-from`;
    const cat = await seedCat(SQUARE);
    for (const pickedFrom of ["nearby", "search", "name_prompt"]) {
      const sightingId = await insertSighting(device, SQUARE);
      const res = await resolve(sightingId, device, { catId: cat.id, pickedFrom });
      expect(res.status).toBe(200);
      expect(res.body.pickedFrom).toBeUndefined();
    }
  });

  it("refuses an unknown pickedFrom value", async () => {
    const device = `${DEVICE}-picked-from-bad`;
    const cat = await seedCat(SQUARE);
    const sightingId = await insertSighting(device, SQUARE);
    const res = await resolve(sightingId, device, {
      catId: cat.id,
      pickedFrom: "island_wide",
    });
    expect(res.status).toBe(400);
    expect((await sightingRow(sightingId)).status).toBe("pending");
  });
});

describe("what a hand pick earns (spec §4.2, §8.4)", () => {
  it("test 6: a hand pick awards POINTS_CONFIRM, and its response has the same shape as a suggested match", async () => {
    const device = `${DEVICE}-points`;
    const cat = await seedCat(SQUARE);

    const s1 = await insertSighting(device, SQUARE);
    const plain = await resolve(s1, device, { catId: cat.id });
    const s2 = await insertSighting(device, northOf(SQUARE, 1.2));
    const handPick = await resolve(s2, device, {
      catId: cat.id,
      pickedFrom: "search",
    });

    expect(handPick.status).toBe(200);
    expect(handPick.body.pointsAwarded).toBe(POINTS_CONFIRM);
    expect(handPick.body.isNewCat).toBe(false);
    expect(Object.keys(handPick.body).sort()).toEqual(
      Object.keys(plain.body).sort(),
    );
    expect(Object.keys(handPick.body.cat).sort()).toEqual(
      Object.keys(plain.body.cat).sort(),
    );
    expect(await pointsOf(device)).toBe(2 * POINTS_CONFIRM);
  });

  it("test 21: a hand pick never sets the cat's main photo", async () => {
    const device = `${DEVICE}-main-photo`;
    const cat = await seedCat(SQUARE);
    const sightingId = await insertSighting(device, northOf(SQUARE, 0.8));

    const res = await resolve(sightingId, device, {
      catId: cat.id,
      pickedFrom: "nearby",
    });

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, cat.id));
    expect(row!.primaryPhotoId).toBe(cat.photoId);
    expect(row!.primaryPhotoId).not.toBe((await sightingRow(sightingId)).photoId);
  });
});

describe("NAME_TAKEN says which cat has the name (spec §3.1, §9)", () => {
  it("returns the named cat's id, name and main photo, all public", async () => {
    const device = `${DEVICE}-name-taken`;
    const cat = await seedCat(SQUARE);
    const [row] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, cat.id));
    const sightingId = await insertSighting(device, SQUARE);

    const res = await resolve(sightingId, device, {
      newCatName: row!.name.toUpperCase(),
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NAME_TAKEN");
    expect(res.body.cat).toEqual({
      id: cat.id,
      name: row!.name,
      photoUrl: `/api/photos/${cat.photoId}`,
    });
  });
});
