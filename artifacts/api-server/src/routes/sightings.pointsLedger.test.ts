import { deleteTestSightings } from "../test/sightings";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  pointsLedgerTable,
} from "@workspace/db";
import { asc, eq, ilike, inArray, like } from "drizzle-orm";

// The resolve flow never calls the AI matcher, but importing the app pulls it
// in; keep it mocked so this suite stays fully offline.
vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";
import { athensDay, weekStartAthens } from "../lib/weeks";
import { placeFor } from "../lib/areas/placeFor";

// SYC-706 Task 3: every award goes to the dated ledger, and a spotter earns
// for a given cat once per Athens day.

const DEVICE = "vitest-ledger-device";
const CAT_PREFIX = "VitestLedgerCat";
const SECRET = "vitest-ledger-secret-0123456789abcd";

// Ermoupoli, well inside a named area.
const ERMOUPOLI = { lat: 37.4445, lng: 24.942 };

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
    .values({ deviceId, photoId, ...ERMOUPOLI, status: "pending" })
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
      ...ERMOUPOLI,
      discovererDeviceId: `${DEVICE}-seed-discoverer`,
    })
    .returning();
  return c!.id;
}

function resolve(device: string, sightingId: number, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: device, ...body });
}

async function ledgerFor(device: string) {
  return db
    .select()
    .from(pointsLedgerTable)
    .where(eq(pointsLedgerTable.deviceId, device))
    .orderBy(asc(pointsLedgerTable.id));
}

async function profilePoints(device: string): Promise<number | undefined> {
  const [p] = await db
    .select({ points: profilesTable.points })
    .from(profilesTable)
    .where(eq(profilesTable.deviceId, device));
  return p?.points;
}

