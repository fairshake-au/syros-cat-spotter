import { deleteTestSightings } from "../test/sightings";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, catsTable, photosTable, sightingsTable } from "@workspace/db";
import { inArray, like } from "drizzle-orm";
import { CATS_PAGE_SIZE_MAX, listCatsWithStats } from "./catHelpers";

// SYC-624 A1: the list orders by the Syros day of the newest sighting, the
// same day the cat shows as "last seen". 22:30 UTC in summer is 01:30 the
// next morning on Syros, so that cat is the more recent one.
const PREFIX = "VitestListOrderCat";
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const catIds: number[] = [];
const photoIds: number[] = [];

async function seed(name: string, sightingAt: string): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  photoIds.push(p!.id);
  const [c] = await db
    .insert(catsTable)
    .values({ name, description: "", primaryPhotoId: p!.id, lat: 37.44, lng: 24.9, discovererDeviceId: "vitest-listorder-device" })
    .returning();
  catIds.push(c!.id);
  await db.insert(sightingsTable).values({
    deviceId: "vitest-listorder-device",
    catId: c!.id,
    photoId: p!.id,
    lat: 37.44,
    lng: 24.9,
    status: "resolved",
    createdAt: new Date(sightingAt),
  });
  return c!.id;
}

async function cleanup() {
  if (catIds.length) {
    await deleteTestSightings(inArray(sightingsTable.catId, catIds));
    await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  }
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (photoIds.length) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("listCatsWithStats order", () => {
  it("sorts by the Syros day of the newest sighting", async () => {
    // Earlier id is the cat seen at 20:00 UTC (same Syros day, 23:00). The
    // later id was seen at 22:30 UTC, which is already the next Syros day.
    const early = await seed(`${PREFIX}-early`, "2026-06-10T20:00:00Z");
    const late = await seed(`${PREFIX}-late`, "2026-06-10T22:30:00Z");

    const found = new Map<number, { index: number; lastSeenAt: string }>();
    let seen = 0;
    for (let page = 1; found.size < 2; page++) {
      const res = await listCatsWithStats({ page, pageSize: CATS_PAGE_SIZE_MAX });
      res.cats.forEach((c, i) => {
        if (c.id === early || c.id === late) found.set(c.id, { index: seen + i, lastSeenAt: c.lastSeenAt });
      });
      seen += res.cats.length;
      if (res.nextPage === null) break;
    }

    expect(found.get(early)!.lastSeenAt).toBe("2026-06-10");
    expect(found.get(late)!.lastSeenAt).toBe("2026-06-11");
    expect(found.get(late)!.index).toBeLessThan(found.get(early)!.index);
  });
});
