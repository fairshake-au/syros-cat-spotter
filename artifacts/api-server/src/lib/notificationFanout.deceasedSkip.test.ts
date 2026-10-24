/**
 * data-spine.md PR 4, §3.3: "Notifications stop" for a cat with a live
 * `deceased` statement -- without this check "everyone who ever spotted her
 * keeps getting 'Agatha was spotted again!' about a cat the team has
 * recorded as dead, which is the cruellest bug in the app." Follows
 * (`cat_subscriptions`) are kept; only the notification/push is skipped.
 *
 * Tests `fanOutNotifications` (the `createUpdateAndFanOut` path used by
 * resolve) and `notifyCatFollowers` (the claim/rename path) directly, by
 * seeding a `deceased` observation unrelated to any sighting -- isolating
 * "is this cat currently recorded as dead" from the sighting-clears-it rule,
 * which `resolve.test.ts` and `sightings.deceasedGuard.test.ts` already
 * cover.
 */
import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  sightingsTable,
  pushTokensTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { writeObservation } from "./observations";
import { createUpdateAndFanOut } from "./notificationFanout";

const sendPushNotificationMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./push", () => ({ sendPushNotification: sendPushNotificationMock }));

import { notifyCatFollowers } from "./notifications";

const NAME_PREFIX = "VitestFanoutDeceased";
const SUBSCRIBER = "vitest-fanoutdeceased-subscriber";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;

async function seedSubscribedCat(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}-${++seq}-${Date.now()}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: 37.4448,
      lng: 24.9425,
      discovererDeviceId: "vitest-fanoutdeceased-seed",
      // The subscriber owns the cat: since data-spine.md PR 9 only the
      // owner is notified of a sighting straight away (everyone else in
      // the evening round-up), so the "alive" control needs the owner.
      ownerDeviceId: SUBSCRIBER,
    })
    .returning();
  await db
    .insert(catSubscriptionsTable)
    .values({ deviceId: SUBSCRIBER, catId: c!.id });
  return c!.id;
}

async function markDeceased(catId: number): Promise<void> {
  await writeObservation(db, {
    catId,
    kind: "life_status",
    value: { status: "deceased" },
    accountId: "staff-vitest-fanoutdeceased",
    roleAtTime: "staff",
    observedAt: new Date(),
  });
}

async function notificationCountFor(catId: number): Promise<number> {
  const updates = await db
    .select({ id: catUpdatesTable.id })
    .from(catUpdatesTable)
    .where(eq(catUpdatesTable.catId, catId));
  if (updates.length === 0) return 0;
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)));
  return rows.length;
}

async function cleanup() {
  const cats = await db
    .select({ id: catsTable.id, photoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(like(catsTable.name, `${NAME_PREFIX}%`));
  const catIds = cats.map((c) => c.id);
  if (catIds.length > 0) {
    const updates = await db
      .select({ id: catUpdatesTable.id })
      .from(catUpdatesTable)
      .where(inArray(catUpdatesTable.catId, catIds));
    if (updates.length > 0) {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.catUpdateId, updates.map((u) => u.id)));
    }
    await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
    await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
    await deleteTestSightings(inArray(sightingsTable.catId, catIds));
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
    await db.delete(photosTable).where(inArray(photosTable.id, cats.map((c) => c.photoId)));
  }
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${SUBSCRIBER}%`));
}

beforeAll(cleanup);
beforeEach(() => sendPushNotificationMock.mockClear());
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("fan-out skips a cat recorded as deceased (§3.3)", () => {
  it("createUpdateAndFanOut (resolve's path) writes no notification for a deceased cat, despite a subscriber", async () => {
    const catId = await seedSubscribedCat();
    await markDeceased(catId);
    const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));

    await createUpdateAndFanOut({
      cat: cat!,
      updateType: "sighting",
      message: "should never reach anyone",
    });

    expect(await notificationCountFor(catId)).toBe(0);
  });

  it("the same cat, alive, DOES get a notification -- proving the skip is the deceased check, not a broken fan-out", async () => {
    const catId = await seedSubscribedCat();
    const [cat] = await db.select().from(catsTable).where(eq(catsTable.id, catId));

    await createUpdateAndFanOut({
      cat: cat!,
      updateType: "sighting",
      message: "should reach the subscriber",
    });

    expect(await notificationCountFor(catId)).toBe(1);
  });

  it("notifyCatFollowers (the claim/rename path) sends no push for a deceased cat, despite a real follower and token", async () => {
    const catId = await seedSubscribedCat();
    const spotterDevice = `${SUBSCRIBER}-spotter`;
    const [photo] = await db.select().from(photosTable).limit(1);
    await db.insert(sightingsTable).values({
      deviceId: spotterDevice,
      photoId: photo!.id,
      catId,
      lat: 37.4448,
      lng: 24.9425,
      status: "resolved",
    });
    await db
      .insert(pushTokensTable)
      .values({ deviceId: spotterDevice, token: "ExponentPushToken[deceased-skip-test]" });
    await db.insert(catSubscriptionsTable).values({ deviceId: spotterDevice, catId });
    await markDeceased(catId);

    await notifyCatFollowers(catId, "someone-else", { title: "t", body: "b" });

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("the same setup, alive, DOES send a push -- proving the skip is the deceased check", async () => {
    const catId = await seedSubscribedCat();
    const spotterDevice = `${SUBSCRIBER}-spotter-alive`;
    const [photo] = await db.select().from(photosTable).limit(1);
    await db.insert(sightingsTable).values({
      deviceId: spotterDevice,
      photoId: photo!.id,
      catId,
      lat: 37.4448,
      lng: 24.9425,
      status: "resolved",
    });
    await db
      .insert(pushTokensTable)
      .values({ deviceId: spotterDevice, token: "ExponentPushToken[deceased-skip-test-alive]" });
    await db.insert(catSubscriptionsTable).values({ deviceId: spotterDevice, catId });

    await notifyCatFollowers(catId, "someone-else", { title: "t", body: "b" });

    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
  });
});
