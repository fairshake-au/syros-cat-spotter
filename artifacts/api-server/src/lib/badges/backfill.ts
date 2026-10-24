import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { currentAreas, loadAreas } from "../areas/namedAreas";
import { placeFor } from "../areas/placeFor";
import { athensDay, weekStartAthens } from "../weeks";
import { awardBadges, eventBadgesUngated, queueMoment, type DbOrTx } from "./award";
import { BADGE_CATALOGUE, thresholdBadges } from "./catalogue";
import { computeBadgeStats } from "./stats";

// SYC-706 Task 7: on launch, existing spotters get the badges their past
// spots already earned, quietly (no push), with one combined celebration.
//
// It runs from the mail drain until a run has finished. Every write is
// "insert if missing" or "stamp if unstamped", so running it again, or
// resuming a run that died, changes nothing that is already done.
//
// Two passes over the spotters, one short transaction per spotter, each
// taking the spotter's badge lock first (the resolve takes the same lock as
// its first statement), so a resolve running alongside sees a spotter
// either wholly before or wholly after each step:
//  1. stamp each old spot's place (today's areas) and give it a 0-point
//     history ledger row dated by the photo;
//  2. award the badges that history earns, and queue one 'history' moment.
// The second pass waits for the first to finish for everyone, because
// Pathfinder and Trailblazer read other spotters' places.

/** The run every server does. Tests use their own versions. */
export const BACKFILL_VERSION = 1;

/** Spotters per page. */
const PAGE = 200;

/**
 * A claimed run untouched for this long has died (a restart, a timeout), and
 * the next drain takes it over. A live run touches its claim after each page.
 */
const STALE_MINUTES = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BackfillStatus = "done" | "already_done" | "running";

export interface BackfillOptions {
  version?: number;
  /** Tests only: limit the run to device ids with this prefix. */
  devicePrefix?: string;
}

/** Whether the drain runs it: always, except under test unless switched on. */
export function backfillOnDrainEnabled(): boolean {
  const flag = process.env["BADGE_BACKFILL_ON_DRAIN"];
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env["NODE_ENV"] !== "test";
}

/**
 * Claims the run. "go" if this caller now owns it: a fresh claim, or one a
 * dead run left unfinished for over STALE_MINUTES.
 */
async function claim(version: number): Promise<"go" | "already_done" | "running"> {
  const fresh = await db.execute(sql`
    insert into badge_backfill_runs (version) values (${version})
    on conflict do nothing
    returning version`);
  if (fresh.rows.length > 0) return "go";

  const stale = await db.execute(sql`
    update badge_backfill_runs set started_at = now()
    where version = ${version}
      and finished_at is null
      and started_at < now() - make_interval(mins => ${STALE_MINUTES})
    returning version`);
  if (stale.rows.length > 0) return "go";

  const row = await db.execute(sql`
    select finished_at from badge_backfill_runs where version = ${version}`);
  return row.rows[0]?.finished_at != null ? "already_done" : "running";
}

async function touch(version: number): Promise<void> {
  await db.execute(sql`
    update badge_backfill_runs set started_at = now()
    where version = ${version} and finished_at is null`);
}

/** Every spotter with a confirmed spot, a page at a time, in device order. */
async function* spotters(devicePrefix: string | undefined): AsyncGenerator<string[]> {
  const scoped = devicePrefix === undefined ? sql`` : sql`and device_id like ${devicePrefix + "%"}`;
  let after = "";
  for (;;) {
    const r = await db.execute(sql`
      select distinct device_id from sightings
      where status = 'resolved' and device_id is not null and device_id > ${after}
        ${scoped}
      order by device_id
      limit ${PAGE}`);
    const page = r.rows.map((row) => String(row.device_id));
    if (page.length === 0) return;
    yield page;
    after = page[page.length - 1]!;
  }
}

