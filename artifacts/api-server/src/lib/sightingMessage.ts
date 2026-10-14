import { STREAK_TIMEZONE } from "./streak";

const DAY_MS = 86_400_000;
const LIVE_WINDOW_MS = DAY_MS;
const WEEKDAY_UP_TO_DAYS = 6;

function athensDay(at: Date): { ymd: string; weekday: string; dayMonth: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STREAK_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: STREAK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { ymd, weekday: get("weekday"), dayMonth: `${get("day")} ${get("month")}` };
}

function utcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/**
 * The owner's live push for a sighting of a cat they own (SYC-166 slice 3,
 * spec test 14, Decision D1). A photo can be logged days after it was taken
 * (a library photo, or a sighting queued without signal), and "spotted
 * again!" would then tell the owner their cat was seen just now.
 *
 * Up to 24 hours old: "spotted again!", as before. Older: the weekday, up to
 * 6 Athens days back ("seen on Tuesday"); from 7 days the weekday would read
 * as this week's, so the date ("seen on 3 October"). Days are Athens days,
 * like the streak's (`streak.ts`), so a cat seen at 00:30 on Syros is seen
 * that day, not the UTC day before.
 *
 * Only the owner's notification row and push carry this text: the evening
 * round-up writes its own words (`sightingRoundUp.ts`'s `roundUpText`), and
 * sighting updates never reach the public timeline. Pure, so the day
 * arithmetic is tested without a database.
 */
export function spottedAgainMessage(catName: string, sightingAt: Date, now: Date): string {
  if (now.getTime() - sightingAt.getTime() <= LIVE_WINDOW_MS) {
    return `${catName} was spotted again!`;
  }
  const seen = athensDay(sightingAt);
  // Both are UTC midnights, so this is a whole number of days whatever the
  // clocks did in Athens in between.
  const daysBack = (utcMidnight(athensDay(now).ymd) - utcMidnight(seen.ymd)) / DAY_MS;
  return daysBack <= WEEKDAY_UP_TO_DAYS
    ? `${catName} was seen on ${seen.weekday}`
    : `${catName} was seen on ${seen.dayMonth}`;
}
