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
import { ilike, inArray, like, sql } from "drizzle-orm";
import { deleteTestSightings } from "../../test/sightings";

// Importing the app pulls in the AI matcher; keep it offline.
vi.mock("../matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

// Trailblazer reads the area list as it stood at each spot. The real history
// is shared by the whole run, so the Trailblazer test hands it made-up areas.
vi.mock("../areas/areaHistory", async (importOriginal) => {
  const real = await importOriginal<typeof import("../areas/areaHistory")>();
  return { ...real, namedAreasAt: vi.fn(real.namedAreasAt) };
});

import app from "../../app";
import { namedAreasAt } from "../areas/areaHistory";
import { currentAreas, loadAreas } from "../areas/namedAreas";
import { athensDay, weekStartAthens } from "../weeks";
import { runBadgeBackfillOnce, type BackfillStatus } from "./backfill";

// SYC-706 Task 7: on launch, existing spotters get the badges their past
// spots already earned, quietly, with one combined celebration.

const DEVICE = "vitest-backfill";
const CAT_PREFIX = "VitestBackfillCat";
const SECRET = "vitest-backfill-secret-0123456789abcdef";
const DRAIN_TOKEN = "vitest-backfill-drain-token-0123456789";
// Backfill versions no real run uses; each run in a test takes a fresh one.
const VERSION_BASE = 970_700;

const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let seq = 0;
const versions: number[] = [];
const nextVersion = () => {
  const v = VERSION_BASE + ++seq;
  versions.push(v);
  return v;
};
/** Each test's spotters share a prefix, and its runs touch only them. */
const scope = (tag: string) => `${DEVICE}-${tag}-${++seq}-`;

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function insertPhoto(): Promise<number> {
  const [p] = await db.insert(photosTable).values({ data: TINY_JPEG_B64, mime: "image/jpeg" }).returning();
  return p!.id;
}

async function seedCat(
  name: string,
  opts: { at?: { lat: number; lng: number }; discoverer?: string; createdAt?: Date } = {},
): Promise<number> {
  const at = opts.at ?? { lat: 37.4445, lng: 24.942 };
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${CAT_PREFIX}-${name}-${++seq}`,
      description: "",
      primaryPhotoId: await insertPhoto(),
      ...at,
      discovererDeviceId: opts.discoverer ?? `${DEVICE}-seed-discoverer`,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return c!.id;
}

/** A spot confirmed before launch: no ledger row, and (unless given) no place. */
async function oldSpot(
  deviceId: string,
  catId: number,
  opts: { at?: { lat: number; lng: number }; createdAt?: Date; areaKey?: string; onIsland?: boolean } = {},
): Promise<number> {
  const [s] = await db
    .insert(sightingsTable)
    .values({
      deviceId,
      photoId: await insertPhoto(),
      ...(opts.at ?? { lat: 37.4445, lng: 24.942 }),
      status: "resolved",
      catId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      ...(opts.areaKey !== undefined ? { areaKey: opts.areaKey, onIsland: opts.onIsland ?? false } : {}),
    })
    .returning();
  return s!.id;
}

async function pendingSpot(deviceId: string): Promise<number> {
  const [s] = await db
    .insert(sightingsTable)
    .values({ deviceId, photoId: await insertPhoto(), lat: 37.4445, lng: 24.942, status: "pending" })
    .returning();
  return s!.id;
}

const run = (devicePrefix: string, version = nextVersion()): Promise<BackfillStatus> =>
  runBadgeBackfillOnce({ version, devicePrefix });

async function storedBadges(deviceId: string) {
  const r = await db.execute(sql`
    select badge_id, source from spotter_badges where device_id = ${deviceId}`);
  return new Map(r.rows.map((row) => [String(row.badge_id), String(row.source)]));
}

async function momentsFor(deviceId: string) {
  const r = await db.execute(sql`
    select kind, badge_ids from badge_moments where device_id = ${deviceId} order by id`);
  return r.rows as { kind: string; badge_ids: string[] }[];
}

async function ledgerFor(deviceId: string) {
  const r = await db.execute(sql`
    select sighting_id, points, athens_day::text as athens_day, week_start::text as week_start,
           earned_at, source
    from points_ledger where device_id = ${deviceId} order by sighting_id`);
  return r.rows as {
    sighting_id: number; points: number; athens_day: string; week_start: string; earned_at: Date; source: string;
  }[];
}

/** Everything a run can write for a scope, counted. */
async function countsFor(prefix: string) {
  const like_ = `${prefix}%`;
  const r = await db.execute(sql`
    select
      (select count(*)::int from points_ledger where device_id like ${like_}) as ledger,
      (select count(*)::int from spotter_badges where device_id like ${like_}) as badges,
      (select count(*)::int from badge_moments where device_id like ${like_}) as moments,
      (select count(*)::int from sightings where device_id like ${like_} and area_key is not null) as stamped`);
  return r.rows[0];
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

async function deleteRuns() {
  // Task 6's "event badges wait for the backfill" needs no finished run left behind.
  await db.execute(sql`
    delete from badge_backfill_runs where version >= ${VERSION_BASE} and version < ${VERSION_BASE + 1000}`);
}

async function cleanup() {
  await deleteRuns();
  await db.execute(sql`delete from spotter_badges where device_id like ${DEVICE + "%"}`);
  await db.execute(sql`delete from badge_moments where device_id like ${DEVICE + "%"}`);
  await db.delete(pointsLedgerTable).where(like(pointsLedgerTable.deviceId, `${DEVICE}%`));
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(ilike(catsTable.name, `${CAT_PREFIX}%`));
  await deleteCats(cats.map((c) => c.id));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE}%`));
}

