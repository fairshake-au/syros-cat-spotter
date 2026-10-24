/**
 * SYC-624 B5: "has a home" and owner-edit pushes (notifyCatFollowers) go to
 * the cat's followers, and only to them: a follower who never spotted the
 * cat hears; a spotter who unfollowed does not.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  pool,
  catsTable,
  pushTokensTable,
  sightingsTable,
  catSubscriptionsTable,
  catUnfollowsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";
import { writeObservation } from "./observations";
import { follow, unfollow } from "./following";

const sendPushNotificationMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./push", () => ({ sendPushNotification: sendPushNotificationMock }));

import { notifyCatFollowers } from "./notifications";

const PREFIX = "vitest-notifyfollowers-";
const NAME_PREFIX = "VitestNotifyFollowers";
const device = (s: string) => `${PREFIX}${s}`;
let seq = 0;

async function seedCat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: device("seed"),
    })
    .returning();
  return c!.id;
}

async function withToken(deviceId: string): Promise<string> {
  const token = `token-${deviceId}`;
  await db.insert(pushTokensTable).values({ deviceId, token }).onConflictDoNothing();
  return token;
}

async function spotted(catId: number, deviceId: string) {
  await db.insert(sightingsTable).values({
    catId,
    deviceId,
    photoId: 0,
    lat: 37.44,
    lng: 24.9,
    status: "resolved",
  });
}

const pushedTokens = () =>
  sendPushNotificationMock.mock.calls.map((c) => (c as unknown as [string])[0]).sort();

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(like(catsTable.name, `${NAME_PREFIX}%`));
  const ids = cats.map((c) => c.id);
  if (ids.length > 0) {
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, ids));
    await db.delete(catUnfollowsTable).where(inArray(catUnfollowsTable.catId, ids));
    await deleteTestSightings(inArray(sightingsTable.catId, ids));
    await db.delete(catsTable).where(inArray(catsTable.id, ids));
  }
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${PREFIX}%`));
  await db.delete(catSubscriptionsTable).where(like(catSubscriptionsTable.deviceId, `${PREFIX}%`));
}

beforeAll(cleanup);
beforeEach(() => sendPushNotificationMock.mockClear());
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("notifyCatFollowers", () => {
  it("reaches a follower who never spotted the cat", async () => {
    const catId = await seedCat();
    const t = await withToken(device("fan"));
    await follow(db, { deviceId: device("fan"), catId });

    await notifyCatFollowers(catId, device("actor"), { title: "t", body: "b" });

    expect(pushedTokens()).toEqual([t]);
  });

  it("does not reach a spotter who unfollowed", async () => {
    const catId = await seedCat();
    const kept = await withToken(device("keeps"));
    await withToken(device("left"));
    await spotted(catId, device("keeps"));
    await spotted(catId, device("left"));
    await follow(db, { deviceId: device("keeps"), catId });
    await follow(db, { deviceId: device("left"), catId });
    await unfollow(db, { deviceId: device("left"), catId });

    await notifyCatFollowers(catId, device("actor"), { title: "t", body: "b" });

    expect(pushedTokens()).toEqual([kept]);
  });

  it("does not reach the phone that acted", async () => {
    const catId = await seedCat();
    await withToken(device("actor"));
    const other = await withToken(device("other"));
    await follow(db, { deviceId: device("actor"), catId });
    await follow(db, { deviceId: device("other"), catId });

    await notifyCatFollowers(catId, device("actor"), { title: "t", body: "b" });

    expect(pushedTokens()).toEqual([other]);
  });

  it("does not reach a deleted phone's leftover row", async () => {
    const catId = await seedCat();
    await withToken(`deleted:${PREFIX}gone`);
    await db.insert(catSubscriptionsTable).values({ deviceId: `deleted:${PREFIX}gone`, catId });

    await notifyCatFollowers(catId, device("actor"), { title: "t", body: "b" });

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a cat recorded as deceased", async () => {
    const catId = await seedCat();
    await withToken(device("fan"));
    await follow(db, { deviceId: device("fan"), catId });
    await writeObservation(db, {
      catId,
      kind: "life_status",
      value: { status: "deceased" },
      accountId: "staff-vitest-notifyfollowers",
      roleAtTime: "staff",
      observedAt: new Date(),
    });

    await notifyCatFollowers(catId, device("actor"), { title: "t", body: "b" });

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });
});
