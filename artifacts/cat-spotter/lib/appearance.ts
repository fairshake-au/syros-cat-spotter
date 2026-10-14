/**
 * SYC-2 PR 2.1 (coat-markings-and-health.md §5.2, §7.2; plan Decision E1):
 * a cat's colour and markings as one quiet line, "Ginger · Tabby · White
 * paws · One eye", on the cat page and each "Find the cat" card.
 *
 * App-side only; the server's `artifacts/api-server/src/lib/appearance.ts`
 * owns the vocabulary. The codes arrive here through the generated client's
 * `CatCoatItem` and `CatMarkingsItem`, so a new code on the server fails the
 * typecheck below until it has a label.
 *
 * Pure: separated from the screens so it has a direct test in every
 * language.
 */
// Types only: screens (and their tests) that mock the generated client
// still load this file.
import type { Cat, CatCoatItem, CatMarkingsItem } from '@workspace/api-client-react';

/** Every colour the public payload can carry, and the word it shows as. */
export const COAT_LABEL_KEYS: Record<CatCoatItem, string> = {
  black: 'coat_black',
  white: 'coat_white',
  ginger: 'coat_ginger',
  grey: 'coat_grey',
  tabby: 'coat_tabby',
  tortoiseshell_or_calico: 'coat_tortoiseshell_or_calico',
  black_and_white: 'coat_black_and_white',
};

/**
 * Every mark, and the word the public sees (spec §5.2): the chip's own word,
 * except the four recognition marks, which have their own display keys
 * ("One eye" for `missing_eye`).
 */
export const MARK_LABEL_KEYS: Record<CatMarkingsItem, string> = {
  white_paws: 'mark_white_paws',
  white_chest: 'mark_white_chest',
  white_face: 'mark_white_face',
  colourpoint: 'mark_colourpoint',
  long_fur: 'mark_long_fur',
  kinked_tail: 'mark_kinked_tail',
  torn_ear: 'mark_torn_ear',
  short_tail: 'markShown_short_tail',
  missing_eye: 'markShown_missing_eye',
  three_legs: 'markShown_three_legs',
  odd_eyes: 'markShown_odd_eyes',
};

/** The spec's order (§3.1, §3.2): the maps above are written in it, and a
 * test pins it to the generated enums. */
const COAT_ORDER = Object.keys(COAT_LABEL_KEYS) as CatCoatItem[];
const MARK_ORDER = Object.keys(MARK_LABEL_KEYS) as CatMarkingsItem[];

function inOrder<T extends string>(codes: readonly unknown[] | undefined, order: readonly T[]): T[] {
  if (!Array.isArray(codes)) return [];
  const present = new Set(codes);
  // Only known codes, once each: a code from a newer server, or anything
  // else, is left out rather than shown raw.
  return order.filter((code) => present.has(code));
}

/**
 * The i18n keys for a cat's line: colours first, then marks, each in the
 * spec's order. Empty when nothing is known, including for a cat from an
 * older server or an older cached catalogue, which has neither field.
 */
export function appearanceLabelKeys(cat: Pick<Cat, 'coat' | 'markings'>): string[] {
  return [
    ...inOrder(cat.coat, COAT_ORDER).map((c) => COAT_LABEL_KEYS[c]),
    ...inOrder(cat.markings, MARK_ORDER).map((m) => MARK_LABEL_KEYS[m]),
  ];
}

/** The line itself, joined with " · " in every language (E1), or null. */
export function appearanceLine(
  cat: Pick<Cat, 'coat' | 'markings'>,
  t: (key: string) => string,
): string | null {
  const keys = appearanceLabelKeys(cat);
  return keys.length > 0 ? keys.map(t).join(' · ') : null;
}
