import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { awardBadges, queueMoment, type DbOrTx } from "./badges/award";
import { competitionRanks } from "./ranking";
import { boardDisplayName, weekBoardRows } from "./weekBoard";
import { athensDay, weekStartAthens, weekStartInstant } from "./weeks";
import { sendPushNotification } from "./push";
import { logger, safeError } from "./logger";
import { STREAK_TIMEZONE } from "./streak";

/**
 * The weekly close and the Monday push (SYC-706, spec "Weekly board").
 *
 * Once a week, last week's top three are frozen into `weekly_results`, each
 * gets Podium (and the top place Champion), a celebration to play next time
 * they open the app, and a bell entry. On the Monday that week closed, between
 * 08:00 and 20:00 Athens, each of them with a push token gets one push.
 *
 * Two triggers, like the evening round-up: the mail drain
 * (routes/internalMail.ts) and, throttled, any API request
 * (`opportunisticWeeklyClose`). Both are safe to run any number of times:
 *  - the close claims the week by inserting its `weekly_closes` row, in the
 *    same transaction that writes the results, badges, celebrations and bell
 *    entries. A parallel close waits on that row and then claims nothing; a
 *    close that fails leaves the week unclaimed for the next trigger.
 *  - the push claims `pushed_at` (update ... where pushed_at is null) and
 *    commits before sending anything. Pushes are best effort: if the server
 *    dies mid-send, the rest are lost, never sent twice.
 *
 * Pushes and bell entries never name an area or a place on the island: a
 * lock screen is public.
 */

/** Athens hours, [from, until), in which the Monday push may go out. */
export const WEEK_PUSH_FROM_HOUR = 8;
export const WEEK_PUSH_UNTIL_HOUR = 20;

// Ruling 6: the round-up has no per-device language, so neither does this.
// English, from the spec's wording. Never an area or a place on the island.
const PUSH_WEEK_TITLE = "Last week's top spotters";
const ORDINAL: Record<number, string> = { 2: "2nd", 3: "3rd" };
const MEDAL: Record<number, string> = { 2: "🥈", 3: "🥉" };

/** The push's words, which are also the bell entry's, for a place of 1–3. */
export function weekResultText(place: number): { title: string; body: string } {
  if (place === 1) {
    return {
      title: PUSH_WEEK_TITLE,
      body: "🏆 You were the top spotter on Syros last week. You've earned Champion!",
    };
  }
  return {
    title: PUSH_WEEK_TITLE,
    body: `${MEDAL[place] ?? "🥉"} You came ${ORDINAL[place] ?? `${place}th`} on Syros last week. You've earned Podium!`,
  };
}

/** The Monday that starts the week before the one containing `at`. */
function previousWeekStart(at: Date): string {
  return weekStartAthens(new Date(weekStartInstant(weekStartAthens(at)).getTime() - 1));
}

/**
 * The first week that can close: the Athens Monday after the week of the
 * earliest live ledger row, so the first full week after this version went
 * live. History rows (the backfill's, dated by the old spots) never count.
 * Null until anyone has spotted with this version.
 */
export async function firstEligibleWeek(q: DbOrTx = db): Promise<string | null> {
  const r = await q.execute<{ first: string | null }>(sql`
    select to_char(min(week_start) + 7, 'YYYY-MM-DD') as first
    from points_ledger where source = 'live'`);
  return r.rows[0]?.first ?? null;
}

export type CloseResult = "not_due" | "already_closed" | "closed";

