/**
 * SYC-398 PR D (coat-colours-and-pattern.md §5; plan Task D.1): where "Find
 * the cat" places each cat for the two chip rows. A cat is never hidden
 * because its coat isn't known.
 */
import { describe, expect, it } from 'vitest';
import {
  COLOURS,
  PATTERNS,
  filterIsOn,
  placeCat,
  placeCats,
  type CoatFields,
  type Colour,
  type Pattern,
  type Picked,
  type Placement,
} from '../coat';

const pick = (colours: Colour[] = [], patterns: Pattern[] = []): Picked => ({
  colours: new Set(colours),
  patterns: new Set(patterns),
});

type Part = 'match' | 'mismatch' | 'unknown';
const PARTS: Part[] = ['match', 'mismatch', 'unknown'];

// Picked: Black in the colour row, Stripes in the pattern row. No White
// anywhere, so the Plain/Patches forgiveness never applies in the matrix.
const COLOUR_FOR: Record<Part, Colour[]> = { match: ['black'], mismatch: ['grey'], unknown: [] };
const PATTERN_FOR: Record<Part, Pattern | null> = { match: 'stripes', mismatch: 'plain', unknown: null };
const ROWS = {
  none: pick(),
  colours: pick(['black']),
  patterns: pick([], ['stripes']),
  both: pick(['black'], ['stripes']),
};

function expected(colour: Part, pattern: Part, rows: keyof typeof ROWS): Placement {
  const picked: Part[] = [];
  if (rows === 'colours' || rows === 'both') picked.push(colour);
  if (rows === 'patterns' || rows === 'both') picked.push(pattern);
  if (picked.includes('mismatch')) return 'hidden';
  if (picked.includes('unknown')) return 'not_known';
  return 'match';
}

describe('placeCat: every combination of the two parts and the rows picked (§5)', () => {
  const cases = PARTS.flatMap((colour) =>
    PARTS.flatMap((pattern) =>
      (Object.keys(ROWS) as (keyof typeof ROWS)[]).map((rows) => ({ colour, pattern, rows })),
    ),
  );
  it.each(cases)('colours $colour, pattern $pattern, rows picked: $rows', ({ colour, pattern, rows }) => {
    const cat: CoatFields = { coat: [], coatColours: COLOUR_FOR[colour], coatPattern: PATTERN_FOR[pattern] };
    expect(placeCat(cat, ROWS[rows])).toBe(expected(colour, pattern, rows));
  });

  it('the matrix covers 36 cases, and the rule order is hidden, then not known, then match', () => {
    expect(cases).toHaveLength(36);
    // A known mismatch in one row beats an unknown in the other.
    expect(placeCat({ coatColours: ['grey'], coatPattern: null }, ROWS.both)).toBe('hidden');
    expect(placeCat({ coatColours: [], coatPattern: 'plain' }, ROWS.both)).toBe('hidden');
    // An unknown is never hidden on its own.
    expect(placeCat({ coatColours: [], coatPattern: null }, ROWS.both)).toBe('not_known');
    expect(placeCat({ coatColours: ['black'], coatPattern: null }, ROWS.both)).toBe('not_known');
  });

  it('within a row any chip counts: Brown and Ginger shows cats with either', () => {
    const picked = pick(['brown', 'ginger']);
    expect(placeCat({ coatColours: ['ginger'], coatPattern: null }, picked)).toBe('match');
    expect(placeCat({ coatColours: ['brown', 'white'], coatPattern: null }, picked)).toBe('match');
    expect(placeCat({ coatColours: ['black'], coatPattern: null }, picked)).toBe('hidden');
    const patterns = pick([], ['stripes', 'plain']);
    expect(placeCat({ coatColours: [], coatPattern: 'plain' }, patterns)).toBe('match');
    expect(placeCat({ coatColours: [], coatPattern: 'patches' }, patterns)).toBe('hidden');
  });
});

