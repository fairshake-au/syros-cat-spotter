/**
 * SYC-166 slice 3 (spec test 14, Decision D1): a cat's owner hears about a
 * sighting straight away, and for a photo more than 24 hours old the push
 * names the day it was taken ("Agatha was seen on Tuesday"), not "spotted
 * again!". The evening round-up push to everyone else builds its own words
 * and must stay byte-identical to today's, whatever the sighting's age.
 *
 * Their in-app round-up row shows the stored message, so it carries the
 * day too: Samuel's call, 14 Oct 2026 (a day, never a time).
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
  profilesTable,
  pushTokensTable,
  pushRoundupRunsTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, ilike, inArray, like } from "drizzle-orm";

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));
const sendPushNotificationMock = vi.hoisted(() =>
  vi.fn(async (_token: string, _title: string, _body: string, _data?: unknown) => {}),
);
vi.mock("../lib/push", () => ({ sendPushNotification: sendPushNotificationMock }));

import app from "../app";
import { sendDailyRoundUp, ROUND_UP_HOUR } from "../lib/sightingRoundUp";

const DEVICE = "vitest-ownerpush";
const CAT_PREFIX = "VitestOwnerPushCat";
const SECRET = "vitest-ownerpush-secret-0123456789ab";
const HOUR = 3_600_000;

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const tokenOf = (deviceId: string) => `ExponentPushToken[${deviceId}]`;
const pushesTo = (deviceId: string) =>
  sendPushNotificationMock.mock.calls.filter((c) => c[0] === tokenOf(deviceId));

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function insertSighting(deviceId: string, createdAt: Date): Promise<number> {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId,
      photoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      status: "pending",
      createdAt,
    })
    .returning();
  return s!.id;
}

async function seedCat(name: string, owner: string | null) {
  const [c] = await db
    .insert(catsTable)
    .values({
      name,
      description: "",
      primaryPhotoId: await insertPhoto(),
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: `${DEVICE}-seed`,
      ownerDeviceId: owner,
    })
    .returning();
  return c!;
}

async function follow(deviceId: string, catId: number) {
  await db.insert(catSubscriptionsTable).values({
    deviceId,
    catId,
    createdAt: new Date(Date.now() - 30 * 24 * HOUR),
  });
  await db
    .insert(pushTokensTable)
    .values({ deviceId, token: tokenOf(deviceId) })
    .onConflictDoNothing();
}

async function resolve(spotter: string, sightingId: number, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: spotter, ...body });
}

/** The Athens weekday of `at`, worked out here independently of the helper. */
const athensWeekday = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", weekday: "long" }).format(at);
const athensDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(at);
const athensHour = (at: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );

/** The next moment, after `from`, at which the evening round-up is due. */
function nextRoundUpMoment(from: Date): Date {
  let t = new Date(from.getTime() + 60_000);
  while (athensHour(t) < ROUND_UP_HOUR) t = new Date(t.getTime() + 15 * 60_000);
  return t;
}

let roundUpDate: string | null = null;

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
  await db.delete(pushTokensTable).where(like(pushTokensTable.deviceId, `${DEVICE}%`));
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
  if (roundUpDate) {
    await db.delete(pushRoundupRunsTable).where(eq(pushRoundupRunsTable.roundUpDate, roundUpDate));
  }
}

