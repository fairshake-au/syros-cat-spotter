/**
 * SYC-166 slice 3 (spec test 12): the reward screen's "Last seen" is the
 * cat's newest sighting, never the one just logged. Logging a 10-day-old
 * photo of a cat another spotter saw yesterday must not make the cat look
 * unseen for 10 days. The cat list already uses the newest
 * (`catHelpers.ts`); the resolve response now agrees with it.
 */
import { deleteTestSightings } from "../test/sightings";
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
  observationsTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const DEVICE = "vitest-lastseen-device";
const CAT_PREFIX = "VitestLastSeenCat";
const SECRET = "vitest-lastseen-secret-0123456789ab";
const DAY = 86_400_000;

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function insertSighting(
  deviceId: string,
  overrides: Partial<typeof sightingsTable.$inferInsert> = {},
): Promise<number> {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId,
      photoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      status: "pending",
      ...overrides,
    })
    .returning();
  return s!.id;
}

async function seedCat(name: string): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      primaryPhotoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: `${DEVICE}-seed`,
    })
    .returning();
  return c!.id;
}

const day = (at: Date) => at.toISOString().slice(0, 10);

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
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
    await db.delete(observationsTable).where(inArray(observationsTable.catId, catIds));
  }
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
  for (const r of rows) await db.delete(photosTable).where(eq(photosTable.id, r.photoId));
  if (catIds.length > 0) {
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
    for (const c of cats) await db.delete(photosTable).where(eq(photosTable.id, c.photoId));
  }
  await db.delete(catSubscriptionsTable).where(like(catSubscriptionsTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("the resolve response's lastSeenAt", () => {
  it("is the cat's newest sighting when an older photo is logged later", async () => {
    const catId = await seedCat(`${CAT_PREFIX}-Older`);
    const yesterday = new Date(Date.now() - 1 * DAY);
    const tenDaysAgo = new Date(Date.now() - 10 * DAY);
    // Another spotter saw her yesterday.
    await insertSighting(`${DEVICE}-other`, { catId, status: "resolved", createdAt: yesterday });

    const device = `${DEVICE}-old-photo`;
    const sightingId = await insertSighting(device, { createdAt: tenDaysAgo });
    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device, catId });

    expect(res.status).toBe(200);
    expect(res.body.cat.lastSeenAt).toBe(day(yesterday));
    expect(res.body.cat.lastSeenAt).not.toBe(day(tenDaysAgo));
  });

  it("is this sighting's own day when it is the newest", async () => {
    const catId = await seedCat(`${CAT_PREFIX}-Newest`);
    const fiveDaysAgo = new Date(Date.now() - 5 * DAY);
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    await insertSighting(`${DEVICE}-other2`, { catId, status: "resolved", createdAt: fiveDaysAgo });

    const device = `${DEVICE}-new-photo`;
    const sightingId = await insertSighting(device, { createdAt: twoDaysAgo });
    const res = await request(app)
      .post(`/api/sightings/${sightingId}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device, catId });

    expect(res.status).toBe(200);
    expect(res.body.cat.lastSeenAt).toBe(day(twoDaysAgo));
    expect(res.body.cat.sightingsCount).toBe(2);
  });
});
