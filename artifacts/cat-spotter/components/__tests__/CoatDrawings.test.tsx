// @vitest-environment jsdom
/**
 * SYC-398 PR D (coat-colours-and-pattern.md §1–§3, §5; plan Task D.2): the
 * shared drawn swatches, pattern tiles, drawn cat and chip rows.
 */
import React, { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLOURS, PATTERNS, type Colour, type Pattern, type Picked } from '../../lib/coat';
import { TRANSLATIONS, type Language } from '../../lib/i18n';

const lang = vi.hoisted(() => ({ current: 'en' as 'en' | 'el' | 'fr' }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('../../lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => T[lang.current][k] ?? `MISSING:${k}`, language: lang.current }) };
});
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
// react-native-svg has never been rendered under vitest here: stand in plain
// elements that keep each shape's name and paint, so a test can read what
// was drawn.
vi.mock('react-native-svg', () => {
  const make = (name: string) =>
    ({ children, accessibilityLabel, fill, stroke, strokeDasharray, clipPath }: any) =>
      React.createElement(
        'span',
        {
          'data-el': name,
          'data-fill': fill,
          'data-stroke': stroke,
          'data-dash': strokeDasharray,
          'data-clip': clipPath,
          'aria-label': accessibilityLabel,
        },
        children,
      );
  const names = ['Svg', 'G', 'Rect', 'Circle', 'Ellipse', 'Path', 'Polygon', 'Defs', 'ClipPath'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
});

import { CoatChips, ColourSwatch, DrawnCat, NOTHING_PICKED, PatternTile, drawnCatLabel } from '../coat';
import { FILL, UNKNOWN } from '../coat/palette';

afterEach(() => {
  cleanup();
  lang.current = 'en';
});

const LANGS = Object.keys(TRANSLATIONS) as Language[];

/** All 32 sets of the five colours, in display order. */
const COLOUR_SETS: Colour[][] = Array.from({ length: 32 }, (_, mask) => COLOURS.filter((_c, i) => mask & (1 << i)));
const PATTERN_STATES: (Pattern | null)[] = [...PATTERNS, null];

function expectedLabel(colours: Colour[], pattern: Pattern | null, l: Language): string {
  const T = TRANSLATIONS[l];
  return [
    ...(colours.length ? colours.map((c) => T[`coat_${c}`]) : [T.coatNotKnown]),
    pattern ? T[`pattern_${pattern}`] : T.coatNotKnown,
  ].join(' · ');
}

describe('DrawnCat: every coat draws, with the right label (§3)', () => {
  const cases = COLOUR_SETS.flatMap((colours) => PATTERN_STATES.map((pattern) => ({ colours, pattern })));

  it('covers 32 colour sets × 4 pattern states', () => {
    expect(cases).toHaveLength(128);
  });

  it.each(cases)('$colours / $pattern', ({ colours, pattern }) => {
    const { container } = render(<DrawnCat coat={{ colours, pattern }} />);
    const svg = container.querySelector('[data-el="Svg"]')!;
    expect(svg.getAttribute('aria-label')).toBe(expectedLabel(colours, pattern, 'en'));

    // The first colour (White last) fills the cat; nothing known is a neutral, dashed.
    const nonWhite = colours.filter((c) => c !== 'white');
    const base = (nonWhite[0] ?? (colours.includes('white') ? 'white' : null)) as Colour | null;
    const body = svg.querySelector(':scope > [data-el="G"]')!;
    expect(body.getAttribute('data-fill')).toBe(base ? FILL[base] : UNKNOWN);
    const outline = svg.querySelector('[data-stroke="#3b3934"]')!;
    expect(outline.getAttribute('data-dash')).toBe(base ? null : '5 4');

    // Further colours (and White, with Patches) are patches.
    const patchColours = [...nonWhite.slice(1), ...(pattern === 'patches' && colours.includes('white') && base !== 'white' ? ['white'] : [])];
    const spots = Array.from(svg.querySelectorAll('[data-clip] > [data-el="Circle"]'));
    expect(spots.map((s) => s.getAttribute('data-fill'))).toEqual(
      patchColours.length ? Array.from({ length: 6 }, (_, i) => FILL[patchColours[i % patchColours.length] as Colour]) : [],
    );

    // Stripes only for Stripes; White's chest and paws only when White is not the whole cat.
    expect(svg.querySelectorAll('[data-stroke="#000000"], [data-stroke="#ffffff"]').length).toBe(pattern === 'stripes' ? 1 : 0);
    expect(svg.querySelectorAll(`[data-clip] > [data-el="G"][data-fill="${FILL.white}"]`).length).toBe(colours.includes('white') && base !== 'white' ? 1 : 0);
  });

  it.each(LANGS)('in %s the label is words only, never a raw code or a missing key', (l) => {
    const t = (k: string) => TRANSLATIONS[l][k] ?? `MISSING:${k}`;
    for (const { colours, pattern } of cases) {
      const label = drawnCatLabel({ colours, pattern }, t);
      expect(label).toBe(expectedLabel(colours, pattern, l));
      expect(label).not.toMatch(/MISSING|coat_|pattern_|\b(black|grey|brown|ginger|white|plain|stripes|patches)\b/);
    }
  });

  it('drops anything outside the vocabulary rather than drawing or saying it', () => {
    expect(drawnCatLabel({ colours: ['lilac', 'grey', 'tabby'], pattern: 'spots' }, (k) => TRANSLATIONS.en[k]!)).toBe('Grey · Not known');
  });
});

describe('ColourSwatch and PatternTile', () => {
  it('a swatch for each colour, and the five slices for All', () => {
    for (const c of COLOURS) {
      const { container } = render(<ColourSwatch colour={c} />);
      expect(container.querySelector('[data-el="Circle"]')!.getAttribute('data-fill')).toBe(FILL[c]);
      cleanup();
    }
    const { container } = render(<ColourSwatch colour="all" />);
    expect(Array.from(container.querySelectorAll('[data-el="Path"]')).map((p) => p.getAttribute('data-fill'))).toEqual(COLOURS.map((c) => FILL[c]));
  });

  it('a tile for Plain, Stripes, Patches, Can’t tell and All, each drawn differently', () => {
    const drawn = (['plain', 'stripes', 'patches', 'cant_tell', 'all'] as const).map((p) => {
      const { container } = render(<PatternTile pattern={p} />);
      const html = container.innerHTML;
      cleanup();
      return html;
    });
    expect(new Set(drawn).size).toBe(5);
  });
});

function Harness({ onChange }: { onChange?: (p: Picked) => void }) {
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  return (
    <CoatChips
      picked={picked}
      onChange={(p) => {
        setPicked(p);
        onChange?.(p);
      }}
    />
  );
}

const selected = (el: Element | null) => el?.getAttribute('aria-selected') === 'true';

describe('CoatChips: two rows of toggles (§5)', () => {
  it('the colour row is All · Black · Grey · Brown · Ginger · White and the pattern row All · Plain · Stripes · Patches, each a drawing plus its word', () => {
    const { container } = render(<Harness />);
    const ids = Array.from(container.querySelectorAll('[data-testid^="coat-chip-"]')).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'coat-chip-colour-all', 'coat-chip-colour-black', 'coat-chip-colour-grey', 'coat-chip-colour-brown', 'coat-chip-colour-ginger', 'coat-chip-colour-white',
      'coat-chip-pattern-all', 'coat-chip-pattern-plain', 'coat-chip-pattern-stripes', 'coat-chip-pattern-patches',
    ]);
    for (const el of Array.from(container.querySelectorAll('[data-testid^="coat-chip-"]'))) {
      expect(el.querySelector('[data-el="Svg"]')).not.toBeNull();
      expect(el.textContent).toBe(el.getAttribute('aria-label'));
    }
    expect(container.querySelector('[data-testid="coat-chip-colour-ginger"]')!.textContent).toBe('Ginger');
    expect(container.querySelector('[data-testid="coat-chip-pattern-all"]')!.textContent).toBe('All');
  });

  it('both rows start at All', () => {
    const { getByTestId } = render(<Harness />);
    expect(selected(getByTestId('coat-chip-colour-all'))).toBe(true);
    expect(selected(getByTestId('coat-chip-pattern-all'))).toBe(true);
    for (const c of COLOURS) expect(selected(getByTestId(`coat-chip-colour-${c}`))).toBe(false);
  });

  it('a chip is a toggle; any number in a row; All clears the row', () => {
    const onChange = vi.fn();
    const { getByTestId } = render(<Harness onChange={onChange} />);
    fireEvent.click(getByTestId('coat-chip-colour-brown'));
    expect(selected(getByTestId('coat-chip-colour-brown'))).toBe(true);
    expect(selected(getByTestId('coat-chip-colour-all'))).toBe(false);
    fireEvent.click(getByTestId('coat-chip-colour-ginger'));
    expect([...onChange.mock.lastCall![0].colours]).toEqual(['brown', 'ginger']);
    fireEvent.click(getByTestId('coat-chip-colour-brown'));
    expect(selected(getByTestId('coat-chip-colour-brown'))).toBe(false);
    expect([...onChange.mock.lastCall![0].colours]).toEqual(['ginger']);
    fireEvent.click(getByTestId('coat-chip-pattern-stripes'));
    expect([...onChange.mock.lastCall![0].patterns]).toEqual(['stripes']);
    fireEvent.click(getByTestId('coat-chip-colour-all'));
    expect(selected(getByTestId('coat-chip-colour-all'))).toBe(true);
    expect(selected(getByTestId('coat-chip-colour-ginger'))).toBe(false);
    // The other row is untouched.
    expect(selected(getByTestId('coat-chip-pattern-stripes'))).toBe(true);
    fireEvent.click(getByTestId('coat-chip-pattern-stripes'));
    expect(selected(getByTestId('coat-chip-pattern-all'))).toBe(true);
  });

  it.each(LANGS)('every chip word exists in %s', (l) => {
    lang.current = l;
    const { container } = render(<Harness />);
    expect(container.textContent).not.toMatch(/MISSING|coat_|pattern_/);
  });
});

