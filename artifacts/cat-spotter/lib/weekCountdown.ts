/**
 * SYC-706: "New week in 3 days" / "in 5 hours" for the weekly Spotters board.
 * Days are Europe/Athens calendar days counted from the server's `endsAt`
 * (next Monday 00:00 Athens), never hours / 24, so clock changes cannot skew it.
 */
const ATHENS = 'Europe/Athens';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ATHENS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Athens calendar date of an instant, as a day number (UTC midnight of that date). */
function athensDay(ms: number): number {
  const parts = dayFormat.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000;
}

export type WeekCountdown = { unit: 'days' | 'hours'; n: number };

/**
 * The week's last Athens day is the one holding the final millisecond before
 * `endsAt`. Days left = that day minus today; on the last day, count hours.
 */
export function weekCountdown(endsAt: string, now: Date): WeekCountdown | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end) || end <= now.getTime()) return null;
  const days = athensDay(end - 1) - athensDay(now.getTime());
  if (days > 0) return { unit: 'days', n: days };
  return { unit: 'hours', n: Math.max(1, Math.ceil((end - now.getTime()) / 3_600_000)) };
}
