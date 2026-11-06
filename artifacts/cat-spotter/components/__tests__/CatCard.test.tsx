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
const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'el' | 'fr' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn() }));
vi.mock('@expo/vector-icons', () => ({
  Feather: ({ name, 'aria-hidden': ariaHidden }: { name: string; 'aria-hidden'?: boolean }) => (
    <i data-feather={name} aria-hidden={ariaHidden ? 'true' : undefined} />
  ),
}));
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
    catAreaSomewhere: 'Somewhere on Syros',
  };
  return {
    useLanguage: () => ({ t: (key: string) => strings[key] ?? key, language: h.language }),
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

describe('SYC-677 D: a cat nobody has named yet', () => {
  const PENDING = { ...CAT, name: 'SYR-0042', namePending: true };

  it('shows "No name yet" with its SYR number under it', () => {
    const { container, getByTestId } = render(<CatCard cat={PENDING} />);
    expect(container.textContent).toContain('noNameYet');
    expect(getByTestId('cat-card-number').textContent).toBe('SYR-0042');
  });

  it('reads the number in the label too, so two such cards differ', () => {
    const { container } = render(<CatCard cat={PENDING} spotted />);
    expect(container.firstElementChild!.getAttribute('aria-label')).toContain(
      'noNameYet \u00b7 SYR-0042. Spotted by you.',
    );
  });

  it('a named cat has no number line', () => {
    const { queryByTestId } = render(<CatCard cat={CAT} />);
    expect(queryByTestId('cat-card-number')).toBeNull();
  });
});

describe('SYC-810: the place row on the cat card', () => {
  const KINI = { ...CAT, areaKey: 'kini', areaName: 'Kini' };
  const placeRow = (container: HTMLElement) => container.querySelector('[data-feather="map-pin"]');

  afterEach(() => {
    h.language = 'en';
  });

  it('a cat with an area shows the area in place of "Discovered by"', () => {
    const { container } = render(<CatCard cat={{ ...KINI, distanceKm: null }} />);
    expect(container.textContent).toContain('Kini');
    expect(container.textContent).not.toContain('discoveredBy');
  });

  it('a cat on the island with no area shows "Somewhere on Syros"', () => {
    const { container } = render(<CatCard cat={{ ...CAT, areaKey: null, areaName: null }} />);
    expect(container.textContent).toContain('Somewhere on Syros');
    expect(container.textContent).not.toContain('discoveredBy');
  });

  it('a cat off the island keeps "Discovered by"', () => {
    const off = { ...CAT, areaKey: null, areaName: null, lat: 34.6123, lng: 21.1189 };
    const { container } = render(<CatCard cat={off} />);
    expect(container.textContent).toContain('discoveredBy aSpotter');
    expect(container.textContent).not.toContain('Somewhere on Syros');
  });

  it('a cat from an old cache with no area field keeps "Discovered by"', () => {
    const { container } = render(<CatCard cat={CAT} />);
    expect(container.textContent).toContain('discoveredBy aSpotter');
    expect(container.textContent).not.toContain('Somewhere on Syros');
  });

  it('a homed cat shows both the badge and the area', () => {
    const { container } = render(<CatCard cat={{ ...KINI, hasHome: true }} />);
    expect(container.textContent).toContain('Has a home');
    expect(container.textContent).toContain('Kini');
  });

  it('shows the Greek name in Greek', () => {
    h.language = 'el';
    const { container } = render(<CatCard cat={KINI} />);
    expect(container.textContent).toContain('Κίνι');
  });

  it('the spoken label has the area and not "Discovered by"', () => {
    const { container } = render(<CatCard cat={KINI} spotted />);
    const label = container.firstElementChild!.getAttribute('aria-label')!;
    expect(label).toBe('Agatha. Spotted by you. Seen once. 100 m. Kini');
    expect(label).not.toContain('discoveredBy');
  });

  it('a homed cat is spoken as "Has a home" and the plain area, never "lives in"', () => {
    const { container } = render(<CatCard cat={{ ...KINI, hasHome: true }} />);
    expect(container.firstElementChild!.getAttribute('aria-label')).toBe(
      'Agatha. Has a home. Seen once. 100 m. Kini',
    );
  });

  it('the spoken label keeps a long Greek-length name whole', () => {
    const long = { ...CAT, areaKey: 'new-place', areaName: 'Μέγας Γιαλός της Σύρου, κοντά στο λιμάνι' };
    const { container } = render(<CatCard cat={long} />);
    expect(container.firstElementChild!.getAttribute('aria-label')).toContain(
      'Μέγας Γιαλός της Σύρου, κοντά στο λιμάνι',
    );
  });

  it('the row stays on one line, with a pin hidden from screen readers', () => {
    const long = { ...CAT, areaKey: 'new-place', areaName: 'Μέγας Γιαλός της Σύρου, κοντά στο λιμάνι' };
    const { getByText, container } = render(<CatCard cat={long} />);
    const row = getByText('Μέγας Γιαλός της Σύρου, κοντά στο λιμάνι');
    expect(window.getComputedStyle(row).textOverflow).toBe('ellipsis');
    const pins = Array.from(container.querySelectorAll('[data-feather="map-pin"]'));
    const rowPin = pins.find((p) => p.parentElement === row.parentElement)!;
    expect(rowPin.getAttribute('aria-hidden')).toBe('true');
    expect(placeRow(container)).toBeTruthy();
  });
});