describe('every D word exists in all three languages', () => {
  const KEYS = [
    'coatAll', 'coatNotKnown', 'pattern_cant_tell',
    ...COLOURS.map((c) => `coat_${c}`), ...PATTERNS.map((p) => `pattern_${p}`),
    'pickerHiddenOne', 'pickerHiddenMany', 'pickerShowAll', 'pickerNoResultsFiltered', 'pickerSearchAll',
  ];
  it.each(LANGS)('%s', (l) => {
    for (const k of KEYS) expect(TRANSLATIONS[l][k], `${l}.${k}`).toBeTruthy();
    expect(TRANSLATIONS[l].pickerHiddenMany).toContain('{n}');
    expect(TRANSLATIONS[l].pickerNoResultsFiltered).toContain('{text}');
  });

  it('English is the SYC-346 copy', () => {
    const en = TRANSLATIONS.en;
    expect(en.coatAll).toBe('All');
    expect(en.coatNotKnown).toBe('Not known');
    expect(en.pattern_cant_tell).toBe('Can’t tell');
    expect(`${en.pickerHiddenMany.replace('{n}', '8')} ${en.pickerShowAll}.`).toBe('8 more cats nearby in other colours or patterns. Show all.');
    expect(en.pickerHiddenOne).toBe('1 more cat nearby in other colours or patterns.');
    expect(en.pickerNoResultsFiltered.replace('{text}', 'Kri')).toBe('No cats like that called “Kri”.');
    expect(en.pickerSearchAll).toBe('Search all');
  });
});