/** Closes last week (the week before `now`'s) if nobody has yet. */
export async function closeWeekIfDue(now: Date = new Date()): Promise<CloseResult> {
  const weekStart = previousWeekStart(now);
  const first = await firstEligibleWeek();
  if (first === null || weekStart < first) return "not_due";

  return db.transaction(async (tx): Promise<CloseResult> => {
    // The claim. A parallel close blocks here until this one commits, then
    // inserts nothing; if this one rolls back, it claims instead.
    const claimed = await tx.execute(sql`
      insert into weekly_closes (week_start, closed_at)
      values (${weekStart}::date, ${now.toISOString()}::timestamptz)
      on conflict do nothing
      returning week_start`);
    if (claimed.rows.length === 0) return "already_closed";

    // Equal points share a place; within a place, whoever got there first is
    // listed first. No minimum: one spotter on 15 points is champion.
    const placed = competitionRanks(await weekBoardRows(tx, weekStart, null), (r) =>
      Number(r.points),
    ).filter((r) => r.rank <= 3);

    // Each winner's badges lock, as every badge writer takes it, in device
    // order so two closes or a close and a resolve can never wait on each
    // other in a circle. Taken after the claim: a resolve takes only its own.
    for (const id of placed.map((r) => r.device_id).sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + id}))`);
    }

    for (const r of placed) {
      const points = Number(r.points);
      await tx.execute(sql`
        insert into weekly_results (week_start, place, device_id, display_name, points)
        values (${weekStart}::date, ${r.rank}, ${r.device_id}, ${boardDisplayName(r)}, ${points})`);
      const badgeIds = r.rank === 1 ? ["podium", "champion"] : ["podium"];
      await awardBadges(tx, r.device_id, badgeIds, "week");
      // Every podium week is celebrated, even when the badge is already held.
      await queueMoment(tx, {
        deviceId: r.device_id,
        kind: "week_result",
        badgeIds,
        weekStart,
        place: r.rank,
        weekPoints: points,
      });
      await tx.execute(sql`
        insert into notifications (device_id, kind, message)
        values (${r.device_id}, 'week_result', ${weekResultText(r.rank).body})`);
    }
    logger.info({ weekStart, placed: placed.length }, "weekly close: week closed");
    return "closed";
  });
}

export type WeekPushResult = "not_due" | "outside_window" | "sent" | "already_sent";

const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: STREAK_TIMEZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * Sends the Monday push for the week that just closed: only on that Monday
 * (Athens), only from 08:00 until 20:00, and only once. A week that closed
 * after 20:00, or on a later day, never gets one: the celebration still plays
 * when the spotter next opens the app.
 */
export async function sendWeeklyPushesIfDue(now: Date = new Date()): Promise<WeekPushResult> {
  // The Monday the week closes is the first day of the week containing now.
  const thisWeek = weekStartAthens(now);
  if (athensDay(now) !== thisWeek) return "not_due";
  const hour = Number(hourFormat.format(now));
  if (hour < WEEK_PUSH_FROM_HOUR || hour >= WEEK_PUSH_UNTIL_HOUR) return "outside_window";

  const weekStart = previousWeekStart(now);
  const claimed = await db.execute(sql`
    update weekly_closes set pushed_at = ${now.toISOString()}::timestamptz
    where week_start = ${weekStart}::date and pushed_at is null
    returning week_start`);
  if (claimed.rows.length === 0) {
    const closed = await db.execute(sql`
      select 1 from weekly_closes where week_start = ${weekStart}::date`);
    return closed.rows.length > 0 ? "already_sent" : "not_due";
  }

  // The claim has committed (no transaction here), so a crash from now on
  // loses pushes rather than sending them twice.
  const recipients = await db.execute<{ token: string; place: number }>(sql`
    select pt.token, wr.place
    from weekly_results wr
    join push_tokens pt on pt.device_id = wr.device_id
    where wr.week_start = ${weekStart}::date`);
  await Promise.all(
    recipients.rows.map(async (r) => {
      const { title, body } = weekResultText(Number(r.place));
      await sendPushNotification(r.token, title, body, { type: "weekly_result", weekStart });
    }),
  );
  logger.info({ weekStart, pushes: recipients.rows.length }, "weekly close: pushes sent");
  return "sent";
}

/** Off under test unless WEEKLY_CLOSE_ON_REQUEST=on; "off" turns it off anywhere. */
function onRequestEnabled(): boolean {
  const flag = process.env["WEEKLY_CLOSE_ON_REQUEST"];
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env["NODE_ENV"] !== "test";
}

/** Off under test unless WEEKLY_CLOSE_ON_DRAIN=on; "off" turns it off anywhere. */
export function weeklyCloseOnDrainEnabled(): boolean {
  const flag = process.env["WEEKLY_CLOSE_ON_DRAIN"];
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env["NODE_ENV"] !== "test";
}

const OPPORTUNISTIC_EVERY_MS = 5 * 60_000;
let lastTry = 0;
/** The week this server has seen closed and its push settled, if any. */
let settledWeek: string | null = null;

/** The close, then the push. Each failure is logged, never thrown. */
export async function runWeeklyClose(now: Date = new Date()): Promise<{
  close: CloseResult | "error";
  push: WeekPushResult | "error";
}> {
  let close: CloseResult | "error";
  try {
    close = await closeWeekIfDue(now);
  } catch (err) {
    logger.error({ err: safeError(err) }, "weekly close failed");
    close = "error";
  }
  let push: WeekPushResult | "error";
  try {
    push = await sendWeeklyPushesIfDue(now);
  } catch (err) {
    logger.error({ err: safeError(err) }, "weekly push failed");
    push = "error";
  }
  return { close, push };
}

/**
 * Express middleware, the close's second trigger: after any API response,
 * try the close and the push, at most every 5 minutes per server, at any
 * hour (unlike the round-up), and not at all once this server has seen last
 * week closed and its push settled.
 */
export function opportunisticWeeklyClose(
  _req: unknown,
  res: { on(event: "finish", cb: () => void): unknown },
  next: () => void,
): void {
  if (onRequestEnabled()) {
    res.on("finish", () => {
      const now = new Date();
      if (now.getTime() - lastTry < OPPORTUNISTIC_EVERY_MS) return;
      const week = previousWeekStart(now);
      if (settledWeek === week) return;
      lastTry = now.getTime();
      void runWeeklyClose(now).then(({ close, push }) => {
        const closed = close === "closed" || close === "already_closed";
        // Settled once nothing more can happen for that week: pushed, or
        // past the window (any day after Monday, or Monday after 20:00).
        const pastMonday = athensDay(now) !== weekStartAthens(now);
        const pushSettled =
          push === "sent" ||
          push === "already_sent" ||
          pastMonday ||
          Number(hourFormat.format(now)) >= WEEK_PUSH_UNTIL_HOUR;
        if (closed && pushSettled) settledWeek = week;
      });
    });
  }
  next();
}
