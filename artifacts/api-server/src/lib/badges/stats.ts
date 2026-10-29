import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { currentAreas } from "../areas/namedAreas";
import type { BadgeStats } from "./catalogue";

/** The database, or a transaction on it. */
type Tx = Pick<typeof db, "execute">;

/** Everything the badge catalogue reads, counted from the database. */
export async function computeBadgeStats(
  tx: Tx,
  deviceId: string,
): Promise<BadgeStats> {
  const areaKeys = currentAreas().map((a) => a.key);
  const keyList = areaKeys.length
    ? sql.join(areaKeys.map((k) => sql`${k}`), sql`, `)
    : sql`null`;

  const profile = await tx.execute(sql`
    select points from profiles where device_id = ${deviceId}`);
  const counts = await tx.execute(sql`
    select count(*)::int as total, count(distinct cat_id)::int as cats
    from sightings where device_id = ${deviceId} and status = 'resolved'`);
  const discovered = await tx.execute(sql`
    select count(*)::int as n from cats where discoverer_device_id = ${deviceId}`);
  // Weeks with a spot: points for finding a duplicate (which-cat-is-which.md
  // §9.8) count on the week board, never as an active week (plan C4).
  const weeks = await tx.execute(sql`
    select count(distinct week_start)::int as n
    from points_ledger where device_id = ${deviceId} and sighting_id is not null`);
  const areas = await tx.execute(sql`
    select count(distinct area_key)::int as n
    from sightings
    where device_id = ${deviceId} and status = 'resolved'
      and area_key is not null and area_key <> 'off'
      and area_key in (${keyList})`);
  const remote = await tx.execute(sql`
    select count(distinct cat_id)::int as n
    from sightings
    where device_id = ${deviceId} and status = 'resolved'
      and area_key = 'off' and on_island = true`);
  const results = await tx.execute(sql`
    select
      count(*) filter (where place <= 3)::int as podiums,
      count(*) filter (where place = 1)::int as champions
    from weekly_results where device_id = ${deviceId}`);

  const n = (r: { rows: Record<string, unknown>[] }, k = "n") =>
    Number(r.rows[0]?.[k] ?? 0);

  return {
    points: n(profile, "points"),
    totalSightings: n(counts, "total"),
    catsSpotted: n(counts, "cats"),
    uniqueCatsDiscovered: n(discovered),
    weeksSpotted: n(weeks),
    areasSpotted: n(areas),
    areasTotal: areaKeys.length,
    remoteCats: n(remote),
    podiums: n(results, "podiums"),
    champions: n(results, "champions"),
  };
}
