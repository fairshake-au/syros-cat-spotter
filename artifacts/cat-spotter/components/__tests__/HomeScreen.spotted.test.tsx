// @vitest-environment jsdom
/**
 * SYC-505 Task 4: Home stops padlocking cats. Before a first sighting the hero
 * offers "Spot your first cat"; unknown (no profile, failed fetch, profile
 * without the list) is never treated as zero.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  isOnline: true,
  coords: undefined as { latitude: number; longitude: number } | undefined,
  cats: [] as Array<{ id: number; distanceKm?: number | null }>,
  profile: undefined as unknown,
  isError: false,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () =>
    new Proxy({}, {
      get: (_t, key) => (key === 'accent' ? '#ff00aa' : key === 'primary' ? '#0000ff' : '#123456'),
    }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'dev-1', username: 'sam' }),
}));
vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => ({ isOnline: h.isOnline }),
}));
vi.mock('@/context/LocationContext', () => ({ useAppLocation: () => ({ coords: h.coords }) }));
vi.mock('@/hooks/useCatsWithCache', () => ({
  useCatsWithCache: () => ({ cats: h.cats, isLoading: false }),
}));
vi.mock('@/lib/bannerArea', () => ({ useBannerAreaReserve: () => 0 }));
vi.mock('@/lib/displayUpperCase', () => ({ displayUpperCase: (s: string) => s }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/CatCard', () => ({
  CatCard: (p: { cat: { id: number }; spotted?: boolean }) => (
    <div data-testid={`card-${p.cat.id}`} data-spotted={String(p.spotted)} />
  ),
}));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return {
    Button,
    Avatar: () => null,
    StatTile: () => null,
    StatTileGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({ data: h.profile, isError: h.isError }),
  getGetProfileQueryKey: (id: string) => [`/api/profile/${id}`],
}));

import HomeScreen from '../../app/(tabs)/index';

const cats = (n: number, distanceKm?: number | null) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, distanceKm }));

beforeEach(() => {
  h.push.mockReset();
  h.isOnline = true;
  h.coords = undefined;
  h.cats = cats(4);
  h.profile = undefined;
  h.isError = false;
});
afterEach(cleanup);

const noLocks = () => {
  expect(screen.queryByText('homeSpotToUnlock')).toBeNull();
  expect(document.body.textContent).not.toContain('🔒');
};

describe('Home hero and strip (SYC-505)', () => {
  it('before the first sighting: shows the first-spot line and button, not "0 of N"', () => {
    h.profile = { catsSpotted: 0, spottedCatIds: [], totalCats: 18 };
    render(<HomeScreen />);
    expect(screen.getByText('homeFirstSpotLine')).toBeTruthy();
    expect(screen.queryByText('homeOfNCats')).toBeNull();
    fireEvent.click(screen.getByText('homeFirstSpotCta'));
    expect(h.push).toHaveBeenCalledWith('/spot');
    noLocks();
  });

  it('the first-spot button is the pink accent, not primary blue on the blue hero', () => {
    h.profile = { catsSpotted: 0, spottedCatIds: [], totalCats: 18 };
    render(<HomeScreen />);
    const button = screen.getByText('homeFirstSpotCta').closest('[role="button"]') as HTMLElement;
    expect(button).not.toBeNull();
    expect(button.style.backgroundColor).toBe('rgb(255, 0, 170)');
  });

  it('after a sighting: shows progress and stamps spotted cards', () => {
    h.profile = { catsSpotted: 2, spottedCatIds: [1, 2], totalCats: 19 };
    render(<HomeScreen />);
    expect(screen.getByText('homeOfNCats')).toBeTruthy();
    expect(screen.queryByText('homeFirstSpotCta')).toBeNull();
    expect(screen.getByTestId('card-1').getAttribute('data-spotted')).toBe('true');
    expect(screen.getByTestId('card-3').getAttribute('data-spotted')).toBe('false');
    noLocks();
  });

  it('no profile: no button, no stamps', () => {
    render(<HomeScreen />);
    expect(screen.queryByText('homeFirstSpotCta')).toBeNull();
    expect(screen.queryByText('homeFirstSpotLine')).toBeNull();
    expect(screen.queryByTestId('home-progress-fill')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    for (const id of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`card-${id}`).getAttribute('data-spotted')).toBe('undefined');
    }
    noLocks();
  });

  it('failed profile fetch while online: no button', () => {
    h.isError = true;
    render(<HomeScreen />);
    expect(screen.queryByText('homeFirstSpotCta')).toBeNull();
    noLocks();
  });

  it('profile without spottedCatIds (out-of-date server): no button', () => {
    h.profile = { catsSpotted: 0, totalCats: 18 };
    render(<HomeScreen />);
    expect(screen.queryByText('homeFirstSpotCta')).toBeNull();
    noLocks();
  });

  it('heading says nearby only when a cat really is near', () => {
    h.coords = { latitude: 37, longitude: 24 };
    h.cats = cats(2, 0.2);
    const { unmount } = render(<HomeScreen />);
    expect(screen.getByText('homeNearbyEyebrow')).toBeTruthy();
    unmount();

    h.cats = cats(2, 40);
    const second = render(<HomeScreen />);
    expect(screen.getByText('homeToCollectEyebrow')).toBeTruthy();
    second.unmount();

    h.coords = undefined;
    render(<HomeScreen />);
    expect(screen.getByText('homeToCollectEyebrow')).toBeTruthy();
    noLocks();
  });

  it('heading judges the cats actually shown: a spotted near cat pushed off the strip is not "near you"', () => {
    h.coords = { latitude: 37, longitude: 24 };
    h.profile = { catsSpotted: 1, spottedCatIds: [1], totalCats: 6 };
    h.cats = [
      { id: 1, distanceKm: 0.2 },
      ...[2, 3, 4, 5, 6].map((id) => ({ id, distanceKm: 40 })),
    ];
    render(<HomeScreen />);
    expect(screen.queryByTestId('card-1')).toBeNull();
    expect(screen.getByText('homeToCollectEyebrow')).toBeTruthy();
    expect(screen.queryByText('homeNearbyEyebrow')).toBeNull();
  });

  it('profile without spottedCatIds shows a dash and an empty bar, even with a count', () => {
    h.profile = { catsSpotted: 0, totalCats: 18 };
    render(<HomeScreen />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByTestId('home-progress-fill')).toBeNull();
  });
});
