import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { namedAreasAt } from "../areas/areaHistory";
import { areaForIn, OFF_SYROS } from "../areas/namedAreas";

// SYC-706 Task 6: badges are saved once earned, inside the spot's own
// transaction, and each new batch queues one celebration moment.

/**
 * The database, or a transaction on it. Everything here reads only through
 * it, never the global `db`: inside the resolve transaction a second pool
 * connection, taken while holding locks, can deadlock the pool.
 */
export type DbOrTx = Pick<typeof db, "execute" | "select">;

/** Pathfinder's quiet period. */
export const PATHFINDER_QUIET_DAYS = 30;

// A box comfortably wider than an area's 2 km radius (about 3.3 km of
// latitude, 2.6 km of longitude at Syros), to narrow the cats checked by
// distance before the exact nearest-centre test.
const NEAR_DEG = 0.03;

/**
 * True once the history backfill (Task 7) has finished. Until then older
 * spots have no stamped area and no ledger row, so event badges would be
 * awarded wrongly, and stored badges are not yet the whole list.
 */
export async function backfillFinished(tx: DbOrTx): Promise<boolean> {
  const r = await tx.execute(
    sql`select 1 from badge_backfill_runs where finished_at is not null limit 1`,
  );
  return r.rows.length > 0;
}

export interface SpotEvent {
  deviceId: string;
  catId: number;
  isNewCat: boolean;
  /** The sighting's stamped area key ("off" = none). */
  areaKey: string | null;
  /** The moment of the spot: the resolve time. */
  at: Date;
}

/**
 * The badges earned by the moment of this spot rather than by totals:
 * Pathfinder and Trailblazer. Empty until the history backfill has finished.
 */
export async function eventBadgesForSpot(tx: DbOrTx, spot: SpotEvent): Promise<string[]> {
  if (!spot.isNewCat || !spot.areaKey || spot.areaKey === OFF_SYROS.key) return [];
  if (!(await backfillFinished(tx))) return [];
  return eventBadgesUngated(tx, spot);
}

/**
 * The same rules without the backfill gate, for the history backfill
 * (Task 7), which runs before the gate opens. With `registeredBefore`, only
 * cats registered before this one count as known for Trailblazer: history
 * replays spots after later cats exist, while a live spot is always the
 * latest.
 */
export async function eventBadgesUngated(
  tx: DbOrTx,
  spot: SpotEvent,
  opts: { registeredBefore?: boolean } = {},
): Promise<string[]> {
  const { catId, isNewCat, areaKey, at } = spot;
  if (!isNewCat || !areaKey || areaKey === OFF_SYROS.key) return [];

  const earned: string[] = [];

  // Pathfinder: nobody confirmed a spot in this area in the 30 days before
  // this one, counted by when spots were confirmed (the ledger's earned_at;
  // the capture time only for a spot with no ledger row).
  const since = new Date(at.getTime() - PATHFINDER_QUIET_DAYS * 86_400_000);
  const recent = await tx.execute(sql`
    select 1
    from sightings s
    left join points_ledger l on l.sighting_id = s.id
    where s.status = 'resolved'
      and s.area_key = ${areaKey}
      and s.cat_id is distinct from ${catId}
      and coalesce(l.earned_at, s.created_at) >= ${since.toISOString()}::timestamptz
      and coalesce(l.earned_at, s.created_at) < ${at.toISOString()}::timestamptz
    limit 1
  `);
  if (recent.rows.length === 0) earned.push("pathfinder");

  if (await isFirstCatInArea(tx, catId, areaKey, at, opts.registeredBefore === true)) {
    earned.push("trailblazer");
  }
  return earned;
}

/**
 * Trailblazer: when the new cat was registered, no other cat was known in
 * that area, and the area was on the list at that moment. "Known" is either
 * of:
 *  - the other cat's first confirmed spot is stamped with this area;
 *  - the other cat's position falls in this area on the list as it stood at
 *    the moment of this spot (namedAreasAt(at)). This catches an area the
 *    team adds where cats already lived: their
 *    spots were stamped before the area existed, so the stamp alone would
 *    hand the badge to the next new cat there (spec §2: nobody gets it).
 * Cats the team registered themselves count as known. Removed (redacted)
 * cats do not. With `registeredBefore`, a cat counts only if it was
 * registered before this one (by created_at, then id).
 */
async function isFirstCatInArea(
  tx: DbOrTx,
  catId: number,
  areaKey: string,
  at: Date,
  registeredBefore: boolean,
): Promise<boolean> {
  const { areas } = await namedAreasAt(at, tx);
  const area = areas.find((a) => a.key === areaKey);
  if (!area) return false;
  const earlier = (alias: string) =>
    registeredBefore
      ? sql`and (${sql.raw(alias)}.created_at, ${sql.raw(alias)}.id) <
              (select created_at, id from cats where id = ${catId})`
      : sql``;

  const stamped = await tx.execute(sql`
    select 1
    from sightings s
    join cats c on c.id = s.cat_id
    where s.area_key = ${areaKey}
      and s.status = 'resolved'
      and s.cat_id <> ${catId}
      and c.redacted_at is null
      ${earlier("c")}
      and not exists (
        select 1 from sightings e
        where e.cat_id = s.cat_id and e.status = 'resolved' and e.id < s.id
      )
    limit 1
  `);
  if (stamped.rows.length > 0) return false;

  const near = await tx.execute(sql`
    select lat, lng from cats
    where id <> ${catId}
      and redacted_at is null
      ${earlier("cats")}
      and lat between ${area.lat - NEAR_DEG} and ${area.lat + NEAR_DEG}
      and lng between ${area.lng - NEAR_DEG} and ${area.lng + NEAR_DEG}
  `);
  return !near.rows.some(
    (r) => areaForIn(areas, Number(r.lat), Number(r.lng)).key === areaKey,
  );
}

/**
 * Saves badges as earned. A badge already held is left as it was, so the
 * returned ids are exactly the newly earned ones, even when two spots race:
 * the loser waits on the winner's row and then inserts nothing.
 */
export async function awardBadges(
  tx: DbOrTx,
  deviceId: string,
  ids: readonly string[],
  source: "live" | "history" | "week",
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const values = sql.join(
    unique.map((id) => sql`(${deviceId}, ${id}, ${source})`),
    sql`, `,
  );
  const r = await tx.execute(sql`
    insert into spotter_badges (device_id, badge_id, source)
    values ${values}
    on conflict do nothing
    returning badge_id
  `);
  const inserted = new Set(r.rows.map((row) => String(row.badge_id)));
  // Keep the caller's order.
  return unique.filter((id) => inserted.has(id));
}

export interface MomentInput {
  deviceId: string;
  kind: "badges" | "week_result" | "history";
  badgeIds: readonly string[];
  weekStart?: string | null;
  place?: number | null;
  weekPoints?: number | null;
}

/** Queues one celebration for the app to play. Returns the moment's id. */
export async function queueMoment(tx: DbOrTx, m: MomentInput): Promise<number> {
  const ids = sql`array[${sql.join(
    m.badgeIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  const r = await tx.execute(sql`
    insert into badge_moments (device_id, kind, badge_ids, week_start, place, week_points)
    values (${m.deviceId}, ${m.kind}, ${m.badgeIds.length ? ids : sql`'{}'::text[]`},
            ${m.weekStart ?? null}::date, ${m.place ?? null}, ${m.weekPoints ?? null})
    returning id
  `);
  return Number(r.rows[0]!.id);
}