async function cleanup() {
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, `${DEVICE}%`));
  const cats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
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
    await db.delete(pointsLedgerTable).where(inArray(pointsLedgerTable.catId, catIds));
  }

  const rows = await db
    .select({ photoId: sightingsTable.photoId })
    .from(sightingsTable)
    .where(like(sightingsTable.deviceId, `${DEVICE}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
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
  await db.delete(profilesTable).where(like(profilesTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /api/sightings/:sightingId/resolve: points ledger (SYC-706)", () => {
  it("first spot of a cat today earns 15 and writes a live ledger row with this week's weekStart", async () => {
    const device = `${DEVICE}-first`;
    const catId = await seedCat(`${CAT_PREFIX}-First`);
    const sightingId = await insertSighting(device);

    const before = new Date();
    const res = await resolve(device, sightingId, { catId });
    const after = new Date();

    expect(res.status).toBe(200);
    expect(res.body.pointsAwarded).toBe(15);
    expect(res.body.pointsReason).toBeNull();
    expect(await profilePoints(device)).toBe(15);

    const ledger = await ledgerFor(device);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      sightingId,
      catId,
      points: 15,
      source: "live",
      athensDay: athensDay(after),
      weekStart: weekStartAthens(after),
    });
    expect(ledger[0]!.earnedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(ledger[0]!.earnedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("second spot of the same cat the same Athens day earns 0 with pointsReason repeat_today, and profile points rise by 15 only", async () => {
    const device = `${DEVICE}-repeat`;
    const catId = await seedCat(`${CAT_PREFIX}-Repeat`);
    const first = await insertSighting(device);
    const second = await insertSighting(device);

    const r1 = await resolve(device, first, { catId });
    expect(r1.status).toBe(200);
    expect(r1.body.pointsAwarded).toBe(15);

    const r2 = await resolve(device, second, { catId });
    expect(r2.status).toBe(200);
    expect(r2.body.pointsAwarded).toBe(0);
    expect(r2.body.pointsReason).toBe("repeat_today");
    expect(r2.body.profile.points).toBe(15);
    expect(await profilePoints(device)).toBe(15);

    const ledger = await ledgerFor(device);
    expect(ledger.map((l) => [l.sightingId, l.points])).toEqual([
      [first, 15],
      [second, 0],
    ]);
    expect(ledger[0]!.athensDay).toBe(ledger[1]!.athensDay);
  });

  it("the same cat the next Athens day earns 15 again", async () => {
    const device = `${DEVICE}-nextday`;
    const catId = await seedCat(`${CAT_PREFIX}-NextDay`);
    const first = await insertSighting(device);
    const second = await insertSighting(device);

    // Tuesday 23:30 Athens (EEST, UTC+3), then Wednesday 00:30 Athens.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T20:30:00Z"));
    const r1 = await resolve(device, first, { catId });
    vi.setSystemTime(new Date("2026-10-20T21:30:00Z"));
    const r2 = await resolve(device, second, { catId });
    vi.useRealTimers();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.pointsAwarded).toBe(15);
    expect(r2.body.pointsAwarded).toBe(15);
    expect(r2.body.pointsReason).toBeNull();
    expect(await profilePoints(device)).toBe(30);

    const ledger = await ledgerFor(device);
    expect(ledger.map((l) => [l.athensDay, l.weekStart, l.points])).toEqual([
      ["2026-10-20", "2026-10-19", 15],
      ["2026-10-21", "2026-10-19", 15],
    ]);
  });

  it("a new cat earns 25", async () => {
    const device = `${DEVICE}-newcat`;
    const sightingId = await insertSighting(device);

    const res = await resolve(device, sightingId, { newCatName: `${CAT_PREFIX}-Brand New` });

    expect(res.status).toBe(200);
    expect(res.body.isNewCat).toBe(true);
    expect(res.body.pointsAwarded).toBe(25);
    expect(res.body.pointsReason).toBeNull();
    expect(await profilePoints(device)).toBe(25);
    const ledger = await ledgerFor(device);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ catId: res.body.cat.id, points: 25, source: "live" });
  });

  it("concurrent resolves of the same cat on one day award points once", async () => {
    const device = `${DEVICE}-concurrent`;
    const catId = await seedCat(`${CAT_PREFIX}-Concurrent`);
    const [a, b] = await Promise.all([insertSighting(device), insertSighting(device)]);

    const responses = await Promise.all([
      resolve(device, a, { catId }),
      resolve(device, b, { catId }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const awarded = responses.map((r) => r.body.pointsAwarded).sort();
    expect(awarded).toEqual([0, 15]);
    expect(responses.map((r) => r.body.pointsReason).sort()).toEqual([null, "repeat_today"].sort());
    expect(await profilePoints(device)).toBe(15);

    const ledger = await ledgerFor(device);
    expect(ledger).toHaveLength(2);
    expect(ledger.reduce((sum, l) => sum + l.points, 0)).toBe(15);
  });

  it("the ledger refuses a second points-earning row for the same spotter, cat and day", async () => {
    const device = `${DEVICE}-index`;
    const catId = await seedCat(`${CAT_PREFIX}-Index`);
    const row = (sightingId: number, points: number) => ({
      deviceId: device,
      sightingId,
      catId,
      points,
      athensDay: "2026-10-20",
      weekStart: "2026-10-19",
      source: "live",
    });
    // Sighting ids here only need to be unique; no sighting row is read.
    await db.insert(pointsLedgerTable).values(row(-9001, 15));
    await db.insert(pointsLedgerTable).values(row(-9002, 0));
    const err: any = await db
      .insert(pointsLedgerTable)
      .values(row(-9003, 15))
      .then(() => null, (e: unknown) => e);
    expect(err?.cause?.constraint ?? err?.constraint).toBe("points_ledger_once_a_day_uq");
  });

  it("the resolved sighting has areaKey and onIsland stamped", async () => {
    const device = `${DEVICE}-stamp`;
    const catId = await seedCat(`${CAT_PREFIX}-Stamp`);
    const sightingId = await insertSighting(device);

    const res = await resolve(device, sightingId, { catId });
    expect(res.status).toBe(200);

    const [s] = await db
      .select()
      .from(sightingsTable)
      .where(eq(sightingsTable.id, sightingId));
    const expected = placeFor(ERMOUPOLI.lat, ERMOUPOLI.lng);
    expect(expected.areaKey).not.toBe("off");
    expect(s).toMatchObject({
      status: "resolved",
      catId,
      areaKey: expected.areaKey,
      onIsland: true,
    });
  });
});
