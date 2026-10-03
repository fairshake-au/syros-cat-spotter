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
