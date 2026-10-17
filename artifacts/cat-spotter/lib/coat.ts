/**
 * SYC-398 (coat-colours-and-pattern.md §2, §5, §6): a cat's coat as colours
 * you can see plus one pattern, on the app side.
 *
 * Two readers, on purpose:
 * - `filterParts` reads the new fields only. A cat without them (an older
 *   server, or a catalogue cached before them) is not known, so the old,
 *   lossy `coat` field never decides a filter.
 * - `displayParts` reads the new fields, or translates an old cached `coat`
 *   by the same table as the server's `readCoatValue` (§6), so the app never
 *   shows an old word such as Tabby.
 *
 * Pure, so it has a direct test.
 */
// Types only: screens (and their tests) that mock the generated client
// still load this file.
import type { Cat } from '@workspace/api-client-react';

export const COLOURS = ['black', 'grey', 'brown', 'ginger', 'white'] as const;
export type Colour = (typeof COLOURS)[number];
export const PATTERNS = ['plain', 'stripes', 'patches'] as const;
export type Pattern = (typeof PATTERNS)[number];
export type CoatFields = Pick<Cat, 'coat' | 'coatColours' | 'coatPattern'>;
export type Parts = { colours: Colour[] | null; pattern: Pattern | null };

const hasNewFields = (cat: CoatFields) => cat.coatColours !== undefined || cat.coatPattern !== undefined;

/** The cat's coat for the FILTER: the new fields only; a cat without them is not known. */
export function filterParts(cat: CoatFields): Parts {
  if (!hasNewFields(cat)) return { colours: null, pattern: null };
  const colours = COLOURS.filter((c) => (cat.coatColours ?? []).includes(c));
  return { colours: colours.length ? colours : null, pattern: PATTERNS.find((p) => p === cat.coatPattern) ?? null };
}

/** The cat's coat for DISPLAY: the new fields, or the old `coat` translated by the same table as the server (§6), so no old word is ever shown. */
export function displayParts(cat: CoatFields): Parts {
  if (hasNewFields(cat)) return filterParts(cat);
  const codes = Array.isArray(cat.coat) ? (cat.coat as string[]) : [];
  const colours = new Set<string>();
  let pattern: Pattern | null = null;
  for (const c of codes) {
    if (c === 'tabby') continue;
    if (c === 'black_and_white') { colours.add('black'); colours.add('white'); }
    else if (c === 'tortoiseshell_or_calico') { colours.add('black'); colours.add('ginger'); pattern ??= 'patches'; }
    else colours.add(c);
  }
  // As the server: an old "tabby" gives Stripes unless the coat already
  // reads as Patches, and beside it a bare white is not the coat's colour
  // (the tabby's own colour was never said).
  if (codes.includes('tabby')) {
    pattern ??= 'stripes';
    if (codes.includes('white') && !codes.includes('black_and_white')) colours.delete('white');
  }
  const ordered = COLOURS.filter((c) => colours.has(c));
  return { colours: ordered.length ? ordered : null, pattern };
}

/** i18n keys for the coat part of the display line: colours, then the pattern unless plain. */
export function coatLineKeys(cat: CoatFields): string[] {
  const { colours, pattern } = displayParts(cat);
  return [...(colours ?? []).map((c) => `coat_${c}`), ...(pattern && pattern !== 'plain' ? [`pattern_${pattern}`] : [])];
}

export type Placement = 'match' | 'not_known' | 'hidden';
/** What someone has picked in the two chip rows; an empty row is *All*. */
export type Picked = { colours: ReadonlySet<Colour>; patterns: ReadonlySet<Pattern> };

/** Spec §5: hidden if any picked row is a known mismatch; else not_known if any picked row is unknown; else match. Plain and Patches are forgiving for a cat with White. Reads the new fields only. */
export function placeCat(cat: CoatFields, picked: Picked): Placement {
  const { colours, pattern } = filterParts(cat);
  const rows: ('match' | 'mismatch' | 'unknown')[] = [];
  if (picked.colours.size) rows.push(colours === null ? 'unknown' : colours.some((c) => picked.colours.has(c)) ? 'match' : 'mismatch');
  if (picked.patterns.size) {
    const forgiving = !!colours?.includes('white') && (pattern === 'plain' || pattern === 'patches');
    const ok = pattern !== null && (picked.patterns.has(pattern) || (forgiving && (picked.patterns.has('plain') || picked.patterns.has('patches'))));
    rows.push(pattern === null ? 'unknown' : ok ? 'match' : 'mismatch');
  }
  if (rows.includes('mismatch')) return 'hidden';
  if (rows.includes('unknown')) return 'not_known';
  return 'match';
}

/** True when either row has a chip picked: what the match record calls `colour_filter_on` (§5). */
export function filterIsOn(picked: Picked): boolean {
  return picked.colours.size > 0 || picked.patterns.size > 0;
}

/** Every cat counted once, in the order given: the matches, the Not known, and how many are hidden (§5). */
export function placeCats<T extends CoatFields>(cats: readonly T[], picked: Picked): { matching: T[]; notKnown: T[]; hidden: number } {
  const out = { matching: [] as T[], notKnown: [] as T[], hidden: 0 };
  for (const cat of cats) {
    const place = placeCat(cat, picked);
    if (place === 'match') out.matching.push(cat);
    else if (place === 'not_known') out.notKnown.push(cat);
    else out.hidden += 1;
  }
  return out;
}
