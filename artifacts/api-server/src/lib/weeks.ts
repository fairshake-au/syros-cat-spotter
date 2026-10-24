import { STREAK_TIMEZONE } from "./streak";

// Weeks run Monday 00:00 to the next Monday 00:00, Athens time. Every
// function here works from the Athens calendar, so the two clock changes a
// year (a 23-hour and a 25-hour day) never shift a week boundary.

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: STREAK_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY_FROM_MONDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const weekdayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STREAK_TIMEZONE,
  weekday: "short",
});

/** The Athens calendar day of an instant, as "YYYY-MM-DD". */
export function athensDay(at: Date): string {
  return dayFormat.format(at);
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** The date of the Athens Monday that starts the week containing `at`. */
export function weekStartAthens(at: Date): string {
  const back = WEEKDAY_FROM_MONDAY[weekdayFormat.format(at)]!;
  return addDays(athensDay(at), -back);
}

/** The UTC instant of Monday 00:00 Athens on the given "YYYY-MM-DD". */
export function weekStartInstant(weekStart: string): Date {
  const [y, m, d] = weekStart.split("-").map(Number);
  const midnightUtc = Date.UTC(y!, m! - 1, d!);
  // Athens is UTC+2 or UTC+3. Try each offset and keep the one that lands
  // back on midnight Athens of that date.
  for (const offsetHours of [2, 3]) {
    const candidate = new Date(midnightUtc - offsetHours * 3_600_000);
    if (
      athensDay(candidate) === weekStart &&
      athensDay(new Date(candidate.getTime() - 1)) !== weekStart
    ) {
      return candidate;
    }
  }
  throw new Error(`weekStartInstant: no Athens midnight for ${weekStart}`);
}

/** The instant the week after the one containing `at` begins. */
export function nextWeekStartInstant(at: Date): Date {
  return weekStartInstant(addDays(weekStartAthens(at), 7));
}
