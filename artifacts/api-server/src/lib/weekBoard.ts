import { sql } from "drizzle-orm";
import type { DbOrTx } from "./badges/award";
import { TEAM_DESK_DEVICE } from "./teamDesk";

/** One board row as the database hands it over, before it is made public. */
export type BoardRow = {
  device_id: string;
  username: string | null;
  nickname: string | null;
  points: number | string;
  unique_cats: number | string;
  tie_key: number | string | null;
};

/** How many cats this spotter was first to find (`p` is the profile). */
export const uniqueCatsSql = sql`(
  select count(*)::int from cats c
  where c.discoverer_device_id = p.device_id
)`;

/**
 * One week's board, best first: GET /leaderboard/week shows it live, and the
 * weekly close (lib/weeklyClose.ts) freezes its top three. Only scoring rows
 * count: history rows carry 0 points and never put anyone on 0. Order: points,
 * then whoever reached their total first (their latest scoring row that week,
 * earliest first), then the device id. Deleted spotters (no device id) and
 * devices with no profile are left out. `limit` null reads every row.
 *
 * Reads only through `q`, so the close can run it inside its transaction.
 */
export async function weekBoardRows(
  q: DbOrTx,
  weekStart: string,
  limit: number | null,
): Promise<BoardRow[]> {
  const r = await q.execute<BoardRow>(sql`
    select p.device_id, p.username, p.nickname, w.points,
      ${uniqueCatsSql} as unique_cats, w.tie_key
    from (
      select device_id, sum(points)::int as points,
        extract(epoch from max(earned_at))::float8 as tie_key
      from points_ledger
      where week_start = ${weekStart}::date and points > 0 and device_id is not null
        and device_id <> ${TEAM_DESK_DEVICE}
      group by device_id
    ) w
    join profiles p on p.device_id = w.device_id
    order by w.points desc, w.tie_key asc, p.device_id asc
    ${limit === null ? sql`` : sql`limit ${limit}`}`);
  return r.rows;
}

/** The name a frozen result shows: the board's username, else the nickname. */
export function boardDisplayName(r: Pick<BoardRow, "username" | "nickname">): string | null {
  return r.username ?? r.nickname ?? null;
}
