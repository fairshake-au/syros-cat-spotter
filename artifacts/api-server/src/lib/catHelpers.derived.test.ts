import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  pool,
  catsTable,
  photosTable,
  sightingsTable,
  profilesTable,
} from "@workspace/db";
import { like, inArray, eq } from "drizzle-orm";
import { computeStreak, spottedCatIds, fansCount } from "./catHelpers";
import { STREAK_TIMEZONE } from "./streak";

const CAT_PREFIX = "VitestDerivedCat";
const DEVICE_A = "vitest-derived-device-a";
const DEVICE_B = "vitest-derived-device-b";
const DEVICE_EMPTY = "vitest-derived-device-empty";

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const catIds: number[] = [];
const photoIds: number[] = [];

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  photoIds.push(p!.id);
  return p!.id;
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
      discovererDeviceId: `${DEVICE_A}-seed`,
    })
    .returning();
  catIds.push(c!.id);
  return c!.id;
}

/**
 * Insert a resolved sighting at a given local-Athens day offset from today.
 * The timestamp is written as midday Athens time so the row lands unambiguously
 * inside the intended local day regardless of DST.
 */
async function seedSighting(
  deviceId: string,
  catId: number,
  daysAgo: number,
): Promise<void> {
  const photoId = await insertPhoto();
  await db.insert(sightingsTable).values({
    deviceId,
    catId,
    photoId,
    lat: 37.44,
    lng: 24.9,
    status: "resolved",
    createdAt: new Date(
      `${localDayOffset(daysAgo)}T12:00:00${athensOffsetSuffix()}`,
    ),
  });
}

function athensOffsetSuffix(): string {
  // Midday is never near a DST boundary, so a fixed +02:00 still lands on the
  // right local day in both winter (+02) and summer (+03).
  return "+02:00";
}

function localDayOffset(daysAgo: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: STREAK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) - daysAgo * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function cleanup(): Promise<void> {
  await deleteTestSightings(inArray(sightingsTable.deviceId, [DEVICE_A, DEVICE_B, DEVICE_EMPTY]));
  if (catIds.length) {
    await deleteTestSightings(inArray(sightingsTable.catId, catIds));
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  }
  await db.delete(catsTable).where(like(catsTable.name, `${CAT_PREFIX}%`));
  if (photoIds.length) {
    await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  }
  await db
    .delete(profilesTable)
    .where(inArray(profilesTable.deviceId, [DEVICE_A, DEVICE_B, DEVICE_EMPTY]));
}

let catOne = 0;
let catTwo = 0;

beforeAll(async () => {
  await cleanup();
  catOne = await seedCat(`${CAT_PREFIX}One`);
  catTwo = await seedCat(`${CAT_PREFIX}Two`);

  // Device A: spotted today, yesterday, and two days ago — a 3-day streak.
  await seedSighting(DEVICE_A, catOne, 0);
  await seedSighting(DEVICE_A, catTwo, 1);
  await seedSighting(DEVICE_A, catOne, 2);
  // ...and once long ago, which must not extend the streak.
  await seedSighting(DEVICE_A, catOne, 30);

  // Device B: only ever spotted catOne, twice on the same day.
  await seedSighting(DEVICE_B, catOne, 0);
  await seedSighting(DEVICE_B, catOne, 0);
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("computeStreak", () => {
  it("counts consecutive spotting days and stops at the gap", async () => {
    expect(await computeStreak(DEVICE_A)).toBe(3);
  });

  it("counts repeat spots on one day as a single day", async () => {
    expect(await computeStreak(DEVICE_B)).toBe(1);
  });

  it("is 0 for a device that has never spotted", async () => {
    expect(await computeStreak(DEVICE_EMPTY)).toBe(0);
  });

  it("ignores pending sightings — only resolved ones build a streak", async () => {
    const photoId = await insertPhoto();
    await db.insert(sightingsTable).values({
      deviceId: DEVICE_EMPTY,
      catId: catOne,
      photoId,
      lat: 37.44,
      lng: 24.9,
      status: "pending",
    });
    expect(await computeStreak(DEVICE_EMPTY)).toBe(0);
    await deleteTestSightings(eq(sightingsTable.deviceId, DEVICE_EMPTY));
  });
});

describe("spottedCatIds", () => {
  it("returns each spotted cat exactly once, despite repeat sightings", async () => {
    // Device A has four sightings across only two distinct cats.
    expect(await spottedCatIds(DEVICE_A)).toEqual([catOne, catTwo].sort((a, b) => a - b));
  });

  it("returns only the cats that device spotted, not everyone's", async () => {
    expect(await spottedCatIds(DEVICE_B)).toEqual([catOne]);
  });

  it("is empty for a device that has never spotted", async () => {
    expect(await spottedCatIds(DEVICE_EMPTY)).toEqual([]);
  });
});

describe("fansCount", () => {
  it("counts distinct devices, not sightings", async () => {
    // catOne has 3 sightings from A and 2 from B — two fans, not five.
    expect(await fansCount(catOne)).toBe(2);
  });

  it("counts a single fan once", async () => {
    expect(await fansCount(catTwo)).toBe(1);
  });

  it("is 0 for a cat nobody has spotted", async () => {
    const lonely = await seedCat(`${CAT_PREFIX}Lonely`);
    expect(await fansCount(lonely)).toBe(0);
  });
});
