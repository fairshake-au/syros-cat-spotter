import { db, pushRoundupRunsTable } from "@workspace/db";
import { desc, lt, sql } from "drizzle-orm";
import { sendPushNotification } from "./push";
import { isResolvedDeceased } from "./catHelpers";
import { logger, safeError } from "./logger";

/**
 * The evening sighting round-up (data-spine.md PR 9, spec §6.4.4; Q4 = A,
 * decided by Samuel 2 Oct).
 *
 * A live "Agatha was spotted again!" gave anyone who once spotted a cat a
 * to-the-minute record of every later sighting, and so of when her cat
 * guardian comes to feed. So for a cat the recipient doesn't own, the
 * sighting push is held back (`fanOutNotifications` sends it only to the
 * owner) and this sends at most one push per person per evening, naming the
 * cats and never a time.
 *
 * Triggered by the existing 10-minute mail-drain schedule
 * (POST /api/internal/mail/drain), not a timer: the deployment can sleep.
 * The first drain at or after {@link ROUND_UP_HOUR} Athens time sends it.
 * The `push_roundup_runs` row for that Athens date is the claim, so two
 * drains (or two servers) never send the same evening twice.
 *
 * Who gets it is read from the in-app `notifications` rows the fan-out
 * already writes, joined to `push_tokens`. SYC-63's deletion removes both
 * for a deleted device, so a deleted person is never sent anything.
 *
 * Best-effort, like every push: if the server dies mid-send, that evening's
 * remaining pushes are lost, never sent twice.
 */

/** Europe/Athens hour (0–23) from which the evening's round-up is due. */
export const ROUND_UP_HOUR = 20;
const TIME_ZONE = "Europe/Athens";
/** A missed evening rolls into the next, but never reaches back further. */
const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

function athensParts(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

/**
 * The round-up's words. Never a time, a clock reading or "x minutes ago"
 * (§6.4.4: "spotted again today", not a timestamp), whatever the cats.
 */
export function roundUpText(catNames: readonly string[]): {
  title: string;
  body: string;
} {
  const title = "Cats you follow";
  const [first, second] = catNames;
  if (catNames.length <= 1) return { title, body: `${first} was spotted today.` };
  if (catNames.length === 2) {
    return { title, body: `${first} and ${second} were spotted today.` };
  }
  const others = catNames.length - 1;
  return {
    title,
    body: `${first} and ${others} other cats you follow were spotted today.`,
  };
}

export type RoundUpResult =
  | { status: "not_due" }
  | { status: "already_sent" }
  | { status: "sent"; devices: number; pushes: number };

type Row = {
  device_id: string;
  token: string;
  cat_id: number;
  cat_name: string;
  last_seen: string;
};

export async function sendDailyRoundUp(now: Date = new Date()): Promise<RoundUpResult> {
  const { date, hour } = athensParts(now);
  if (hour < ROUND_UP_HOUR) return { status: "not_due" };

  // The window runs from where the last evening's ended, so nothing falls
  // between two round-ups, but never further back than 48 hours.
  const [previous] = await db
    .select({ windowEnd: pushRoundupRunsTable.windowEnd })
    .from(pushRoundupRunsTable)
    .where(lt(pushRoundupRunsTable.roundUpDate, date))
    .orderBy(desc(pushRoundupRunsTable.roundUpDate))
    .limit(1);
  const floor = new Date(now.getTime() - MAX_WINDOW_MS);
  const windowStart =
    previous && previous.windowEnd > floor ? previous.windowEnd : floor;

  const claimed = await db
    .insert(pushRoundupRunsTable)
    .values({ roundUpDate: date, windowStart, windowEnd: now })
    .onConflictDoNothing()
    .returning({ roundUpDate: pushRoundupRunsTable.roundUpDate });
  if (claimed.length === 0) return { status: "already_sent" };

  // Sighting updates in the window, for every follower who isn't the cat's
  // owner (owners had the live push) and still has a push token.
  const result = await db.execute(sql`
    select n.device_id, pt.token, c.id as cat_id, c.name as cat_name,
           max(cu.created_at) as last_seen
      from notifications n
      join cat_updates cu on cu.id = n.cat_update_id
      join cats c on c.id = cu.cat_id
      join push_tokens pt on pt.device_id = n.device_id
     where cu.update_type = 'sighting'
       and cu.created_at >= ${windowStart.toISOString()}
       and cu.created_at < ${now.toISOString()}
       and n.device_id is not null
       and n.device_id not like 'deleted:%'
       and c.owner_device_id is distinct from n.device_id
     group by n.device_id, pt.token, c.id, c.name
     order by n.device_id, last_seen desc
  `);
  const rows = result.rows as Row[];

  // §3.3: never a word about a cat recorded as dead since it was seen.
  const catIds = [...new Set(rows.map((r) => r.cat_id))];
  const deceased = new Set<number>();
  for (const id of catIds) {
    if (await isResolvedDeceased(id)) deceased.add(id);
  }

  const byDevice = new Map<string, { token: string; cats: { id: number; name: string }[] }>();
  for (const r of rows) {
    if (deceased.has(r.cat_id)) continue;
    const entry = byDevice.get(r.device_id) ?? { token: r.token, cats: [] };
    entry.cats.push({ id: r.cat_id, name: r.cat_name });
    byDevice.set(r.device_id, entry);
  }

  let pushes = 0;
  await Promise.all(
    [...byDevice.values()].map(async ({ token, cats }) => {
      const { title, body } = roundUpText(cats.map((c) => c.name));
      pushes += 1;
      await sendPushNotification(token, title, body, {
        type: "sighting_round_up",
        catIds: cats.map((c) => c.id),
      });
    }),
  );

  await db
    .update(pushRoundupRunsTable)
    .set({ finishedAt: new Date(), devices: byDevice.size })
    .where(sql`${pushRoundupRunsTable.roundUpDate} = ${date}`)
    .catch((err: unknown) =>
      logger.warn({ err: safeError(err), date }, "round-up: could not record finish"),
    );

  logger.info({ date, devices: byDevice.size }, "sighting round-up sent");
  return { status: "sent", devices: byDevice.size, pushes };
}