describe('placeCat: Plain and Patches are forgiving for a cat with White (§2, §5)', () => {
  it('a cat with White recorded as Plain shows under Patches, and one recorded as Patches under Plain', () => {
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'plain' }, pick([], ['patches']))).toBe('match');
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'patches' }, pick([], ['plain']))).toBe('match');
    expect(placeCat({ coatColours: ['white'], coatPattern: 'plain' }, pick([], ['patches']))).toBe('match');
  });

  it('it still shows under its own pattern', () => {
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'plain' }, pick([], ['plain']))).toBe('match');
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'patches' }, pick([], ['patches']))).toBe('match');
  });

  it('without White there is no forgiveness', () => {
    expect(placeCat({ coatColours: ['black'], coatPattern: 'plain' }, pick([], ['patches']))).toBe('hidden');
    expect(placeCat({ coatColours: ['black', 'ginger'], coatPattern: 'patches' }, pick([], ['plain']))).toBe('hidden');
  });

  it('it never stretches to Stripes, either way', () => {
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'plain' }, pick([], ['stripes']))).toBe('hidden');
    expect(placeCat({ coatColours: ['grey', 'white'], coatPattern: 'stripes' }, pick([], ['plain']))).toBe('hidden');
    expect(placeCat({ coatColours: ['grey', 'white'], coatPattern: 'stripes' }, pick([], ['patches']))).toBe('hidden');
  });

  it('colours not known means White is not known, so no forgiveness; a pattern not known is Not known', () => {
    expect(placeCat({ coatColours: [], coatPattern: 'plain' }, pick([], ['patches']))).toBe('hidden');
    expect(placeCat({ coatColours: ['white'], coatPattern: null }, pick([], ['plain']))).toBe('not_known');
  });

  it('the colour row still applies to a forgiven cat', () => {
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'plain' }, pick(['ginger'], ['patches']))).toBe('hidden');
    expect(placeCat({ coatColours: ['black', 'white'], coatPattern: 'plain' }, pick(['black'], ['patches']))).toBe('match');
  });
});

describe('placeCat: a cat without the new fields (an old cached catalogue, §5)', () => {
  // Old shapes as they were cached before A2: `coat` only.
  const OLD: CoatFields[] = [
    { coat: ['black_and_white'] },
    { coat: ['tabby'] },
    { coat: ['ginger', 'tabby'] },
    { coat: ['tortoiseshell_or_calico'] },
    { coat: ['grey'] },
    { coat: [] },
    {},
  ];
  const EVERY_ROW: Picked[] = [
    ...COLOURS.map((c) => pick([c])),
    ...PATTERNS.map((p) => pick([], [p])),
    pick(['black'], ['stripes']),
    pick(['grey', 'white'], ['plain', 'patches']),
  ];

  it.each(OLD)('%j is Not known under any picked row, never hidden', (cat) => {
    for (const picked of EVERY_ROW) expect(placeCat(cat, picked)).toBe('not_known');
  });

  it.each(OLD)('%j is a match with nothing picked', (cat) => {
    expect(placeCat(cat, pick())).toBe('match');
  });
});

describe('placeCats: the counts (§5, "every cat the search finds is counted once")', () => {
  const COATS: CoatFields[] = [
    { coatColours: ['black'], coatPattern: 'plain' },
    { coatColours: ['black', 'white'], coatPattern: 'patches' },
    { coatColours: ['brown', 'ginger'], coatPattern: 'stripes' },
    { coatColours: ['grey'], coatPattern: null },
    { coatColours: [], coatPattern: 'stripes' },
    { coatColours: [], coatPattern: null },
    { coat: ['tabby'] },
    { coatColours: ['ginger', 'white'], coatPattern: 'plain' },
  ];
  const CATS = COATS.map((c, i) => ({ id: i + 1, ...c }));
  const PICKS: Picked[] = [
    pick(),
    pick(['black']),
    pick(['ginger', 'white']),
    pick([], ['plain']),
    pick([], ['stripes']),
    pick(['grey'], ['patches']),
    pick([...COLOURS], [...PATTERNS]),
  ];

  it.each(PICKS.map((p, i) => [i, p] as const))('pick %i: matching + Not known + hidden = the search results', (_i, picked) => {
    const { matching, notKnown, hidden } = placeCats(CATS, picked);
    expect(matching.length + notKnown.length + hidden).toBe(CATS.length);
    const ids = [...matching, ...notKnown].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(hidden).toBe(CATS.filter((c) => placeCat(c, picked) === 'hidden').length);
  });

  it('keeps the order it was given within each group', () => {
    const { matching, notKnown, hidden } = placeCats(CATS, pick(['black']));
    expect(matching.map((c) => c.id)).toEqual([1, 2]);
    expect(notKnown.map((c) => c.id)).toEqual([5, 6, 7]);
    expect(hidden).toBe(3);
  });

  it('nothing picked: every cat matches, none hidden', () => {
    expect(placeCats(CATS, pick())).toEqual({ matching: CATS, notKnown: [], hidden: 0 });
  });
});

describe('filterIsOn: the match record (§5, colour_filter_on)', () => {
  it('is true when either row has a chip picked', () => {
    expect(filterIsOn(pick())).toBe(false);
    expect(filterIsOn(pick(['black']))).toBe(true);
    expect(filterIsOn(pick([], ['plain']))).toBe(true);
    expect(filterIsOn(pick(['black'], ['plain']))).toBe(true);
  });
});
