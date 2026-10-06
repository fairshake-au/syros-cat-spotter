/**
 * Data spine PR 4 (cat-record-data-spine.md §3.5, §4.2): the cat page shows
 * one of five mutually exclusive life lines and one of four sterilised
 * lines. Pure logic, separated from `app/cat/[id].tsx`'s rendering so it has
 * a direct, language-independent test and the i18n keys it picks from can be
 * checked across every language without rendering the screen.
 */
import type { Cat } from '@workspace/api-client-react';
import { Language, TRANSLATIONS } from './i18n';

export type LifeLineKey =
  | 'lifeStatusStreet'
  | 'lifeStatusHomed'
  | 'lifeStatusInCare'
  | 'lifeStatusDeceased';

export type LifeLine = { key: LifeLineKey } | { key: 'notSeenSince'; date: string };

const LIFE_STATUS_KEYS: Record<Cat['lifeStatus'], LifeLineKey> = {
  street: 'lifeStatusStreet',
  homed: 'lifeStatusHomed',
  in_care: 'lifeStatusInCare',
  deceased: 'lifeStatusDeceased',
};

/**
 * §3.4: "Not seen since {date}" takes the place the ordinary lifeStatus line
 * would otherwise occupy — never alongside it, never a headline, and never
 * the word "presumed". `notSeenSince` and `lifeStatus: "deceased"` never
 * both apply to the same cat (the resolver's own invariant, resolve.ts), so
 * this never has to choose between them; it just prefers notSeenSince when
 * present.
 */
export function lifeLine(cat: Pick<Cat, 'lifeStatus' | 'notSeenSince'>): LifeLine {
  if (cat.notSeenSince) return { key: 'notSeenSince', date: cat.notSeenSince };
  return { key: LIFE_STATUS_KEYS[cat.lifeStatus] };
}

export type SterilisedLineKey =
  | 'sterilisedConfirmedTrue'
  | 'sterilisedConfirmedFalse'
  | 'sterilisedLikely'
  | 'sterilisedUnknown';

/**
 * §4.2's table. `reported` (the fourth confidence level, not yet reachable
 * -- resolve.ts's doc comment) falls through to the same "Not known yet"
 * text as `unknown`, so a future resolver change that starts emitting it
 * degrades gracefully rather than rendering nothing.
 */
export function sterilisedLineKey(sterilised: Cat['sterilised']): SterilisedLineKey {
  if (sterilised.confidence === 'confirmed') {
    return sterilised.value ? 'sterilisedConfirmedTrue' : 'sterilisedConfirmedFalse';
  }
  if (sterilised.confidence === 'likely') return 'sterilisedLikely';
  return 'sterilisedUnknown';
}

/** Every language has a non-empty string for every key these functions can
 * pick -- used by the i18n coverage test below so a missing translation
 * fails loudly instead of rendering the raw key on a phone. */
export const STATUS_LINE_KEYS = [
  'lifeStatusStreet',
  'lifeStatusHomed',
  'lifeStatusInCare',
  'lifeStatusDeceased',
  'notSeenSince',
  'sterilisedConfirmedTrue',
  'sterilisedConfirmedFalse',
  'sterilisedLikely',
  'sterilisedUnknown',
] as const;

export function textFor(language: Language, key: (typeof STATUS_LINE_KEYS)[number]): string {
  const dict = TRANSLATIONS[language] as Record<string, string>;
  return dict[key];
}

/**
 * `notSeenSince` is a bare calendar date (`YYYY-MM-DD`, no time or offset,
 * catHelpers.ts's `toPublicDate`). `new Date('YYYY-MM-DD')` parses that as
 * UTC midnight (the ISO 8601 date-only rule), and `.toLocaleDateString()`
 * then renders it in the *viewer's* local timezone -- for anyone west of
 * UTC (most tourists reading this app on a phone from outside Greece), UTC
 * midnight falls in the previous local day, so the cat page would read
 * "Not seen since 2 June" for a date the server meant as 3 June. Building
 * the Date from its y/m/d parts directly (local midnight, no UTC
 * round-trip) keeps the calendar date exactly what the server sent,
 * whatever timezone the phone is in.
 */
export function parseDateOnly(dateOnly: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) {
    throw new Error(`parseDateOnly: not a bare YYYY-MM-DD date: ${dateOnly}`);
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * A public date from the API: last seen, a sighting, a care event. Since
 * data spine PR 6 these are bare YYYY-MM-DD dates (spec §6.4.4), read as
 * the same calendar day in any timezone (see parseDateOnly). Anything else
 * (an older server's full timestamp) is read as before.
 */
export function parsePublicDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
}
