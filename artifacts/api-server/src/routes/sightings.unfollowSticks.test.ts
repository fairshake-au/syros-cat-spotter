/**
 * SYC-624 B3: an unfollow sticks. A phone that unfollowed a cat is not
 * quietly followed again when it later spots and resolves that cat.
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
  catUnfollowsTable,
  deviceCredentialsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, ilike, inArray, like } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const DEVICE = "vitest-unfollowsticks-device";
const CAT_PREFIX = "VitestUnfollowSticksCat";
const SECRET = "vitest-unfollowsticks-secret-0123456789ab";

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
    await db.delete(catUnfollowsTable).where(inArray(catUnfollowsTable.catId, catIds));
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
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

const resolve = (sightingId: number, deviceId: string, catId: number) =>
  request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId, catId });

const subRows = (deviceId: string, catId: number) =>
  db
    .select()
    .from(catSubscriptionsTable)
    .where(and(eq(catSubscriptionsTable.deviceId, deviceId), eq(catSubscriptionsTable.catId, catId)));

describe("resolving a sighting and following", () => {
  it("a phone that unfollowed is not re-followed by a new confirmed sighting", async () => {
    const catId = await seedCat(`${CAT_PREFIX}-Unfollowed`);
    const device = `${DEVICE}-unfollower`;

    const first = await resolve(await insertSighting(device), device, catId);
    expect(first.status).toBe(200);
    expect(await subRows(device, catId)).toHaveLength(1);

    const out = await request(app)
      .post(`/api/cats/${catId}/unfollow`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: device });
    expect(out.status).toBe(200);
    expect(await subRows(device, catId)).toHaveLength(0);

    const second = await resolve(await insertSighting(device), device, catId);
    expect(second.status).toBe(200);
    expect(await subRows(device, catId)).toHaveLength(0);
  });

  it("a phone that never unfollowed gets its follow from a confirmed sighting", async () => {
    const catId = await seedCat(`${CAT_PREFIX}-Control`);
    const device = `${DEVICE}-control`;
    const res = await resolve(await insertSighting(device), device, catId);
    expect(res.status).toBe(200);
    expect(await subRows(device, catId)).toHaveLength(1);
  });

  it("an unfollow still in flight when a resolve starts is not undone by it", async () => {
    const catId = await seedCat(`${CAT_PREFIX}-Race`);
    const device = `${DEVICE}-racer`;
    expect((await resolve(await insertSighting(device), device, catId)).status).toBe(200);
    expect(await subRows(device, catId)).toHaveLength(1);
    const pending = await insertSighting(device);

    // Connection A: the unfollow transaction (same steps as the route:
    // lock the cat row, drop the subscription, record the choice), held open.
    const a = await pool.connect();
    try {
      await a.query("begin");
      await a.query("select id from cats where id = $1 for update", [catId]);
      await a.query("delete from cat_subscriptions where device_id = $1 and cat_id = $2", [device, catId]);
      await a.query("insert into cat_unfollows (device_id, cat_id) values ($1, $2)", [device, catId]);

      // Connection B: the resolve starts while the unfollow is uncommitted.
      const resolving = resolve(pending, device, catId).then((r) => r);
      // Commit only once the resolve is really queued behind the lock. Since
      // migration 0054 the sightings trigger takes the same cat row FOR SHARE
      // inside the resolve's sighting update (no sighting is filed under a
      // merged-away cat), so it may wait there, earlier, rather than at the
      // route's own `from cats ... for share`.
      const deadline = Date.now() + 5000;
      for (;;) {
        const waiting = await pool.query(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and (query like '%from cats%' or query ilike '%update%sightings%') and pid <> pg_backend_pid() and datname = current_database()",
        );
        if (waiting.rowCount) break;
        if (Date.now() > deadline) throw new Error("the resolve never waited on the lock");
        await new Promise((r) => setTimeout(r, 20));
      }
      await a.query("commit");
      expect((await resolving).status).toBe(200);
    } finally {
      await a.query("rollback").catch(() => {});
      a.release();
    }

    expect(await subRows(device, catId)).toHaveLength(0);
    const unfollows = await db
      .select()
      .from(catUnfollowsTable)
      .where(and(eq(catUnfollowsTable.deviceId, device), eq(catUnfollowsTable.catId, catId)));
    expect(unfollows).toHaveLength(1);
  });
});
