import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  db,
  catsTable,
  photosTable,
  sightingsTable,
  catSubscriptionsTable,
  catUpdatesTable,
  notificationsTable,
  pointsLedgerTable,
} from "@workspace/db";
import { eq, ilike, inArray, like, sql } from "drizzle-orm";
import { deleteTestSightings } from "../../test/sightings";

// The resolve flow never calls the AI matcher, but importing the app pulls it
// in; keep it mocked so this suite stays fully offline.
vi.mock("../matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

// Trailblazer reads the area list as it stood at the moment of the spot.
// The real history is shared by the whole run, so these tests hand it a
// made-up area far from Syros instead.
vi.mock("../areas/areaHistory", async (importOriginal) => {
  const real = await importOriginal<typeof import("../areas/areaHistory")>();
  return { ...real, namedAreasAt: vi.fn(real.namedAreasAt) };
});

import app from "../../app";
import { namedAreasAt } from "../areas/areaHistory";
import { athensDay, weekStartAthens } from "../weeks";
import { awardBadges, backfillFinished, eventBadgesForSpot } from "./award";

// SYC-706 Task 6: badges are saved inside the spot's transaction, and each
// new batch queues one celebration moment.

const DEVICE = "vitest-award-device";
const CAT_PREFIX = "VitestAwardCat";
const SECRET = "vitest-award-secret-0123456789abcdef";
// A backfill version no real run uses.
const BACKFILL_VERSION = 970_006;

// Ermoupoli, well inside a named area.
const ERMOUPOLI = { lat: 37.4445, lng: 24.942 };

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;
const device = (tag: string) => `${DEVICE}-${tag}-${++seq}`;

async function insertPhoto(): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning();
  return p!.id;
}

async function insertSighting(deviceId: string, at = ERMOUPOLI): Promise<number> {
  const photoId = await insertPhoto();
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId, ...at, status: "pending" })
    .returning();
  return s!.id;
}

/** A spot confirmed before this version went live: no ledger row, no badges. */
async function insertResolvedSighting(
  deviceId: string,
  catId: number,
  opts: { areaKey?: string; at?: { lat: number; lng: number } } = {},
): Promise<number> {
  const photoId = await insertPhoto();
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId,
      photoId,
      ...(opts.at ?? ERMOUPOLI),
      status: "resolved",
      catId,
      areaKey: opts.areaKey ?? null,
    })
    .returning();
  return s!.id;
}

