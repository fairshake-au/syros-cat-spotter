import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { POINTS_CONFIRM, POINTS_NEW_CAT } from "./points";
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
 * Runs inside the resolve transaction:
 *  - a transaction advisory lock on (spotter, cat), so two resolves of the
 *    same cat by the same spotter take turns;
 *  - then the check for a points-earning sighting row for that spotter, cat
 *    and day;
 *  - the partial unique index points_ledger_once_a_day_uq is the backstop:
 *    a second points-earning row for the same day is refused outright.
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

  // Sighting awards only, the same scope as the index: points for finding a
  // duplicate (which-cat-is-which.md §9.8) never make a spot a repeat.
  const earlier = await tx.execute(sql`
    select 1 from points_ledger
    where device_id = ${deviceId}
      and cat_id = ${catId}
      and athens_day = ${day}::date
      and sighting_id is not null
      and points > 0
    limit 1
  `);

  const repeatToday = earlier.rows.length > 0;
  const points = repeatToday ? 0 : isNewCat ? POINTS_NEW_CAT : POINTS_CONFIRM;
  // No conflict handling on purpose: under the lock the check above is
  // exact, so a clash with the unique index means a guard has broken, and
  // the whole resolve rolls back loudly rather than the clash being papered
  // over (so a broken guard shows up in tests and logs).
  await tx.execute(sql`
    insert into points_ledger
      (device_id, sighting_id, cat_id, points, athens_day, week_start, earned_at, source)
    values
      (${deviceId}, ${sightingId}, ${catId}, ${points}, ${day}::date, ${weekStart}::date, ${at}, 'live')
  `);
  return { points, repeatToday };
}
