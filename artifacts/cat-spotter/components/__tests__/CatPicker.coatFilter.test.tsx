// @vitest-environment jsdom
/**
 * SYC-398 PR D (coat-colours-and-pattern.md §5; plan Task D.3): "Find the
 * cat" filters by colour and pattern. The English copy renders, so the lines
 * read as a spotter sees them.
 */
import React from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('react-native-svg', () => {
  const make = (name: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-el': name }, children);
  const names = ['Svg', 'G', 'Rect', 'Circle', 'Ellipse', 'Path', 'Polygon', 'Defs', 'ClipPath'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('../../lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => TRANSLATIONS.en[key] ?? key, language: 'en' }) };
});
const { useGetCat } = vi.hoisted(() => ({
  useGetCat: vi.fn(() => ({ data: undefined })),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetCat,
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
}));

import { CatPicker } from '../CatPicker';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const FROM = squareCentre({ lat: 37.4448, lng: 24.9425 });
const north = (km: number) => ({ lat: FROM.lat + km / 111.2, lng: FROM.lng });

function cat(id: number, name: string, km: number, coat: Partial<Pick<Cat, 'coat' | 'coatColours' | 'coatPattern'>>): Cat {
  return {
    id,
    name,
    description: '',
    photoUrl: `/api/photos/${id}`,
    sightingsCount: 1,
    lastSeenAt: '2026-09-01',
    locationPrecision: 'approximate',
    locationCellM: 250,
    hasHome: false,
    distanceKm: 0.1,
    lifeStatus: 'street',
    notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
    ...north(km),
    ...coat,
  } as Cat;
}

// Nearest first: ids ascend with distance, so the list order is the id order.
const CATS = [
  cat(1, 'Inky', 0.01, { coatColours: ['black'], coatPattern: 'plain' }),
  cat(2, 'Milo', 0.02, { coatColours: ['black', 'white'], coatPattern: 'patches' }),
  cat(3, 'Krispy', 0.03, { coatColours: ['brown', 'ginger'], coatPattern: 'stripes' }),
  cat(4, 'Smoke', 0.04, { coatColours: ['grey'], coatPattern: null }),
  cat(5, 'Mystery', 0.05, { coatColours: [], coatPattern: null }),
  // Saved before the update: the old field only (spec §5: never hidden).
  cat(6, 'Oldie', 0.06, { coat: ['black_and_white'] }),
  cat(7, 'Toula', 0.07, { coatColours: ['ginger', 'white'], coatPattern: 'plain' }),
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof CatPicker>> = {}) {
  const props = {
    from: FROM,
    cats: CATS,
    isOffline: false,
    busy: false,
    message: null,
    yourPhoto: null,
    onPick: vi.fn(),
    onAddNew: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CatPicker {...props} />) };
}

const ids = (root: Element | null) =>
  root ? Array.from(root.querySelectorAll('[data-testid^="picker-cat-"]')).map((el) => Number(el.getAttribute('data-testid')!.slice('picker-cat-'.length))) : [];
const all = (c: HTMLElement) => ids(c);
const selected = (el: Element) => el.getAttribute('aria-pressed') === 'true';

/** Every element in document order, to check what comes before what. */
function order(container: HTMLElement, ...els: Element[]): number[] {
  const every = Array.from(container.querySelectorAll('*'));
  return els.map((el) => every.indexOf(el));
}

describe('the chips sit under the search box, and start at All', () => {
  it('search box, then the colour row, then the pattern row, then the list', () => {
    const { container, getByPlaceholderText, getByTestId, getByText } = renderPicker();
    const [search, colourAll, patternAll, heading] = order(
      container,
      getByPlaceholderText('Name or SYR number'),
      getByTestId('coat-chip-colour-all'),
      getByTestId('coat-chip-pattern-all'),
      getByText('Cats known around here'),
    );
    expect(search).toBeLessThan(colourAll);
    expect(colourAll).toBeLessThan(patternAll);
    expect(patternAll).toBeLessThan(heading);
  });

  it('with nothing picked every cat is listed, none under Not known, and nothing is hidden', () => {
    const { container, queryByTestId, queryByText } = renderPicker();
    expect(all(container)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(queryByTestId('picker-not-known')).toBeNull();
    expect(queryByText('Not known')).toBeNull();
    expect(queryByTestId('picker-hidden-line')).toBeNull();
  });

  it('resets to All each time the picker opens (a fresh mount)', () => {
    const first = renderPicker();
    fireEvent.click(first.getByTestId('coat-chip-colour-ginger'));
    fireEvent.click(first.getByTestId('coat-chip-pattern-stripes'));
    expect(selected(first.getByTestId('coat-chip-colour-ginger'))).toBe(true);
    first.unmount();
    const again = renderPicker();
    expect(selected(again.getByTestId('coat-chip-colour-all'))).toBe(true);
    expect(selected(again.getByTestId('coat-chip-pattern-all'))).toBe(true);
    expect(all(again.container)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('the matches, then Not known (spec §5)', () => {
  it('Black: the black cats match; cats whose colours aren\'t known, and the old cached cat, are Not known; the rest are hidden', () => {
    const { container, getByTestId, getByText } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-black'));
    expect(ids(getByTestId('picker-matching'))).toEqual([1, 2]);
    expect(ids(getByTestId('picker-not-known'))).toEqual([5, 6]);
    // The heading sits between the two groups.
    const [lastMatch, heading, firstNotKnown] = order(container, getByTestId('picker-cat-2'), getByText('Not known'), getByTestId('picker-cat-5'));
    expect(lastMatch).toBeLessThan(heading);
    expect(heading).toBeLessThan(firstNotKnown);
    expect(getByTestId('picker-hidden-line').textContent).toContain('3 more cats nearby in other colours or patterns.');
  });

  it('within a row any chip counts; both rows apply together', () => {
    const { getByTestId } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-brown'));
    fireEvent.click(getByTestId('coat-chip-colour-ginger'));
    expect(ids(getByTestId('picker-matching'))).toEqual([3, 7]);
    fireEvent.click(getByTestId('coat-chip-pattern-stripes'));
    expect(ids(getByTestId('picker-matching'))).toEqual([3]);
    expect(ids(getByTestId('picker-not-known'))).toEqual([5, 6]);
  });

  it('Plain and Patches are forgiving for a cat with White', () => {
    const { getByTestId } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-pattern-patches'));
    // Milo is Patches; Toula (Ginger · White · Plain) is forgiven.
    expect(ids(getByTestId('picker-matching'))).toEqual([2, 7]);
  });

  it('every cat the search finds is counted once: matches + Not known + hidden', () => {
    for (const chip of ['coat-chip-colour-grey', 'coat-chip-pattern-plain', 'coat-chip-colour-white']) {
      const { getByTestId, queryByTestId, unmount } = renderPicker();
      fireEvent.click(getByTestId(chip));
      const shown = ids(queryByTestId('picker-matching')).length + ids(queryByTestId('picker-not-known')).length;
      const line = queryByTestId('picker-hidden-line')?.textContent ?? '';
      const hidden = /^1 more cat/.test(line) ? 1 : Number(/^(\d+) more cats/.exec(line)?.[1] ?? 0);
      expect(shown + hidden).toBe(CATS.length);
      unmount();
    }
  });
});

describe('the hidden-count line (spec §5)', () => {
  it('sits directly above "Can\'t find it? Add it as a new cat"', () => {
    const { container, getByTestId, getByText } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-grey'));
    const line = getByTestId('picker-hidden-line');
    const footer = getByText('Can\'t find it?').parentElement!;
    expect(within(footer).getByText('Add it as a new cat')).toBeTruthy();
    // Nothing between them, and the line comes first.
    expect(line.nextElementSibling).toBe(footer);
    const [lineAt, footerAt] = order(container, line, footer);
    expect(lineAt).toBeLessThan(footerAt);
  });

  it('says one cat in the singular', () => {
    const { getByTestId } = renderPicker({ cats: [CATS[0]!, CATS[2]!] });
    fireEvent.click(getByTestId('coat-chip-pattern-plain'));
    expect(getByTestId('picker-hidden-line').textContent).toBe('1 more cat nearby in other colours or patterns.Show all');
    // A screen reader hears the count change.
    expect(getByTestId('picker-hidden-line').getAttribute('aria-live')).toBe('polite');
  });

  it('"Show all" resets both rows and shows every cat again', () => {
    const { container, getByTestId, getByText, queryByTestId } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-black'));
    fireEvent.click(getByTestId('coat-chip-pattern-plain'));
    expect(getByTestId('picker-hidden-line').textContent).toContain('3 more cats nearby');
    fireEvent.click(getByText('Show all'));
    expect(selected(getByTestId('coat-chip-colour-all'))).toBe(true);
    expect(selected(getByTestId('coat-chip-pattern-all'))).toBe(true);
    expect(selected(getByTestId('coat-chip-colour-black'))).toBe(false);
    expect(selected(getByTestId('coat-chip-pattern-plain'))).toBe(false);
    expect(all(container)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(queryByTestId('picker-hidden-line')).toBeNull();
  });
});

describe('the search-empty line (spec §5)', () => {
  it('a name the chips hide says so, and "Search all" resets the rows', () => {
    const { container, getByPlaceholderText, getByTestId, getByText } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-grey'));
    fireEvent.change(getByPlaceholderText('Name or SYR number'), { target: { value: 'Krispy' } });
    expect(getByTestId('picker-search-empty').textContent).toContain('No cats like that called “Krispy”.');
    expect(all(container)).toEqual([]);
    fireEvent.click(getByText('Search all'));
    expect(all(container)).toEqual([3]);
    expect(selected(getByTestId('coat-chip-colour-all'))).toBe(true);
  });

  it('a name nobody has keeps the plain no-results line', () => {
    const { getByPlaceholderText, getByTestId, queryByTestId, getByText } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-grey'));
    fireEvent.change(getByPlaceholderText('Name or SYR number'), { target: { value: 'nobody' } });
    expect(queryByTestId('picker-search-empty')).toBeNull();
    expect(getByText('No cats around here match "nobody".')).toBeTruthy();
  });

  it('a name whose cat is Not known still shows it', () => {
    const { container, getByPlaceholderText, getByTestId } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-grey'));
    fireEvent.change(getByPlaceholderText('Name or SYR number'), { target: { value: 'oldie' } });
    expect(ids(getByTestId('picker-not-known'))).toEqual([6]);
    expect(all(container)).toEqual([6]);
  });
});

describe('the match record: colourFilterOn (spec §5)', () => {
  it('a pick with a chip picked in either row sends true', () => {
    for (const chip of ['coat-chip-colour-black', 'coat-chip-pattern-plain']) {
      const { getByTestId, getByText, props, unmount } = renderPicker();
      fireEvent.click(getByTestId(chip));
      fireEvent.click(getByTestId('picker-cat-1'));
      fireEvent.click(getByText('Yes, this is the cat'));
      expect(props.onPick).toHaveBeenCalledWith(1, 'nearby', true);
      unmount();
    }
  });

  it('a pick with both rows at All sends false, even after a chip was picked and cleared', () => {
    const { getByTestId, getByText, props } = renderPicker();
    fireEvent.click(getByTestId('coat-chip-colour-black'));
    fireEvent.click(getByTestId('coat-chip-colour-all'));
    fireEvent.click(getByTestId('picker-cat-3'));
    fireEvent.click(getByText('Yes, this is the cat'));
    expect(props.onPick).toHaveBeenCalledWith(3, 'nearby', false);
  });

  it('"Add it as a new cat" says whether a chip was picked', () => {
    const on = renderPicker();
    fireEvent.click(on.getByTestId('coat-chip-pattern-stripes'));
    fireEvent.click(on.getByText('Add it as a new cat'));
    expect(on.props.onAddNew).toHaveBeenCalledWith(true);
    on.unmount();
    const off = renderPicker();
    fireEvent.click(off.getByText('Add it as a new cat'));
    expect(off.props.onAddNew).toHaveBeenCalledWith(false);
  });
});

describe('offline, over the saved cat-alogue (spec §5)', () => {
  beforeEach(() => {
    // The network is off: any request is a failure of this test.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Network request failed'))));
  });

  it('the chips filter the saved copy, an old saved cat is Not known, and nothing is fetched', () => {
    const { getByTestId, getByText, props } = renderPicker({ isOffline: true });
    expect(getByText('Showing the cats saved on your phone. New ones may be missing.')).toBeTruthy();
    fireEvent.click(getByTestId('coat-chip-colour-white'));
    expect(ids(getByTestId('picker-matching'))).toEqual([2, 7]);
    expect(ids(getByTestId('picker-not-known'))).toEqual([5, 6]);
    fireEvent.click(getByTestId('picker-cat-7'));
    fireEvent.click(getByText('Yes, this is the cat'));
    expect(props.onPick).toHaveBeenCalledWith(7, 'nearby', true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    for (const call of useGetCat.mock.calls as unknown as unknown[][]) {
      expect((call[1] as { query?: { enabled?: boolean } }).query?.enabled).toBe(false);
    }
  });
});
