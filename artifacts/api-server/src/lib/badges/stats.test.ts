import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  catsTable,
  photosTable,
  pointsLedgerTable,
  profilesTable,
  sightingsTable,
  weeklyResultsTable,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { deleteTestSightings } from "../../test/sightings";
import { currentAreas } from "../areas/namedAreas";
import { computeBadgeStats } from "./stats";

const DEVICE = "vitest-badgestats-device";
const OTHER = "vitest-badgestats-other";
const CAT_PREFIX = "VitestBadgeStatsCat";
const JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function photo(): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: JPEG, mime: "image/jpeg" }).returning();
  return p!.id;
}

async function cat(n: number, discoverer: string): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}${n}`,
      description: "",
      primaryPhotoId: await photo(),
      lat: 37.44,
      lng: 24.94,
      discovererDeviceId: discoverer,
    })
    .returning();
  return c!.id;
}

async function spot(
  device: string,
  catId: number,
  areaKey: string | null,
  onIsland: boolean | null,
  status = "resolved",
) {
  await db.insert(sightingsTable).values({
    deviceId: device,
    photoId: await photo(),
    lat: 37.44,
    lng: 24.94,
    status,
    catId,
    areaKey,
    onIsland,
  });
}

async function ledger(device: string, catId: number, weekStart: string, day: string) {
  await db.insert(pointsLedgerTable).values({
    deviceId: device,
    sightingId: Math.floor(Math.random() * 1e9) + 1e6,
    catId,
    points: 25,
    athensDay: day,
    weekStart,
    source: "live",
  });
}

async function cleanup() {
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, "vitest-badgestats-%"));
  await db.delete(weeklyResultsTable).where(like(weeklyResultsTable.deviceId, "vitest-badgestats-%"));
  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, "vitest-badgestats-%"));
  await deleteTestSightings(like(sightingsTable.deviceId, "vitest-badgestats-%"));
  const cats = await db.select().from(catsTable).where(like(catsTable.name, `${CAT_PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${CAT_PREFIX}%`));
  for (const id of [...rows.map((r) => r.photoId), ...cats.map((c) => c.primaryPhotoId)]) {
    await db.delete(photosTable).where(eq(photosTable.id, id));
  }
  await db.delete(profilesTable).where(like(profilesTable.deviceId, "vitest-badgestats-%"));
}

describe("computeBadgeStats", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("counts weeks, areas, remote cats and results", async () => {
    const areas = currentAreas();
    expect(areas.length).toBeGreaterThanOrEqual(4);
    const [a1, a2, a3, a4] = areas.map((a) => a.key);

    await db.insert(profilesTable).values({ deviceId: DEVICE, points: 120 });
    const cats = [];
    for (let i = 1; i <= 7; i++) cats.push(await cat(i, i <= 2 ? DEVICE : OTHER));

    // Four areas, one of them twice, with different cats.
    await spot(DEVICE, cats[0]!, a1!, true);
    await spot(DEVICE, cats[1]!, a1!, true);
    await spot(DEVICE, cats[2]!, a2!, true);
    await spot(DEVICE, cats[3]!, a3!, true);
    await spot(DEVICE, cats[4]!, a4!, true);
    // A retired / unknown area does not count.
    await spot(DEVICE, cats[5]!, "retired-area-x", true);
    // One remote spot (on the island, in no area), seen twice: one cat.
    await spot(DEVICE, cats[6]!, "off", true);
    await spot(DEVICE, cats[6]!, "off", true);
    // Off the island, a pending spot, and another spotter's: none count.
    await spot(DEVICE, cats[0]!, "off", false);
    await spot(DEVICE, cats[0]!, "off", true, "pending");
    await spot(OTHER, cats[3]!, "off", true);

    // Three different weeks in the ledger (two rows share a week).
    await ledger(DEVICE, cats[0]!, "2026-09-07", "2026-09-08");
    await ledger(DEVICE, cats[1]!, "2026-09-07", "2026-09-09");
    await ledger(DEVICE, cats[2]!, "2026-09-14", "2026-09-15");
    await ledger(DEVICE, cats[3]!, "2026-09-21", "2026-09-22");
    await ledger(OTHER, cats[3]!, "2026-09-28", "2026-09-29");

    await db.insert(weeklyResultsTable).values([
      { weekStart: "2026-09-07", place: 1, deviceId: DEVICE, points: 50 },
      { weekStart: "2026-09-14", place: 3, deviceId: DEVICE, points: 30 },
      { weekStart: "2026-09-21", place: 4, deviceId: DEVICE, points: 10 },
      { weekStart: "2026-09-07", place: 2, deviceId: OTHER, points: 40 },
    ]);

    const stats = await db.transaction((tx) => computeBadgeStats(tx, DEVICE));
    expect(stats).toEqual({
      points: 120,
      totalSightings: 9,
      catsSpotted: 7,
      uniqueCatsDiscovered: 2,
      weeksSpotted: 3,
      areasSpotted: 4,
      areasTotal: areas.length,
      remoteCats: 1,
      podiums: 2,
      champions: 1,
    });
  });
});