async function seedCat(name: string, at = ERMOUPOLI): Promise<number> {
  const photoId = await insertPhoto();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${name}-${++seq}`,
      description: "",
      primaryPhotoId: photoId,
      ...at,
      discovererDeviceId: `${DEVICE}-seed-discoverer`,
    })
    .returning();
  return c!.id;
}

function resolve(deviceId: string, sightingId: number, body: object) {
  return request(app)
    .post(`/api/sightings/${sightingId}/resolve`)
    .set("X-Device-Secret", SECRET)
    .send({ deviceId, ...body });
}

async function momentsFor(deviceId: string) {
  const r = await db.execute(sql`
    select id, kind, badge_ids from badge_moments
    where device_id = ${deviceId} order by id`);
  return r.rows as { id: number; kind: string; badge_ids: string[] }[];
}

async function storedBadges(deviceId: string) {
  const r = await db.execute(sql`
    select badge_id, source from spotter_badges where device_id = ${deviceId}`);
  return new Map(r.rows.map((row) => [String(row.badge_id), String(row.source)]));
}

async function openBackfill() {
  await db.execute(sql`
    insert into badge_backfill_runs (version, finished_at, spotters)
    values (${BACKFILL_VERSION}, now(), 0)
    on conflict (version) do update set finished_at = now()`);
}

async function closeBackfill() {
  await db.execute(sql`delete from badge_backfill_runs where version = ${BACKFILL_VERSION}`);
}

async function deleteCats(catIds: number[]) {
  if (catIds.length === 0) return;
  const updates = await db
    .select({ id: catUpdatesTable.id })
    .from(catUpdatesTable)
    .where(inArray(catUpdatesTable.catId, catIds));
  const updateIds = updates.map((u) => u.id);
  if (updateIds.length > 0) {
    await db.delete(notificationsTable).where(inArray(notificationsTable.catUpdateId, updateIds));
  }
  await db.delete(catUpdatesTable).where(inArray(catUpdatesTable.catId, catIds));
  await db.delete(catSubscriptionsTable).where(inArray(catSubscriptionsTable.catId, catIds));
  await db.delete(pointsLedgerTable).where(inArray(pointsLedgerTable.catId, catIds));
  await deleteTestSightings(inArray(sightingsTable.catId, catIds));
  await db.delete(catsTable).where(inArray(catsTable.id, catIds));
}

async function cleanup() {
  await closeBackfill();
  await db.execute(sql`delete from spotter_badges where device_id like ${DEVICE + "%"}`);
  await db.execute(sql`delete from badge_moments where device_id like ${DEVICE + "%"}`);
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, `${DEVICE}%`));
  const cats = await db
    .select({ id: catsTable.id })
    .from(catsTable)
    .where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  await deleteCats(cats.map((c) => c.id));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
}

beforeAll(cleanup);
afterEach(async () => {
  vi.mocked(namedAreasAt).mockClear();
  await closeBackfill();
});
afterAll(cleanup);

describe("awarding badges inside the resolve", () => {
  it("first spot earns first_sighting once and queues one moment", async () => {
    const d = device("first");
    const catId = await seedCat("First");

    const res1 = await resolve(d, await insertSighting(d), { catId });
    expect(res1.status).toBe(200);
    expect(res1.body.newBadges).toEqual(["first_sighting"]);
    expect(typeof res1.body.momentId).toBe("number");
    expect(res1.body.profile.badges).toContain("first_sighting");

    const res2 = await resolve(d, await insertSighting(d), { catId });
    expect(res2.status).toBe(200);
    expect(res2.body.newBadges).toEqual([]);
    expect(res2.body.momentId).toBeNull();

    const moments = await momentsFor(d);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ id: res1.body.momentId, kind: "badges", badge_ids: ["first_sighting"] });
    expect((await storedBadges(d)).get("first_sighting")).toBe("live");
  });

  it("concurrent resolves celebrate a new badge once", async () => {
    const d = device("race");
    const [catA, catB] = [await seedCat("RaceA"), await seedCat("RaceB")];
    const [sA, sB] = [await insertSighting(d), await insertSighting(d)];
    // Bind the secret first, so the race is between the resolves alone.
    expect((await request(app).get(`/api/profiles/${d}`).set("X-Device-Secret", SECRET)).status).toBe(200);

    const [rA, rB] = await Promise.all([
      resolve(d, sA, { catId: catA }),
      resolve(d, sB, { catId: catB }),
    ]);
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);
    const all = [...rA.body.newBadges, ...rB.body.newBadges];
    expect(all.filter((b: string) => b === "first_sighting")).toHaveLength(1);

    const moments = await momentsFor(d);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.badge_ids).toContain("first_sighting");
  });

  it("an existing spotter's first spot after launch celebrates only badges this spot crossed", async () => {
    const d = device("existing");
    // Four cats spotted before launch: first_sighting is already met.
    for (let i = 0; i < 4; i++) {
      await insertResolvedSighting(d, await seedCat(`Old${i}`));
    }
    const fifth = await seedCat("Fifth");

    const res = await resolve(d, await insertSighting(d), { catId: fifth });
    expect(res.status).toBe(200);
    expect(res.body.newBadges).toEqual(["five_cats"]);

    const moments = await momentsFor(d);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.badge_ids).toEqual(["five_cats"]);
    // Met before this spot: saved, but from history, with no celebration.
    const stored = await storedBadges(d);
    expect(stored.get("first_sighting")).toBe("history");
    expect(stored.get("five_cats")).toBe("live");
  });

  it("badges are never removed: deleting the discovered cat leaves discover badges", async () => {
    await openBackfill();
    const d = device("keep");
    const res = await resolve(d, await insertSighting(d), {
      newCatName: `${CAT_PREFIX}-Keep-${++seq}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.newBadges).toEqual(expect.arrayContaining(["first_sighting", "first_discovery"]));

    await deleteCats([res.body.cat.id]);

    const profile = await request(app).get(`/api/profiles/${d}`).set("X-Device-Secret", SECRET);
    expect(profile.status).toBe(200);
    expect(profile.body.uniqueCatsDiscovered).toBe(0);
    expect(profile.body.badges).toEqual(expect.arrayContaining(["first_sighting", "first_discovery"]));
    const discovery = profile.body.badgeProgress.find((p: { id: string }) => p.id === "first_discovery");
    expect(discovery).toMatchObject({ earned: true, value: 1, goal: 1 });
  });
});

