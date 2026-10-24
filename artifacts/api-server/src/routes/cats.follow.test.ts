import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  db,
  pool,
  catsTable,
  catSubscriptionsTable,
  catUnfollowsTable,
  deviceCredentialsTable,
} from "@workspace/db";
import { and, eq, like } from "drizzle-orm";
import app from "../app";
import { followersCount } from "../lib/following";
import { DELETED_SECRET_HASH, deletedMarkerKey } from "../lib/deviceAuth";
import { FOLLOW_DEVICE_LIMIT } from "../middlewares/rateLimit";

// All fixtures share these prefixes so cleanup can never touch real data.
const PREFIX = "vitest-follow-";
const NAME_PREFIX = "VitestFollowCat";
const DEVICE_SECRET = "vitest-follow-device-secret-aaaa";

const device = (suffix: string) => `${PREFIX}${suffix}`;

async function cleanup() {
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  for (const c of cats) {
    await db.delete(catSubscriptionsTable).where(eq(catSubscriptionsTable.catId, c.id));
    await db.delete(catUnfollowsTable).where(eq(catUnfollowsTable.catId, c.id));
  }
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(eq(deviceCredentialsTable.deviceId, deletedMarkerKey(device("gone"))));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat(suffix: string, overrides: Partial<typeof catsTable.$inferInsert> = {}) {
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${suffix}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: device("discoverer"),
      ...overrides,
    })
    .returning();
  return cat!;
}

const post = (action: "follow" | "unfollow", catId: number | string, deviceId: string, secret: string | null = DEVICE_SECRET) => {
  const r = request(app).post(`/api/cats/${catId}/${action}`);
  if (secret) r.set("X-Device-Secret", secret);
  return r.send({ deviceId });
};

const subRows = (deviceId: string, catId: number) =>
  db
    .select()
    .from(catSubscriptionsTable)
    .where(and(eq(catSubscriptionsTable.deviceId, deviceId), eq(catSubscriptionsTable.catId, catId)));
const unfollowRows = (deviceId: string, catId: number) =>
  db
    .select()
    .from(catUnfollowsTable)
    .where(and(eq(catUnfollowsTable.deviceId, deviceId), eq(catUnfollowsTable.catId, catId)));

describe("POST /api/cats/:catId/follow and /unfollow", () => {
  it("follow adds a row and counts followers; a double tap keeps one row", async () => {
    const cat = await insertCat("A");
    await db.insert(catSubscriptionsTable).values({ deviceId: device("other"), catId: cat.id });
    const res = await post("follow", cat.id, device("a1"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isFollowing: true, followersCount: 2 });
    const again = await post("follow", cat.id, device("a1"));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ isFollowing: true, followersCount: 2 });
    expect(await subRows(device("a1"), cat.id)).toHaveLength(1);
  });

  it("unfollow removes the row, records the choice and answers not following", async () => {
    const cat = await insertCat("B");
    await post("follow", cat.id, device("b1"));
    const res = await post("unfollow", cat.id, device("b1"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isFollowing: false, followersCount: 0 });
    expect(await subRows(device("b1"), cat.id)).toHaveLength(0);
    expect(await unfollowRows(device("b1"), cat.id)).toHaveLength(1);
    const twice = await post("unfollow", cat.id, device("b1"));
    expect(twice.status).toBe(200);
    expect(await unfollowRows(device("b1"), cat.id)).toHaveLength(1);
  });

  it("follow after unfollow deletes the unfollow row", async () => {
    const cat = await insertCat("C");
    await post("unfollow", cat.id, device("c1"));
    expect(await unfollowRows(device("c1"), cat.id)).toHaveLength(1);
    const res = await post("follow", cat.id, device("c1"));
    expect(res.body.isFollowing).toBe(true);
    expect(await unfollowRows(device("c1"), cat.id)).toHaveLength(0);
    expect(await subRows(device("c1"), cat.id)).toHaveLength(1);
  });

  it("refuses the owner's unfollow and keeps the row", async () => {
    const cat = await insertCat("D", { ownerDeviceId: device("owner") });
    await post("follow", cat.id, device("owner"));
    const res = await post("unfollow", cat.id, device("owner"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_CANNOT_UNFOLLOW");
    expect(await subRows(device("owner"), cat.id)).toHaveLength(1);
    expect(await unfollowRows(device("owner"), cat.id)).toHaveLength(0);
  });

  it("answers 404 for a missing cat, 400 for a bad body, 401 without a secret, 410 for a deleted id", async () => {
    const cat = await insertCat("E");
    expect((await post("follow", 999999999, device("e1"))).status).toBe(404);
    expect((await post("follow", "abc", device("e1"))).status).toBe(404);
    const bad = await request(app).post(`/api/cats/${cat.id}/follow`).set("X-Device-Secret", DEVICE_SECRET).send({});
    expect(bad.status).toBe(400);
    expect((await post("follow", cat.id, device("e2"), null)).status).toBe(401);
    await db
      .insert(deviceCredentialsTable)
      .values({ deviceId: deletedMarkerKey(device("gone")), secretHash: DELETED_SECRET_HASH });
    expect((await post("unfollow", cat.id, device("gone"))).status).toBe(410);
    expect((await post("follow", cat.id, "deleted:abc")).status).toBe(400);
  });

  it("refuses the 51st follow or unfollow call in a day from one phone (a re-follow counts)", async () => {
    const cat = await insertCat("F");
    for (let i = 0; i < FOLLOW_DEVICE_LIMIT; i++) {
      const res = await post(i % 2 === 0 ? "follow" : "unfollow", cat.id, device("f1"));
      expect(res.status).toBe(200);
    }
    const res = await post("follow", cat.id, device("f1"));
    expect(res.status).toBe(429);
    // Another phone is unaffected.
    expect((await post("follow", cat.id, device("f2"))).status).toBe(200);
  });

  it("followersCount ignores a deleted: row", async () => {
    const cat = await insertCat("G");
    await db.insert(catSubscriptionsTable).values([
      { deviceId: device("g1"), catId: cat.id },
      { deviceId: "deleted:vitest-follow-g2", catId: cat.id },
    ]);
    expect(await followersCount(cat.id)).toBe(1);
  });
});