beforeAll(async () => {
  await cleanup();
  await loadAreas();
});
afterEach(async () => {
  vi.mocked(namedAreasAt).mockReset();
  const real = await vi.importActual<typeof import("../areas/areaHistory")>("../areas/areaHistory");
  vi.mocked(namedAreasAt).mockImplementation(real.namedAreasAt);
  await deleteRuns();
});
afterAll(cleanup);

describe("history backfill", () => {
  it("backfill awards weeks and areas from history and queues one history moment", async () => {
    const prefix = scope("weeks");
    const d = `${prefix}a`;
    const areas = currentAreas().slice(0, 3);
    expect(areas).toHaveLength(3);
    // Three cats in three areas, over two weeks.
    const taken = [daysAgo(20), daysAgo(19), daysAgo(5)];
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const at = { lat: areas[i]!.lat, lng: areas[i]!.lng };
      ids.push(await oldSpot(d, await seedCat(`Weeks${i}`, { at }), { at, createdAt: taken[i] }));
    }

    expect(await run(prefix)).toBe("done");

    const stored = await storedBadges(d);
    expect([...stored.keys()].sort()).toEqual(["areas_3", "first_sighting", "weeks_2"]);
    expect([...stored.values()].every((s) => s === "history")).toBe(true);

    const moments = await momentsFor(d);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.kind).toBe("history");
    expect([...moments[0]!.badge_ids].sort()).toEqual(["areas_3", "first_sighting", "weeks_2"]);

    // The place is stamped with today's areas; the week is the photo date.
    const stamped = await db.execute(sql`
      select id, area_key, on_island from sightings where id in ${sql.raw(`(${ids.join(",")})`)} order by id`);
    expect(stamped.rows.map((r) => r.area_key)).toEqual(areas.map((a) => a.key));
    expect(stamped.rows.every((r) => r.on_island === true)).toBe(true);
    const ledger = await ledgerFor(d);
    expect(ledger.map((l) => l.week_start)).toEqual(taken.map((t) => weekStartAthens(t)));
    expect(ledger.map((l) => l.athens_day)).toEqual(taken.map((t) => athensDay(t)));
    expect(ledger.map((l) => new Date(l.earned_at).getTime())).toEqual(taken.map((t) => t.getTime()));
    expect(ledger.every((l) => l.source === "history")).toBe(true);
  });

  it("running backfill twice changes nothing", async () => {
    const prefix = scope("twice");
    const d = `${prefix}a`;
    for (let i = 0; i < 5; i++) {
      await oldSpot(d, await seedCat(`Twice${i}`), { createdAt: daysAgo(3 + i * 7) });
    }
    expect(await run(prefix)).toBe("done");
    const first = await countsFor(prefix);
    expect(first).toMatchObject({ ledger: 5, moments: 1, stamped: 5 });

    // A second run (a fresh version, so it really does the work again).
    expect(await run(prefix)).toBe("done");
    expect(await countsFor(prefix)).toEqual(first);
  });

  it("history ledger rows have 0 points so this week's board is empty for them", async () => {
    const prefix = scope("board");
    const d = `${prefix}a`;
    await oldSpot(d, await seedCat("Board1"), { createdAt: new Date(Date.now() - 60_000) });
    await oldSpot(d, await seedCat("Board2"), { createdAt: new Date(Date.now() - 30_000) });
    expect(await run(prefix)).toBe("done");

    const ledger = await ledgerFor(d);
    expect(ledger).toHaveLength(2);
    expect(ledger.every((l) => l.points === 0 && l.week_start === weekStartAthens(new Date()))).toBe(true);

    const profile = await request(app).get(`/api/profiles/${d}`).set("X-Device-Secret", SECRET);
    expect(profile.status).toBe(200);
    expect(profile.body.weekPoints).toBe(0);
  });

  it("trailblazer from history follows the live rule", async () => {
    const prefix = scope("tb");
    const [first, second, late] = [`${prefix}first`, `${prefix}second`, `${prefix}late`];
    const known = { key: `vitest-bf-known-${++seq}`, name: "Known", lat: 10, lng: 10 };
    const added = { key: `vitest-bf-added-${++seq}`, name: "Added", lat: 11, lng: 11 };
    // `added` joined the list ten days ago; `known` was always there.
    const addedAt = daysAgo(10);
    vi.mocked(namedAreasAt).mockImplementation(async (at: Date) => ({
      version: 999,
      areas: at < addedAt ? [known] : [known, added],
    }));

    // The first cat in `known`, then a second one there a week later.
    const pos = { lat: 10.001, lng: 10.001 };
    const c1 = await seedCat("TbFirst", { at: pos, discoverer: first, createdAt: daysAgo(40) });
    await oldSpot(first, c1, { at: pos, createdAt: daysAgo(40), areaKey: known.key });
    const c2 = await seedCat("TbSecond", { at: pos, discoverer: second, createdAt: daysAgo(33) });
    await oldSpot(second, c2, { at: pos, createdAt: daysAgo(33), areaKey: known.key });

    // The first cat in `added`, found before the area was on the list.
    const posB = { lat: 11.001, lng: 11.001 };
    const c3 = await seedCat("TbLate", { at: posB, discoverer: late, createdAt: daysAgo(20) });
    await oldSpot(late, c3, { at: posB, createdAt: daysAgo(20), areaKey: added.key });

    expect(await run(prefix)).toBe("done");

    expect((await storedBadges(first)).has("trailblazer")).toBe(true);
    expect((await storedBadges(second)).has("trailblazer")).toBe(false);
    expect((await storedBadges(late)).has("trailblazer")).toBe(false);
    // Pathfinder: a quiet area for 30 days earns it; one spotted 7 days ago doesn't.
    expect((await storedBadges(first)).get("pathfinder")).toBe("history");
    expect((await storedBadges(second)).has("pathfinder")).toBe(false);
    expect((await momentsFor(first))[0]!.badge_ids).toEqual(
      expect.arrayContaining(["first_sighting", "first_discovery", "pathfinder", "trailblazer"]),
    );
  });

  it("a spotter with nothing earns nothing and gets no moment", async () => {
    const prefix = scope("nothing");
    const idle = `${prefix}idle`;
    await pendingSpot(idle);
    // And one whose badges are all held and celebrated already.
    const done = `${prefix}done`;
    await oldSpot(done, await seedCat("Done"));
    await db.execute(sql`
      insert into spotter_badges (device_id, badge_id, source) values (${done}, 'first_sighting', 'live')`);
    await db.execute(sql`
      insert into badge_moments (device_id, kind, badge_ids) values (${done}, 'badges', array['first_sighting'])`);

    expect(await run(prefix)).toBe("done");

    expect((await storedBadges(idle)).size).toBe(0);
    expect(await momentsFor(idle)).toEqual([]);
    expect(await ledgerFor(idle)).toEqual([]);
    expect((await momentsFor(done)).map((m) => m.kind)).toEqual(["badges"]);
  });

  it("history moment includes badges saved quietly by a resolve before the backfill", async () => {
    const prefix = scope("quiet");
    const d = `${prefix}a`;
    for (let i = 0; i < 4; i++) await oldSpot(d, await seedCat(`Quiet${i}`), { createdAt: daysAgo(2) });
    // A spot after launch, before the backfill: first_sighting is saved as
    // history with no moment, five_cats is celebrated live.
    const res = await request(app)
      .post(`/api/sightings/${await pendingSpot(d)}/resolve`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: d, catId: await seedCat("QuietFifth") });
    expect(res.status).toBe(200);
    expect(res.body.newBadges).toEqual(["five_cats"]);
    expect((await storedBadges(d)).get("first_sighting")).toBe("history");

    expect(await run(prefix)).toBe("done");

    const moments = await momentsFor(d);
    expect(moments.map((m) => m.kind)).toEqual(["badges", "history"]);
    expect(moments[1]!.badge_ids).toContain("first_sighting");
    expect(moments[1]!.badge_ids).not.toContain("five_cats");
  });

  it("a crashed run is resumed by the next drain", async () => {
    const prefix = scope("crash");
    const d = `${prefix}a`;
    await oldSpot(d, await seedCat("Crash"));

    // Claimed half an hour ago and never finished: the run died.
    const v = nextVersion();
    await db.execute(sql`
      insert into badge_backfill_runs (version, started_at) values (${v}, now() - interval '31 minutes')`);
    expect(await run(prefix, v)).toBe("done");
    expect((await storedBadges(d)).get("first_sighting")).toBe("history");
    const row = await db.execute(sql`select finished_at, spotters from badge_backfill_runs where version = ${v}`);
    expect(row.rows[0]!.finished_at).not.toBeNull();
    expect(row.rows[0]!.spotters).toBe(1);
    expect(await run(prefix, v)).toBe("already_done");

    // Claimed a moment ago: another drain is running it; leave it alone.
    const busyPrefix = scope("busy");
    await oldSpot(`${busyPrefix}a`, await seedCat("Busy"));
    const busy = nextVersion();
    await db.execute(sql`insert into badge_backfill_runs (version) values (${busy})`);
    expect(await run(busyPrefix, busy)).toBe("running");
    expect(await countsFor(busyPrefix)).toMatchObject({ ledger: 0, badges: 0 });
  });

  it("the drain runs the backfill once it is switched on", async () => {
    process.env["MAIL_DRAIN_TOKEN"] = DRAIN_TOKEN;
    // Nothing here may reach a real mail service.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const drain = () =>
      request(app).post("/api/internal/mail/drain").set("Authorization", `Bearer ${DRAIN_TOKEN}`);
    try {
      // Off under test by default: the real run would touch every file's data.
      // (The status is about welfare alerts other files may have left.)
      const off = await drain();
      expect(off.body.badgeBackfill).toBe("off");

      // Version 1 already finished: the drain finds it done.
      await db.execute(sql`insert into badge_backfill_runs (version, finished_at, spotters) values (1, now(), 0)`);
      process.env["BADGE_BACKFILL_ON_DRAIN"] = "on";
      const on = await drain();
      expect(on.body.badgeBackfill).toBe("already_done");
    } finally {
      vi.unstubAllGlobals();
      delete process.env["BADGE_BACKFILL_ON_DRAIN"];
      delete process.env["MAIL_DRAIN_TOKEN"];
      await db.execute(sql`delete from badge_backfill_runs where version = 1`);
    }
  });
});
