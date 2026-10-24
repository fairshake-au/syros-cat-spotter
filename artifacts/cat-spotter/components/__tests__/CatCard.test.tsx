// @vitest-environment jsdom
/**
 * SYC-505: the passport "Spotted" stamp on cat cards, and the card's
 * screen-reader label. Unknown is not zero: with no profile loaded
 * (`spotted` undefined) the label says nothing about spotted either way.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cat } from '@workspace/api-client-react';

const push = vi.hoisted(() => vi.fn());
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({
  Image: ({ testID }: { testID?: string }) => <img data-testid={testID ?? 'image'} />,
}));
vi.mock('react-native-svg', () => {
  const make = (name: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-el': name }, children);
  const names = ['Svg', 'G', 'Rect', 'Circle', 'Ellipse', 'Path', 'Polygon', 'Defs', 'ClipPath'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
});
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@/context/LanguageContext', () => {
  const strings: Record<string, string> = {
    catCardA11ySpotted: '{name}. Spotted by you.',
    catCardA11yNotSpotted: '{name}. Not spotted yet.',
    catCardSeenOnce: 'Seen once',
    catCardSeenTimes: 'Seen {n} times',
    filterHasHome: 'Has a home',
  };
  return {
    useLanguage: () => ({ t: (key: string) => strings[key] ?? key, language: 'en' }),
  };
});

import { CatCard } from '../CatCard';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CAT: Cat = {
  id: 42,
  name: 'Agatha',
  description: '',
  photoUrl: '/api/photos/42',
  sightingsCount: 1,
  lastSeenAt: '2026-09-01',
  locationPrecision: 'approximate',
  locationCellM: 250,
  hasHome: false,
  distanceKm: 0.1,
  lifeStatus: 'street',
  notSeenSince: null,
  sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
  lat: 37.4448,
  lng: 24.9425,
};

describe('SYC-505: spotted stamp on the cat card', () => {
  it('shows the stamp, hidden from screen readers, when spotted', () => {
    const { getByTestId } = render(<CatCard cat={CAT} spotted />);
    const stamp = getByTestId('spotted-stamp');
    expect(stamp.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(stamp.textContent).toContain('catSpottedStamp');
  });

  it('shows no stamp when not spotted, or when unknown', () => {
    const a = render(<CatCard cat={CAT} spotted={false} />);
    expect(a.queryByTestId('spotted-stamp')).toBeNull();
    a.unmount();
    const b = render(<CatCard cat={CAT} />);
    expect(b.queryByTestId('spotted-stamp')).toBeNull();
  });

  it('labels the card as a button, saying spotted only when known', () => {
    const spotted = render(<CatCard cat={CAT} spotted />);
    let card = spotted.container.firstElementChild!;
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('aria-label')).toBe(
      'Agatha. Spotted by you. Seen once. 100 m. discoveredBy aSpotter',
    );
    spotted.unmount();

    const notSpotted = render(<CatCard cat={CAT} spotted={false} />);
    card = notSpotted.container.firstElementChild!;
    expect(card.getAttribute('aria-label')).toBe(
      'Agatha. Not spotted yet. Seen once. 100 m. discoveredBy aSpotter',
    );
    notSpotted.unmount();

    const unknown = render(<CatCard cat={CAT} />);
    card = unknown.container.firstElementChild!;
    expect(card.getAttribute('aria-label')).toBe('Agatha. Seen once. 100 m. discoveredBy aSpotter');
  });

  it('never doubles a full stop, with or without a distance', () => {
    const { container } = render(
      <CatCard cat={{ ...CAT, distanceKm: null, discovererUsername: 'BrightTabby' }} spotted={false} />,
    );
    expect(container.firstElementChild!.getAttribute('aria-label')).toBe(
      'Agatha. Not spotted yet. Seen once. discoveredBy BrightTabby',
    );
  });

  it('still goes to the cat page when tapped', () => {
    const { container } = render(<CatCard cat={CAT} spotted />);
    fireEvent.click(container.firstElementChild!);
    expect(push).toHaveBeenCalledWith({ pathname: '/cat/[id]', params: { id: '42' } });
  });
});

describe('SYC-578: cat card says what its numbers and badges mean', () => {
  it('says "Seen N times" in words, not a bare number', () => {
    const one = render(<CatCard cat={CAT} />);
    expect(one.container.textContent).toContain('Seen once');
    one.unmount();
    const many = render(<CatCard cat={{ ...CAT, sightingsCount: 2 }} />);
    expect(many.container.textContent).toContain('Seen 2 times');
  });

  it('writes "Has a home" on the badge and in the label', () => {
    const { container } = render(<CatCard cat={{ ...CAT, hasHome: true }} />);
    expect(container.textContent).toContain('Has a home');
    expect(container.firstElementChild!.getAttribute('aria-label')).toBe(
      'Agatha. Has a home. Seen once. 100 m. discoveredBy aSpotter',
    );
  });

  it('lets a long discoverer name wrap instead of cutting it off', () => {
    const long = 'lilacsapphirewhiskers';
    const { getByText } = render(<CatCard cat={{ ...CAT, discovererUsername: long }} />);
    // react-native-web turns numberOfLines into an ellipsis/line clamp.
    const el = getByText(`discoveredBy ${long}`);
    const css = window.getComputedStyle(el);
    expect(css.textOverflow).not.toBe('ellipsis');
    expect(css.getPropertyValue('-webkit-line-clamp')).toBe('');
    // The name itself still truncates, so the clamp is detectable here.
    expect(window.getComputedStyle(getByText('Agatha')).textOverflow).toBe('ellipsis');
  });
});
