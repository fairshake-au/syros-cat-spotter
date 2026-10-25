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

// The push's language is the one the phone registered with (push_tokens.language);
// a phone that never sent one (an old build) is sent English. The bell row keeps
// the English words for old builds; new builds word it from place and points.
// Never an area or a place on the island.
export type PushLanguage = "en" | "el" | "fr";

const MEDAL: Record<number, string> = { 2: "🥈", 3: "🥉" };

// Mirrors the app's formatRank (artifacts/cat-spotter/lib/formatRank.ts): English
// 2nd/3rd, French 2e/3e, Greek the plain number. Only places 2 and 3 are worded.
function rankWord(language: PushLanguage, place: number): string {
  if (language === "el") return String(place);
  if (language === "fr") return place === 1 ? "1er" : `${place}e`;
  return place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`;
}

const WEEK_COPY: Record<
  PushLanguage,
  { title: string; top: string; placed: (medal: string, rank: string) => string }
> = {
  en: {
    title: "Last week's top spotters",
    top: "🏆 You were the top spotter on Syros last week. You've earned Champion!",
    placed: (medal, rank) => `${medal} You came ${rank} on Syros last week. You've earned Podium!`,
  },
  el: {
    title: "Οι κορυφαίοι spotters της περασμένης εβδομάδας",
    top: "🏆 Ήσουν ο κορυφαίος spotter της Σύρου την περασμένη εβδομάδα. Κέρδισες το παράσημο Πρωταθλητής!",
    placed: (medal, rank) =>
      `${medal} Ήρθες στη θέση ${rank} στη Σύρο την περασμένη εβδομάδα. Κέρδισες το παράσημο Βάθρο!`,
  },
  fr: {
    title: "Les meilleurs spotters de la semaine dernière",
    top: "🏆 Tu as été le meilleur spotter de Syros la semaine dernière. Tu as gagné le badge Champion !",
    placed: (medal, rank) =>
      `${medal} Tu as terminé ${rank} à Syros la semaine dernière. Tu as gagné le badge Podium !`,
  },
};

/** The push's words, which are also the bell entry's stored words (in English), for a place of 1–3. */
export function weekResultText(
  place: number,
  language: string | null = "en",
): { title: string; body: string } {
  const copy = WEEK_COPY[language === "el" || language === "fr" ? language : "en"];
  const lang: PushLanguage = language === "el" || language === "fr" ? language : "en";
  if (place === 1) return { title: copy.title, body: copy.top };
  return { title: copy.title, body: copy.placed(MEDAL[place] ?? "🥉", rankWord(lang, place)) };
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

/** The Monday a week after `monday` (a YYYY-MM-DD Athens Monday). */
function nextMonday(monday: string): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Closes every week from the first eligible one up to last week (the week
 * before `now`'s) that nobody has closed yet, oldest first, each in its own
 * claim and transaction. A week missed because nothing reached the server for
 * more than 7 days therefore closes as soon as it is back. Resolves
 * "closed" if any week closed this call, else "already_closed", or
 * "not_due" before the first eligible week.
 */
export async function closeWeekIfDue(now: Date = new Date()): Promise<CloseResult> {
  const last = previousWeekStart(now);
  const first = await firstEligibleWeek();
  if (first === null || last < first) return "not_due";

  const done = await db.execute<{ week_start: string }>(sql`
    select to_char(week_start, 'YYYY-MM-DD') as week_start from weekly_closes
    where week_start between ${first}::date and ${last}::date`);
  const closedAlready = new Set(done.rows.map((r) => r.week_start));

  let result: CloseResult = "already_closed";
  for (let week = first; week <= last; week = nextMonday(week)) {
    if (closedAlready.has(week)) continue;
    if ((await closeOneWeek(week, now)) === "closed") result = "closed";
  }
  return result;
}

async function closeOneWeek(weekStart: string, now: Date): Promise<CloseResult> {
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
    const ranked = competitionRanks(await weekBoardRows(tx, weekStart, null), (r) =>
      Number(r.points),
    ).filter((r) => r.rank <= 3);

    // Each winner's badges lock, as every badge writer takes it, in device
    // order so two closes or a close and a resolve can never wait on each
    // other in a circle. Taken after the claim: a resolve takes only its own.
    for (const id of ranked.map((r) => r.device_id).sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"badges:" + id}))`);
    }

    // Account deletion (severPerson) takes the same lock first, so by now a
    // winner is either deleted for good or can't be deleted until this
    // commits. Re-read who still has a profile and drop the rest: nothing
    // written below may name, badge or notify a spotter who just deleted
    // themselves. Their place stays empty; the others keep theirs.
    const stillHere =
      ranked.length === 0
        ? new Set<string>()
        : new Set(
            (
              await tx.execute<{ device_id: string }>(sql`
                select device_id from profiles
                where device_id in (${sql.join(
                  ranked.map((r) => sql`${r.device_id}`),
                  sql`, `,
                )})`)
            ).rows.map((r) => r.device_id),
          );
    const placed = ranked.filter((r) => stillHere.has(r.device_id));

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
        insert into notifications (device_id, kind, message, place, week_points)
        values (${r.device_id}, 'week_result', ${weekResultText(r.rank).body}, ${r.rank}, ${points})`);
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
  const recipients = await db.execute<{ token: string; place: number; language: string | null }>(sql`
    select pt.token, wr.place, pt.language
    from weekly_results wr
    join push_tokens pt on pt.device_id = wr.device_id
    where wr.week_start = ${weekStart}::date`);
  await Promise.all(
    recipients.rows.map(async (r) => {
      const { title, body } = weekResultText(Number(r.place), r.language);
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