describe("event badges", () => {
  async function newCatAt(name: string, at: { lat: number; lng: number }) {
    return seedCat(name, at);
  }

  async function spotWithLedger(areaKey: string, daysAgo: number) {
    const catId = await seedCat(`PF${daysAgo}`);
    const spotter = device("pf-old");
    const sightingId = await insertResolvedSighting(spotter, catId, { areaKey });
    const earned = new Date(Date.now() - daysAgo * 86_400_000);
    await db.execute(sql`
      insert into points_ledger (device_id, sighting_id, cat_id, points, athens_day, week_start, earned_at, source)
      values (${spotter}, ${sightingId}, ${catId}, 15, ${athensDay(earned)}::date,
              ${weekStartAthens(earned)}::date, ${earned.toISOString()}::timestamptz, 'history')`);
  }

  it("pathfinder: new cat in an area with no spot for 31 days earns it, and 29 days does not", async () => {
    await openBackfill();
    const quiet = `vitest-pf-quiet-${++seq}`;
    const busy = `vitest-pf-busy-${++seq}`;
    await spotWithLedger(quiet, 31);
    await spotWithLedger(busy, 29);
    const at = new Date();

    const a = await eventBadgesForSpot(db, {
      deviceId: device("pf"), catId: await seedCat("PfA"), isNewCat: true, areaKey: quiet, at,
    });
    expect(a).toContain("pathfinder");

    const b = await eventBadgesForSpot(db, {
      deviceId: device("pf"), catId: await seedCat("PfB"), isNewCat: true, areaKey: busy, at,
    });
    expect(b).not.toContain("pathfinder");

    // Only a new cat finds a path.
    const c = await eventBadgesForSpot(db, {
      deviceId: device("pf"), catId: await seedCat("PfC"), isNewCat: false, areaKey: quiet, at,
    });
    expect(c).toEqual([]);
  });

  it("trailblazer: first cat in an area earns it; an area added after cats existed in it earns nobody", async () => {
    await openBackfill();
    const fresh = { key: `vitest-tb-fresh-${++seq}`, name: "Fresh", lat: 10, lng: 10 };
    const lived = { key: `vitest-tb-lived-${++seq}`, name: "Lived", lat: 11, lng: 11 };
    const at = new Date();
    vi.mocked(namedAreasAt).mockResolvedValue({ version: 999, areas: [fresh, lived] });

    // The first cat ever known in a new area.
    const first = await newCatAt("TbFirst", { lat: 10.001, lng: 10.001 });
    expect(
      await eventBadgesForSpot(db, { deviceId: device("tb"), catId: first, isNewCat: true, areaKey: fresh.key, at }),
    ).toContain("trailblazer");

    // A cat lived here, spotted before the area was on the list ("off").
    const earlier = await newCatAt("TbEarlier", { lat: 11.002, lng: 11.002 });
    await insertResolvedSighting(device("tb-old"), earlier, { areaKey: "off", at: { lat: 11.002, lng: 11.002 } });
    const later = await newCatAt("TbLater", { lat: 11.001, lng: 11.001 });
    expect(
      await eventBadgesForSpot(db, { deviceId: device("tb"), catId: later, isNewCat: true, areaKey: lived.key, at }),
    ).not.toContain("trailblazer");

    // A second cat in the first area: the first is known there now.
    await insertResolvedSighting(device("tb-old"), first, { areaKey: fresh.key, at: { lat: 10.001, lng: 10.001 } });
    const second = await newCatAt("TbSecond", { lat: 10.002, lng: 10.002 });
    expect(
      await eventBadgesForSpot(db, { deviceId: device("tb"), catId: second, isNewCat: true, areaKey: fresh.key, at }),
    ).not.toContain("trailblazer");

    // An area not on the list at the moment of the spot earns nothing.
    vi.mocked(namedAreasAt).mockResolvedValue({ version: 999, areas: [] });
    const lone = await newCatAt("TbLone", { lat: 12, lng: 12 });
    expect(
      await eventBadgesForSpot(db, { deviceId: device("tb"), catId: lone, isNewCat: true, areaKey: `vitest-tb-none-${++seq}`, at }),
    ).not.toContain("trailblazer");
    vi.mocked(namedAreasAt).mockReset();
  });

  it("event badges wait for the backfill", async () => {
    expect(await backfillFinished(db)).toBe(false);
    const quiet = `vitest-pf-gate-${++seq}`;
    const catId = await seedCat("Gate");
    const spot = { deviceId: device("gate"), catId, isNewCat: true, areaKey: quiet, at: new Date() };
    expect(await eventBadgesForSpot(db, spot)).toEqual([]);
    await openBackfill();
    expect(await eventBadgesForSpot(db, spot)).toContain("pathfinder");
  });
});

