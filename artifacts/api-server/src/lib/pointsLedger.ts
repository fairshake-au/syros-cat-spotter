import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { POINTS_CONFIRM, POINTS_NEW_CAT } from "../routes/sightings";
import { athensDay, weekStartAthens } from "./weeks";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AwardInput {
  deviceId: string;
  sightingId: number;
  catId: number;
  isNewCat: boolean;
  /** The moment of the spot: the resolve time. */
  at: Date;
}

export interface Award {
  points: number;
  /** True when this spotter already earned for this cat this Athens day. */
  repeatToday: boolean;
}

/**
 * SYC-706: writes this resolve's row to the points ledger and says how many
 * points it earns. A spotter earns for a given cat once per Athens day; a
 * later spot of that cat the same day is recorded with 0 points.
 *
 * Runs inside the resolve transaction. Three guards, each enough alone for
 * the common case:
 *  - a transaction advisory lock on (spotter, cat), so two resolves of the
 *    same cat by the same spotter take turns;
 *  - the check for a points-earning row for that spotter, cat and day;
 *  - the partial unique index points_ledger_once_a_day_uq, with the insert
 *    falling back to a 0-point row if it ever loses that race.
 *
 * The caller adds `points` to profiles.points only when it is above 0.
 */
export async function awardPoints(tx: Tx, input: AwardInput): Promise<Award> {
  const { deviceId, sightingId, catId, isNewCat, at } = input;
  const day = athensDay(at);
  const weekStart = weekStartAthens(at);

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"points:" + deviceId}), ${catId}::int)`,
  );

  const earlier = await tx.execute(sql`
    select 1 from points_ledger
    where device_id = ${deviceId}
      and cat_id = ${catId}
      and athens_day = ${day}::date
      and points > 0
    limit 1
  `);

  if (earlier.rows.length === 0) {
    const full = isNewCat ? POINTS_NEW_CAT : POINTS_CONFIRM;
    const inserted = await tx.execute(sql`
      insert into points_ledger
        (device_id, sighting_id, cat_id, points, athens_day, week_start, earned_at, source)
      values
        (${deviceId}, ${sightingId}, ${catId}, ${full}, ${day}::date, ${weekStart}::date, ${at}, 'live')
      on conflict (device_id, cat_id, athens_day) where points > 0 do nothing
      returning id
    `);
    if (inserted.rows.length > 0) return { points: full, repeatToday: false };
  }

  await tx.execute(sql`
    insert into points_ledger
      (device_id, sighting_id, cat_id, points, athens_day, week_start, earned_at, source)
    values
      (${deviceId}, ${sightingId}, ${catId}, 0, ${day}::date, ${weekStart}::date, ${at}, 'live')
  `);
  return { points: 0, repeatToday: true };
}
