import { CAMPAIGN_TIMEZONE } from './campaignDates';

/**
 * Athens calendar days, as 'YYYY-MM-DD' (SYC-36, match-wait plan C9). The
 * daily one-liner is "the first spot of each Athens day", so days must turn
 * at Syros midnight, through both daylight-saving changes, never at a fixed
 * offset. Pure, so it is tested with fixed instants.
 */
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAMPAIGN_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function athensDay(instantMs: number): string {
  const parts = formatter.formatToParts(new Date(instantMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days from day `a` to day `b` (both 'YYYY-MM-DD'); negative if b is
 * earlier. Calendar arithmetic only, so a 23- or 25-hour day is still one. */
export function athensDaysBetween(a: string, b: string): number {
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}