describe("awardBadges", () => {
  it("returns only the newly earned ids", async () => {
    const d = device("award");
    expect(await awardBadges(db, d, ["first_sighting", "explorer"], "live")).toEqual(["first_sighting", "explorer"]);
    expect(await awardBadges(db, d, ["explorer", "five_cats"], "history")).toEqual(["five_cats"]);
    expect((await storedBadges(d)).get("explorer")).toBe("live");
  });
});

describe("profile badges", () => {
  it("profile shows computed badges before the backfill has run", async () => {
    const d = device("computed");
    await insertResolvedSighting(d, await seedCat("Computed"));
    const before = await request(app).get(`/api/profiles/${d}`).set("X-Device-Secret", SECRET);
    expect(before.status).toBe(200);
    expect(before.body.badges).toContain("first_sighting");
    expect(before.body.badgeProgress.find((p: { id: string }) => p.id === "first_sighting").earned).toBe(true);

    // Once the backfill has run, stored badges are the whole list.
    await openBackfill();
    const after = await request(app).get(`/api/profiles/${d}`).set("X-Device-Secret", SECRET);
    expect(after.body.badges).not.toContain("first_sighting");
  });

  it("reports this week's points and every badge's progress", async () => {
    const d = device("week");
    const res = await resolve(d, await insertSighting(d), { catId: await seedCat("Week") });
    expect(res.status).toBe(200);
    expect(res.body.profile.weekPoints).toBe(15);
    const ids = res.body.profile.badgeProgress.map((p: { id: string }) => p.id);
    expect(ids).toHaveLength(22);
    expect(res.body.profile.badgeProgress.find((p: { id: string }) => p.id === "five_cats")).toMatchObject({
      group: "first_steps", earned: false, value: 1, goal: 5,
    });
  });
});

describe("moments and seen routes", () => {
  it("moments routes need the device secret", async () => {
    const d = device("auth");
    const res = await resolve(d, await insertSighting(d), { catId: await seedCat("Auth") });
    const momentId = res.body.momentId as number;

    for (const r of [
      request(app).get(`/api/profiles/${d}/moments`),
      request(app).post(`/api/profiles/${d}/moments/${momentId}/celebrated`),
      request(app).post(`/api/profiles/${d}/badges/seen`),
    ]) {
      expect((await r).status).toBe(401);
    }
    for (const r of [
      request(app).get(`/api/profiles/${d}/moments`),
      request(app).post(`/api/profiles/${d}/moments/${momentId}/celebrated`),
      request(app).post(`/api/profiles/${d}/badges/seen`),
    ]) {
      expect((await r.set("X-Device-Secret", "wrong-secret-0123456789abcdefghij")).status).toBe(403);
    }

    // Another spotter can't celebrate this one's moment.
    const other = device("other");
    const steal = await request(app)
      .post(`/api/profiles/${other}/moments/${momentId}/celebrated`)
      .set("X-Device-Secret", SECRET);
    expect(steal.status).toBe(204);

    const list = await request(app).get(`/api/profiles/${d}/moments`).set("X-Device-Secret", SECRET);
    expect(list.status).toBe(200);
    expect(list.body.moments).toEqual([
      { id: momentId, kind: "badges", badgeIds: ["first_sighting"], weekStart: null, place: null, weekPoints: null },
    ]);

    const done = await request(app)
      .post(`/api/profiles/${d}/moments/${momentId}/celebrated`)
      .set("X-Device-Secret", SECRET);
    expect(done.status).toBe(204);
    const empty = await request(app).get(`/api/profiles/${d}/moments`).set("X-Device-Secret", SECRET);
    expect(empty.body.moments).toEqual([]);
  });

  it("badges/seen clears newBadgeIds", async () => {
    const d = device("seen");
    const res = await resolve(d, await insertSighting(d), { catId: await seedCat("Seen") });
    expect(res.body.profile.newBadgeIds).toEqual(["first_sighting"]);

    const seen = await request(app).post(`/api/profiles/${d}/badges/seen`).set("X-Device-Secret", SECRET);
    expect(seen.status).toBe(204);
    const profile = await request(app).get(`/api/profiles/${d}`).set("X-Device-Secret", SECRET);
    expect(profile.body.newBadgeIds).toEqual([]);
    expect(profile.body.badges).toContain("first_sighting");
  });
});
