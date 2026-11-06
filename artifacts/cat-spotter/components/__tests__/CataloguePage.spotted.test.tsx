// @vitest-environment jsdom
/**
 * SYC-505 Task 5: the Cat-alogue stops padlocking cats. Spotted cards get a
 * stamp, a "Not spotted yet" filter appears once the profile is known, and a
 * kind message shows when every cat is spotted. Unknown is not zero.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  isOnline: true,
  coords: undefined as { latitude: number; longitude: number } | undefined,
  cats: [] as Array<Record<string, unknown>>,
  profile: undefined as unknown,
  loadFailed: false,
  language: 'en' as 'en' | 'el' | 'fr',
  retry: vi.fn(async () => {}),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () =>
    new Proxy({}, { get: (_t, k) => (k === 'primaryFill' ? 'rgb(1, 2, 3)' : '#123456') }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: h.language }),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'dev-1', username: 'sam' }),
}));
vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => ({ isOnline: h.isOnline }),
}));
vi.mock('@/context/LocationContext', () => ({ useAppLocation: () => ({ coords: h.coords }) }));
vi.mock('@/hooks/useCatsWithCache', () => ({
  useCatsWithCache: () => ({ cats: h.cats, isLoading: false, loadFailed: h.loadFailed, retry: h.retry }),
}));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/AppMap', () => ({
  AppMap: (p: { areas?: unknown[]; markers?: unknown[] }) => (
    <div
      data-testid="map"
      data-count={String((p.markers ?? []).length || (p.areas ?? []).length)}
    />
  ),
}));
vi.mock('@/components/CatCard', () => ({
  CatCard: (p: { cat: { id: number }; spotted?: boolean }) => (
    <div data-testid={`card-${p.cat.id}`} data-spotted={String(p.spotted)} />
  ),
}));
vi.mock('@/components/purropolis', async () => {
  const { Chip } = await import('@/components/purropolis/Chip');
  return { Chip };
});
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({ data: h.profile }),
  getGetProfileQueryKey: (id: string) => [`/api/profile/${id}`],
}));

import CatalogScreen from '../../app/(tabs)/cats';

const mkCats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Cat${i + 1}`,
    description: '',
    lat: 37,
    lng: 24,
    hasHome: false,
    photoUrl: null,
  }));

beforeEach(() => {
  h.push.mockReset();
  h.isOnline = true;
  h.coords = undefined;
  h.cats = mkCats(4);
  h.profile = undefined;
  h.loadFailed = false;
  h.retry.mockClear();
  h.language = 'en';
});
afterEach(cleanup);

const cardIds = () =>
  screen
    .queryAllByTestId(/^card-/)
    .map((el) => el.getAttribute('data-testid')!.replace('card-', ''));

const selected = (label: string) =>
  // An active Chip's pill (inside its tap area, SYC-644) is painted with the primary fill (SYC-766).
  (screen.getByText(label).closest('[role="button"]')!.firstElementChild as HTMLElement).style
    .backgroundColor === 'rgb(1, 2, 3)';

const noLocks = () => {
  expect(screen.queryByText('homeSpotToUnlock')).toBeNull();
  expect(document.body.textContent).not.toContain('🔒');
};

describe('Cat-alogue stamps and Not spotted yet filter (SYC-505)', () => {
  it('known profile: four chips in order, stamps, and the filter shows unspotted cats', () => {
    h.profile = { spottedCatIds: [1, 2] };
    render(<CatalogScreen />);
    const labels = ['filterAll', 'filterNearMe', 'filterHasHome', 'filterNotSpotted'];
    const found = labels.map((l) => screen.getByText(l));
    for (let i = 0; i < found.length - 1; i++) {
      expect(
        found[i]!.compareDocumentPosition(found[i + 1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.getByTestId('card-1').getAttribute('data-spotted')).toBe('true');
    expect(screen.getByTestId('card-2').getAttribute('data-spotted')).toBe('true');
    expect(screen.getByTestId('card-3').getAttribute('data-spotted')).toBe('false');
    fireEvent.click(screen.getByText('filterNotSpotted'));
    expect(cardIds()).toEqual(['3', '4']);
    noLocks();
  });

  it('empty spotted list: chip shown, filter shows all four', () => {
    h.profile = { spottedCatIds: [] };
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNotSpotted'));
    expect(cardIds()).toEqual(['1', '2', '3', '4']);
  });

  it('unknown profile: no chip, no stamps', () => {
    render(<CatalogScreen />);
    expect(screen.queryByText('filterNotSpotted')).toBeNull();
    for (const id of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`card-${id}`).getAttribute('data-spotted')).toBe('undefined');
    }
    noLocks();
  });

  it('profile without spottedCatIds: no chip, no stamps', () => {
    h.profile = { catsSpotted: 0 };
    render(<CatalogScreen />);
    expect(screen.queryByText('filterNotSpotted')).toBeNull();
    expect(screen.getByTestId('card-1').getAttribute('data-spotted')).toBe('undefined');
  });

  it('profile goes away while filtered: falls back to All, and comes back (derived, not reset)', () => {
    h.profile = { spottedCatIds: [1, 2] };
    const { rerender } = render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNotSpotted'));
    expect(cardIds()).toEqual(['3', '4']);
    h.profile = undefined;
    rerender(<CatalogScreen />);
    expect(cardIds()).toEqual(['1', '2', '3', '4']);
    expect(selected('filterAll')).toBe(true);
    h.profile = { spottedCatIds: [1, 2] };
    rerender(<CatalogScreen />);
    expect(cardIds()).toEqual(['3', '4']);
    expect(selected('filterNotSpotted')).toBe(true);
  });

  it('all spotted (extra unknown id 99): kind message in the list', () => {
    h.profile = { spottedCatIds: [1, 2, 3, 4, 99] };
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNotSpotted'));
    expect(cardIds()).toEqual([]);
    expect(screen.getByText('filterNotSpottedAllDone')).toBeTruthy();
  });

  it('all spotted but a search matches nothing: search message, not "well done"', () => {
    h.profile = { spottedCatIds: [1, 2, 3, 4, 99] };
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNotSpotted'));
    fireEvent.change(screen.getByPlaceholderText('catalogSearchPlaceholder'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('noCatsSearch')).toBeTruthy();
    expect(screen.queryByText('filterNotSpottedAllDone')).toBeNull();
  });

  it('all spotted on the map view: map renders with the message over it', () => {
    h.profile = { spottedCatIds: [1, 2, 3, 4] };
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNotSpotted'));
    fireEvent.click(screen.getByLabelText('viewMap'));
    expect(screen.getByTestId('map')).toBeTruthy();
    const message = screen.getByText('filterNotSpottedAllDone');
    expect(message).toBeTruthy();
    // The overlay must not swallow map touches.
    let node: HTMLElement | null = message;
    let none = false;
    while (node && !none) {
      none = getComputedStyle(node).pointerEvents === 'none' || node.style.pointerEvents === 'none';
      node = node.parentElement;
    }
    expect(none).toBe(true);
  });

  it('offline with profile data: chip and stamps still show', () => {
    h.isOnline = false;
    h.profile = { spottedCatIds: [1] };
    render(<CatalogScreen />);
    expect(screen.getByText('filterNotSpotted')).toBeTruthy();
    expect(screen.getByTestId('card-1').getAttribute('data-spotted')).toBe('true');
    noLocks();
  });
});

describe('SYC-508: the Cat-alogue when nothing could be loaded', () => {
  beforeEach(() => {
    h.cats = [];
    h.loadFailed = true;
  });

  it('says so instead of "noCats", with Try again', () => {
    render(<CatalogScreen />);
    expect(screen.queryByText('noCats')).toBeNull();
    expect(screen.queryByText('catalogCount')).toBeNull();
    expect(screen.getByText('loadFailedTitle')).toBeTruthy();
    fireEvent.click(screen.getByTestId('catalogue-load-failed-retry'));
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it('comes before every filter empty message', () => {
    h.profile = { spottedCatIds: [] };
    render(<CatalogScreen />);
    for (const chip of ['filterNearMe', 'filterHasHome', 'filterNotSpotted']) {
      fireEvent.click(screen.getByText(chip));
      expect(screen.getByText('loadFailedTitle')).toBeTruthy();
      for (const key of ['noCats', 'noCatsSearch', 'filterNeedsLocation', 'filterNotSpottedAllDone']) {
        expect(screen.queryByText(key)).toBeNull();
      }
    }
  });

  it('replaces the map too', () => {
    render(<CatalogScreen />);
    fireEvent.click(screen.getByLabelText('viewMap'));
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getByText('loadFailedTitle')).toBeTruthy();
  });

  it('really no cats: still "noCats"', () => {
    h.loadFailed = false;
    render(<CatalogScreen />);
    expect(screen.getByText('noCats')).toBeTruthy();
    expect(screen.queryByText('loadFailedTitle')).toBeNull();
  });
});

describe('Cat-alogue area search and the No home filter (SYC-810)', () => {
  const area = (key: string, name: string) => ({ areaKey: key, areaName: name });
  const search = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText('catalogSearchPlaceholder'), { target: { value } });

  beforeEach(() => {
    h.cats = [
      { ...mkCats(1)[0]!, id: 1, ...area('kini', 'Kini'), hasHome: false },
      { ...mkCats(1)[0]!, id: 2, ...area('kini', 'Kini'), hasHome: true },
      { ...mkCats(1)[0]!, id: 3, ...area('vari', 'Vari'), hasHome: false },
      // An older phone's cached cat: no area and no hasHome field.
      { id: 4, name: 'Cat4', description: '', lat: 37, lng: 24, photoUrl: null },
    ];
  });

  it('typing an area name finds the cats in it', () => {
    render(<CatalogScreen />);
    search('Kini');
    expect(cardIds()).toEqual(['1', '2']);
  });

  it('in Greek, both "Kini" and "Κίνι" find a Kini cat', () => {
    h.language = 'el';
    render(<CatalogScreen />);
    search('Κίνι');
    expect(cardIds()).toEqual(['1', '2']);
    search('Kini');
    expect(cardIds()).toEqual(['1', '2']);
  });

  it('No home comes after Has a home and shows only cats with hasHome false', () => {
    render(<CatalogScreen />);
    const has = screen.getByText('filterHasHome');
    const none = screen.getByText('filterNoHome');
    expect(has.compareDocumentPosition(none) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(none);
    expect(cardIds()).toEqual(['1', '3']);
    expect(selected('filterNoHome')).toBe(true);
  });

  it('"Kini" plus No home leaves out the homed Kini cat', () => {
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNoHome'));
    search('Kini');
    expect(cardIds()).toEqual(['1']);
  });

  it('No home with nothing left says "No cats without a home here."; with a search it keeps the search message', () => {
    h.cats = h.cats.map((c) => ({ ...c, hasHome: true }));
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNoHome'));
    expect(cardIds()).toEqual([]);
    expect(screen.getByText('filterNoHomeEmpty')).toBeTruthy();
    search('zzz');
    expect(screen.getByText('noCatsSearch')).toBeTruthy();
    expect(screen.queryByText('filterNoHomeEmpty')).toBeNull();
  });

  it('on the map view No home narrows the cats too', () => {
    render(<CatalogScreen />);
    fireEvent.click(screen.getByText('filterNoHome'));
    fireEvent.click(screen.getByLabelText('viewMap'));
    expect(screen.getByTestId('map').getAttribute('data-count')).toBe('2');
  });
});