beforeAll(cleanup);
beforeEach(() => sendPushNotificationMock.mockClear());
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("the owner's push for a sighting, and the evening round-up", () => {
  it("names the day for an old photo, says spotted again for a fresh one, and leaves the round-up push unchanged", async () => {
    const owner = `${DEVICE}-owner`;
    const followerOld = `${DEVICE}-follower-old`;
    const followerFresh = `${DEVICE}-follower-fresh`;
    const spotter = `${DEVICE}-spotter`;

    const oldCat = await seedCat(`${CAT_PREFIX}-Old`, owner);
    const freshCat = await seedCat(`${CAT_PREFIX}-Fresh`, owner);
    await follow(owner, oldCat.id);
    await follow(owner, freshCat.id);
    await follow(followerOld, oldCat.id);
    await follow(followerFresh, freshCat.id);

    const threeDaysAgo = new Date(Date.now() - 72 * HOUR);
    const oneHourAgo = new Date(Date.now() - 1 * HOUR);

    const oldRes = await resolve(spotter, await insertSighting(spotter, threeDaysAgo), {
      catId: oldCat.id,
    });
    expect(oldRes.status).toBe(200);
    const freshRes = await resolve(spotter, await insertSighting(spotter, oneHourAgo), {
      catId: freshCat.id,
    });
    expect(freshRes.status).toBe(200);

    // The owner's live push (fired without waiting, so wait for it).
    await vi.waitFor(() => expect(pushesTo(owner)).toHaveLength(2));
    const ownerBodies = Object.fromEntries(pushesTo(owner).map((c) => [c[1], c[2]]));
    expect(ownerBodies[oldCat.name]).toBe(
      `${oldCat.name} was seen on ${athensWeekday(threeDaysAgo)}`,
    );
    expect(ownerBodies[freshCat.name]).toBe(`${freshCat.name} was spotted again!`);

    // The owner's in-app row reads the same words.
    const ownerRows = await db
      .select({ message: catUpdatesTable.message })
      .from(notificationsTable)
      .innerJoin(catUpdatesTable, eq(notificationsTable.catUpdateId, catUpdatesTable.id))
      .where(eq(notificationsTable.deviceId, owner));
    expect(ownerRows.map((r) => r.message).sort()).toEqual(
      [`${oldCat.name} was seen on ${athensWeekday(threeDaysAgo)}`, `${freshCat.name} was spotted again!`].sort(),
    );

    // Nobody else heard anything live.
    expect(pushesTo(followerOld)).toHaveLength(0);
    expect(pushesTo(followerFresh)).toHaveLength(0);

    // The evening round-up: today's words, byte for byte, for both ages.
    const evening = nextRoundUpMoment(new Date());
    roundUpDate = athensDate(evening);
    sendPushNotificationMock.mockClear();
    const result = await sendDailyRoundUp(evening);
    expect(result.status).toBe("sent");

    const [oldPush] = pushesTo(followerOld);
    const [freshPush] = pushesTo(followerFresh);
    expect([oldPush?.[1], oldPush?.[2]]).toEqual([
      "Cats you follow",
      `${oldCat.name} was spotted again.`,
    ]);
    expect([freshPush?.[1], freshPush?.[2]]).toEqual([
      "Cats you follow",
      `${freshCat.name} was spotted again.`,
    ]);
    // The owner had it live and is never in the round-up.
    expect(pushesTo(owner)).toHaveLength(0);

    // Their in-app rows show the stored sentence, so the old photo names the
    // day there (Samuel, 14 Oct 2026): a day or a date, never a time.
    const followerRow = async (deviceId: string) => {
      const [row] = await db
        .select({ message: catUpdatesTable.message })
        .from(notificationsTable)
        .innerJoin(catUpdatesTable, eq(notificationsTable.catUpdateId, catUpdatesTable.id))
        .where(eq(notificationsTable.deviceId, deviceId));
      return row?.message;
    };
    const oldRow = await followerRow(followerOld);
    expect(oldRow).toBe(`${oldCat.name} was seen on ${athensWeekday(threeDaysAgo)}`);
    expect(oldRow).not.toMatch(/\d{1,2}[:.]\d{2}|\bam\b|\bpm\b/i);
    expect(await followerRow(followerFresh)).toBe(`${freshCat.name} was spotted again!`);
  });

  it("a new cat has no owner, so its 'just discovered' message reaches nobody live", async () => {
    const spotter = `${DEVICE}-discoverer`;
    const res = await resolve(spotter, await insertSighting(spotter, new Date(Date.now() - 72 * HOUR)), {
      newCatName: `${CAT_PREFIX}-New`,
    });
    expect(res.status).toBe(200);
    expect(res.body.isNewCat).toBe(true);

    const [update] = await db
      .select()
      .from(catUpdatesTable)
      .where(eq(catUpdatesTable.catId, res.body.cat.id));
    expect(update!.message).toBe(`${CAT_PREFIX}-New was just discovered on Syros!`);
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.catUpdateId, update!.id));
    expect(rows).toHaveLength(0);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });
});
