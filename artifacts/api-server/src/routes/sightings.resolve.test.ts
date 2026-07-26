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
import { eq, like, inArray, sql } from "drizzle-orm";

// The resolve flow never calls the AI matcher, but importing the app pulls it
// in; keep it mocked so this suite stays fully offline.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const DEVICE = "vitest-resolve-device";
const CAT_PREFIX = "VitestResolveCat";
const RESOLVE_SECRET = "vitest-resolve-secret-0123456789ab";

// 1x1 white JPEG — resolve never re-validates the photo, it only needs a row.
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function insertSighting(deviceId: string): Promise<number> {
  const photoId = await insertPhoto();
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId, lat: 37.44, lng: 24.9, status: "pending" })
    .returning();
  return s!.id;
}

async function seedCat(name: string): Promise<number> {
  const photoId = await insertPhoto();
  const [c] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      primaryPhotoId: photoId,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: `${DEVICE}-seed-discoverer`,
    })
    .returning();
  return c!.id;
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(like(catsTable.name, `${CAT_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    const updateIds = updates.map((u) => u.id);
    if (updateIds.length > 0) {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.catUpdateId, updateIds));
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
  await db
    .delete(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const r of rows) {
    await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  }

  if (catIds.length > 0) {
    const catPhotos = await db
      .select({ photoId: catsTable.primaryPhotoId })
      .from(catsTable)
      .where(inArray(catsTable.id, catIds));
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
    for (const p of catPhotos) {
      await db.delete(photosTable).where(eq(photosTable.id, p.photoId));
    }
  }

  await db
    .delete(catSubscriptionsTable)
    .where(like(catSubscriptionsTable.deviceId, `${DEVICE}%`));
  await db
    .delete(profilesTable)
    .where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /api/sightings/:sightingId/resolve", () => {
  it("awards 10 points when resolving to an existing cat", async () => {
    const device = `${DEVICE}-confirm`;
    const catId = await seedCat(`${CAT_PREFIX}-Existing`);
    const sightingId = await insertSighting(device);

    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: device, catId });

    expect(res.status).toBe(200);
    expect(res.body.pointsAwarded).toBe(10);
    expect(res.body.isNewCat).toBe(false);
    expect(res.body.cat.id).toBe(catId);
    expect(res.body.profile.points).toBe(10);

    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, device));
    expect(profile!.points).toBe(10);

    const [sighting] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sightingId));
    expect(sighting!.status).toBe("resolved");
    expect(sighting!.catId).toBe(catId);
  });

  it("awards 50 points and sets the discoverer when creating a new cat", async () => {
    const device = `${DEVICE}-newcat`;
    const sightingId = await insertSighting(device);
    const name = `${CAT_PREFIX}-Freshly Found`;

    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: device, newCatName: name });

    expect(res.status).toBe(200);
    expect(res.body.pointsAwarded).toBe(50);
    expect(res.body.isNewCat).toBe(true);
    expect(res.body.cat.name).toBe(name);
    expect(res.body.profile.points).toBe(50);

    const [cat] = await db
      .select()
      .from(catsTable)
      .where(eq(catsTable.id, res.body.cat.id));
    expect(cat!.discovererDeviceId).toBe(device);
  });

  it("returns newly earned badges in the response", async () => {
    const confirmDevice = `${DEVICE}-badge-confirm`;
    const discoverDevice = `${DEVICE}-badge-discover`;
    const catId = await seedCat(`${CAT_PREFIX}-BadgeTarget`);

    // First resolved sighting → first_sighting badge.
    const s1 = await insertSighting(confirmDevice);
    const res1 = await request(app)
      .post(`/api/sightings/${s1}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: confirmDevice, catId });
    expect(res1.status).toBe(200);
    expect(res1.body.newBadges).toContain("first_sighting");
    expect(res1.body.profile.badges).toContain("first_sighting");

    // A second resolve must not re-report already-earned badges.
    const s2 = await insertSighting(confirmDevice);
    const res2 = await request(app)
      .post(`/api/sightings/${s2}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: confirmDevice, catId });
    expect(res2.body.newBadges).not.toContain("first_sighting");

    // First discovery → first_discovery (plus first_sighting) badges.
    const s3 = await insertSighting(discoverDevice);
    const res3 = await request(app)
      .post(`/api/sightings/${s3}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: discoverDevice, newCatName: `${CAT_PREFIX}-BadgeNew` });
    expect(res3.status).toBe(200);
    expect(res3.body.newBadges).toContain("first_discovery");
    expect(res3.body.newBadges).toContain("first_sighting");
  });

  it("returns 403 when resolving someone else's sighting", async () => {
    const owner = `${DEVICE}-owner`;
    const catId = await seedCat(`${CAT_PREFIX}-NotYours`);
    const sightingId = await insertSighting(owner);

    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: `${DEVICE}-attacker`, catId });

    expect(res.status).toBe(403);

    // No points, no resolution.
    const [sighting] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sightingId));
    expect(sighting!.status).toBe("pending");
    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, `${DEVICE}-attacker`));
    expect(profile?.points ?? 0).toBe(0);
  });

  it("returns 409 on double-resolve without awarding points twice", async () => {
    const device = `${DEVICE}-double`;
    const catId = await seedCat(`${CAT_PREFIX}-Double`);
    const sightingId = await insertSighting(device);

    const first = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: device, catId });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: device, catId });
    expect(second.status).toBe(409);

    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.deviceId, device));
    expect(profile!.points).toBe(10);
  });

  it("returns 404 for an unknown sighting or cat", async () => {
    const device = `${DEVICE}-404`;
    const res = await request(app)
      .post(`/api/sightings/999999999/resolve`)
      .send({ deviceId: device, catId: 1 });
    expect(res.status).toBe(404);

    const sightingId = await insertSighting(device);
    const res2 = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .send({ deviceId: device, catId: 999999999 });
    expect(res2.status).toBe(404);
  });
});

describe("POST /api/sightings/:sightingId/resolve auth", () => {
  // Bind the device's secret first. Trust-on-first-use means an *unbound*
  // device accepts whatever secret it is shown, so without this the
  // wrong-secret case would legitimately succeed and the test would be
  // asserting nothing.
  beforeAll(async () => {
    await request(app)
      .get(`/api/profiles/${DEVICE}`)
      .set("X-Device-Secret", RESOLVE_SECRET)
      .expect(200);
  });

  // This route awards points, can create a cat, and returns the owner's full
  // profile. Matching the supplied deviceId against the sighting's owner is not
  // authentication — device ids travel in request bodies.
  it("refuses to resolve without the device secret", async () => {
    const sightingId = await insertSighting(DEVICE);
    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .send({ deviceId: DEVICE, newCatName: `${CAT_PREFIX}Unauthed` })
      .expect(401);
    expect(res.body.profile).toBeUndefined();
  });

  it("refuses to resolve with the wrong device secret", async () => {
    const sightingId = await insertSighting(DEVICE);
    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", "wrong-secret-0123456789abcdefgh")
      .send({ deviceId: DEVICE, newCatName: `${CAT_PREFIX}Unauthed2` })
      .expect(403);
    expect(res.body.profile).toBeUndefined();
  });
});
