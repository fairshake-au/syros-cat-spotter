/**
 * Pure campaign date arithmetic. Kept out of the screen module so it can be
 * unit-tested without pulling React Native into the test environment — the
 * same split as `streak.ts` on the server, and for the same reason: timezone
 * boundaries are where this quietly goes wrong.
 */

/** The campaign runs on island time, same as the streak. */
export const CAMPAIGN_TIMEZONE = 'Europe/Athens';

/** Epoch ms for the last instant of `yyyy-mm-dd` in the given IANA zone. */
function endOfDayInZone(day: string, timeZone: string): number {
  // Find the zone's UTC offset on that date by formatting a probe instant in
  // it, then correcting. Avoids hardcoding +02/+03 and so survives DST.
  const probe = Date.parse(`${day}T12:00:00Z`);
  if (Number.isNaN(probe)) return Number.NaN;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(probe));
  const localHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  const offsetHours = localHour - 12;
  // Local 23:59:59.999 on `day` expressed as UTC.
  return Date.parse(`${day}T23:59:59.999Z`) - offsetHours * 3_600_000;
}

/**
 * Days remaining until `endsAt`. Never negative — a campaign that has already
 * closed reads as 0 rather than a negative number.
 *
 * A date-only `endsAt` (the server default is "2026-12-31") means "through the
 * end of that day in Syros", not UTC midnight. Parsing it naively made the
 * final local day read "0 days left" from about 02:00 Athens onward — the
 * urgency vanished while the campaign was still open.
 */
export function daysLeft(
  endsAt: string,
  now: Date = new Date(),
): number | null {
  const trimmed = endsAt.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const end = dateOnly
    ? endOfDayInZone(trimmed, CAMPAIGN_TIMEZONE)
    : new Date(trimmed).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

/**
 * Absolute https only — mirrors the server's `sanitizeDonateUrl`. The donate
 * button is trusted UI, so a tampered response must not be able to send someone
 * to an arbitrary scheme.
 */
export function safeDonateUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && parsed.hostname
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}
