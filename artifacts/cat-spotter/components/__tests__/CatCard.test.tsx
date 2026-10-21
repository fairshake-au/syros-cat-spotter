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
    expect(card.getAttribute('aria-label')!.startsWith('Agatha. Spotted by you.')).toBe(true);
    spotted.unmount();

    const notSpotted = render(<CatCard cat={CAT} spotted={false} />);
    card = notSpotted.container.firstElementChild!;
    expect(card.getAttribute('aria-label')!.startsWith('Agatha. Not spotted yet.')).toBe(true);
    notSpotted.unmount();

    const unknown = render(<CatCard cat={CAT} />);
    card = unknown.container.firstElementChild!;
    const label = card.getAttribute('aria-label')!;
    expect(label.startsWith('Agatha. ')).toBe(true);
    expect(label).not.toContain('Spotted by you');
    expect(label).not.toContain('Not spotted yet');
    // the visible facts ride along
    expect(label).toContain('100 m');
    expect(label).toContain('discoveredBy');
  });

  it('still goes to the cat page when tapped', () => {
    const { container } = render(<CatCard cat={CAT} spotted />);
    fireEvent.click(container.firstElementChild!);
    expect(push).toHaveBeenCalledWith({ pathname: '/cat/[id]', params: { id: '42' } });
  });
});
