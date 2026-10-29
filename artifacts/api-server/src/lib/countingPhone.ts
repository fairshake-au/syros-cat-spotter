import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { TEAM_DESK_DEVICE } from "./teamDesk";
import type { DbOrTx } from "./observations";

/**
 * "Who counts as a person here" (which-cat-is-which.md §3.2, §9.6). A new
 * phone costs nothing to set up, so a duplicate report only counts towards
 * *Likely*, and only earns points (§3.4, D10), from a phone with at least
 * three resolved sightings on three different Syros days. Reports from
 * other phones still show on the list, marked "new phone" (PR 5.1).
 *
 * The one rule, used by the merge's points (PR 4.1) and the Possible
 * duplicates ladder (PR 5.1), so the two can never disagree.
 *
 * - A sighting counts only once it is resolved (matched to a cat): a spot
 *   still waiting for its spotter, or for the team, proves nothing yet.
 * - Days are Syros calendar days (Europe/Athens), by when the spot was sent,
 *   which the server stamped (a phone can't set it).
 * - A deleted spotter's sightings carry no device, so they count for nobody.
 * - The team desk (spots the team files on someone's behalf) is never a
 *   person.
 * - `asOf`: count only spots sent by then (a report is judged by the phone
 *   as it was when it reported, if the caller wants that).
 */

/** How many different Syros days of resolved spots make a phone count. */
export const COUNTING_PHONE_DAYS = 3;

export async function countingPhones(
  deviceIds: Iterable<string | null>,
  opts: { asOf?: Date } = {},
  exec: Pick<DbOrTx, "execute"> = db,
): Promise<Set<string>> {
  const ids = [...new Set([...deviceIds].filter((d): d is string => d !== null && d !== TEAM_DESK_DEVICE))];
  if (ids.length === 0) return new Set();
  const at = opts.asOf ?? null;
  const r = await exec.execute<{ device_id: string }>(sql`
    select s.device_id
      from sightings s
     where s.device_id in (${sql.join(
       ids.map((d) => sql`${d}`),
       sql`, `,
     )})
       and s.status = 'resolved'
       and (${at}::timestamptz is null or s.created_at <= ${at}::timestamptz)
     group by s.device_id
    having count(distinct (s.created_at at time zone 'Europe/Athens')::date) >= ${COUNTING_PHONE_DAYS}`);
  return new Set(r.rows.map((row) => row.device_id));
}

/** {@link countingPhones} for one phone. */
export async function isCountingPhone(
  deviceId: string | null,
  opts: { asOf?: Date } = {},
  exec: Pick<DbOrTx, "execute"> = db,
): Promise<boolean> {
  if (deviceId === null) return false;
  return (await countingPhones([deviceId], opts, exec)).has(deviceId);
}