async function lockSpotter(tx: Tx, deviceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + deviceId}))`);
}

/** Stamps unstamped confirmed spots with today's areas. `where` picks the rows. */
async function stampPlaces(tx: Tx, where: ReturnType<typeof sql>, limit?: number): Promise<number> {
  const r = await tx.execute(sql`
    select id, lat, lng from sightings
    where status = 'resolved' and area_key is null and on_island is null and ${where}
    order by id
    ${limit === undefined ? sql`` : sql`limit ${limit}`}`);
  if (r.rows.length === 0) return 0;
  const areas = currentAreas();
  const values = sql.join(
    r.rows.map((row) => {
      const place = placeFor(Number(row.lat), Number(row.lng), areas);
      return sql`(${Number(row.id)}::int, ${place.areaKey}::text, ${place.onIsland}::boolean)`;
    }),
    sql`, `,
  );
  // The append-only trigger allows exactly this: both columns, once, on a
  // row that has neither.
  await tx.execute(sql`
    update sightings s set area_key = v.area_key, on_island = v.on_island
    from (values ${values}) as v(id, area_key, on_island)
    where s.id = v.id and s.area_key is null and s.on_island is null`);
  return r.rows.length;
}

/** Pass 1 for one spotter: places, and 0-point ledger rows dated by the photo. */
async function stampSpotter(deviceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockSpotter(tx, deviceId);
    await stampPlaces(tx, sql`device_id = ${deviceId}`);

    const missing = await tx.execute(sql`
      select s.id, s.cat_id, s.created_at
      from sightings s
      where s.device_id = ${deviceId} and s.status = 'resolved' and s.cat_id is not null
        and not exists (select 1 from points_ledger l where l.sighting_id = s.id)
      order by s.id`);
    if (missing.rows.length === 0) return;
    const values = sql.join(
      missing.rows.map((row) => {
        const taken = new Date(row.created_at as string | Date);
        return sql`(${deviceId}, ${Number(row.id)}, ${Number(row.cat_id)}, 0,
                    ${athensDay(taken)}::date, ${weekStartAthens(taken)}::date,
                    ${taken.toISOString()}::timestamptz, 'history')`;
      }),
      sql`, `,
    );
    // earned_at is the photo date too: history has no confirmation time, and
    // a backfill-time stamp would make every area look busy to Pathfinder.
    await tx.execute(sql`
      insert into points_ledger
        (device_id, sighting_id, cat_id, points, athens_day, week_start, earned_at, source)
      values ${values}
      on conflict (sighting_id) do nothing`);
  });
}

/** Pass 1 for spots whose spotter deletion has unlinked: places only. */
async function stampUnlinked(): Promise<void> {
  for (;;) {
    const n = await db.transaction((tx) => stampPlaces(tx, sql`device_id is null`, 500));
    if (n === 0) return;
  }
}

/**
 * Pathfinder and Trailblazer for each cat this spotter registered, judged at
 * the cat's first confirmed spot by them, under the live rules. Ungated:
 * the live gate opens only when this run finishes.
 */
async function historyEventBadges(tx: DbOrTx, deviceId: string): Promise<string[]> {
  const found = await tx.execute(sql`
    select distinct on (s.cat_id)
      s.cat_id, s.area_key, coalesce(l.earned_at, s.created_at) as at
    from sightings s
    join cats c on c.id = s.cat_id
    left join points_ledger l on l.sighting_id = s.id
    where s.device_id = ${deviceId} and s.status = 'resolved'
      and c.discoverer_device_id = ${deviceId}
    order by s.cat_id, s.id`);
  const earned = new Set<string>();
  for (const row of found.rows) {
    const ids = await eventBadgesUngated(
      tx,
      {
        deviceId,
        catId: Number(row.cat_id),
        isNewCat: true,
        areaKey: row.area_key == null ? null : String(row.area_key),
        at: new Date(row.at as string | Date),
      },
      { registeredBefore: true },
    );
    ids.forEach((id) => earned.add(id));
  }
  return [...earned];
}

const catalogueOrder = new Map(BADGE_CATALOGUE.map((d, i) => [d.id, i]));

/** Pass 2 for one spotter. True if a history moment was queued. */
async function awardSpotter(deviceId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockSpotter(tx, deviceId);
    const ids = thresholdBadges(await computeBadgeStats(tx, deviceId));
    const events = await historyEventBadges(tx, deviceId);
    await awardBadges(tx, deviceId, [...ids, ...events], "history");

    // One celebration for every quiet badge not yet celebrated: this run's,
    // and any a resolve saved as history before the run (with no moment).
    const quiet = await tx.execute(sql`
      select b.badge_id from spotter_badges b
      where b.device_id = ${deviceId} and b.source = 'history' and b.seen_at is null
        and not exists (
          select 1 from badge_moments m
          where m.device_id = ${deviceId} and b.badge_id = any(m.badge_ids)
        )`);
    const badgeIds = quiet.rows
      .map((r) => String(r.badge_id))
      .sort((a, b) => (catalogueOrder.get(a) ?? 999) - (catalogueOrder.get(b) ?? 999));
    if (badgeIds.length === 0) return false;
    await queueMoment(tx, { deviceId, kind: "history", badgeIds });
    return true;
  });
}

/**
 * Runs the history backfill if no run has finished. Safe to call on every
 * drain: once done it is one read. Throws on failure, leaving the claim
 * unfinished, so a later drain resumes it after STALE_MINUTES.
 */
export async function runBadgeBackfillOnce(opts: BackfillOptions = {}): Promise<BackfillStatus> {
  const version = opts.version ?? BACKFILL_VERSION;
  const claimed = await claim(version);
  if (claimed !== "go") return claimed;

  // Today's areas, freshly read.
  await loadAreas();

  for await (const page of spotters(opts.devicePrefix)) {
    for (const deviceId of page) await stampSpotter(deviceId);
    await touch(version);
  }
  if (opts.devicePrefix === undefined) await stampUnlinked();

  let count = 0;
  for await (const page of spotters(opts.devicePrefix)) {
    for (const deviceId of page) {
      await awardSpotter(deviceId);
      count++;
    }
    await touch(version);
  }

  // Only now: the live gate (backfillFinished) opens on this.
  await db.execute(sql`
    update badge_backfill_runs set finished_at = now(), spotters = ${count}
    where version = ${version}`);
  return "done";
}
