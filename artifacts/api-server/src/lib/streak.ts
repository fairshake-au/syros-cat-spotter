/**
 * Pure streak arithmetic. Deliberately free of database imports so the
 * day-boundary logic — the part that goes silently wrong — can be unit-tested
 * without provisioning Postgres. The query lives in `catHelpers.ts`.
 */

/**
 * Spotting days are bucketed in Europe/Athens, not UTC. Syros is UTC+2/+3, so a
 * cat spotted at 23:30 local time falls on the *previous* UTC day — bucketing in
 * UTC would silently split one evening's spotting across two days and hand the
 * user a streak they didn't earn (or break one they did).
 */
export const STREAK_TIMEZONE = "Europe/Athens";

const DAY_MS = 86_400_000;

function toUtcMillis(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/**
 * Count consecutive spotting days ending today or yesterday.
 *
 * Pure so it can be unit-tested without a database — the day-boundary arithmetic
 * is the part that gets silently wrong, and a wrong streak renders as a
 * perfectly plausible number.
 *
 * @param days  distinct 'YYYY-MM-DD' spotting days, sorted newest first
 * @param today 'YYYY-MM-DD' for "now" in {@link STREAK_TIMEZONE}
 */
export function streakFromDays(days: string[], today: string): number {
  const todayMs = toUtcMillis(today);

  // Dedupe and drop anything in the future, so neither a repeated day nor a
  // device with a skewed clock can inflate or wipe out a real streak. Sorted
  // newest-first rather than trusting the caller's ordering.
  const ordered = [...new Set(days)]
    .map(toUtcMillis)
    .filter((ms) => ms <= todayMs)
    .sort((a, b) => b - a);

  if (ordered.length === 0) return 0;

  // A streak survives a day that isn't over yet: spotting yesterday but not (yet)
  // today still counts. Anything older than yesterday is a broken streak.
  if (todayMs - ordered[0]! > DAY_MS) return 0;

  let streak = 1;
  let cursorMs = ordered[0]!;
  for (const dayMs of ordered.slice(1)) {
    if (cursorMs - dayMs !== DAY_MS) break;
    streak += 1;
    cursorMs = dayMs;
  }
  return streak;
}

// en-CA formats as YYYY-MM-DD, which is what the SQL side emits too. Built
// once: constructing an Intl.DateTimeFormat is far slower than using one, and
// the resolver asks for thousands of Athens days per cat (SYC-2 PR 1.2).
const STREAK_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: STREAK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in {@link STREAK_TIMEZONE}, as 'YYYY-MM-DD'. */
export function todayInStreakTimezone(now: Date = new Date()): string {
  return STREAK_DAY_FORMAT.format(now);
}
