// @vitest-environment jsdom
/**
 * SYC-573: the Cat-alogue map opens on the cats. The fit key moves with a
 * filter chip and a settled search only; a phone location fix never remounts
 * the map; shared squares are labelled and, on web, narrow the strip.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  isOnline: true,
  coords: undefined as { latitude: number; longitude: number } | undefined,
  cats: [] as Array<Record<string, unknown>>,
  profile: undefined as unknown,
  mounts: 0,
  last: null as null | Record<string, any>,
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () =>
    new Proxy({}, { get: (_t, k) => (k === 'primary' ? 'rgb(1, 2, 3)' : '#123456') }),
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
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/AppMap', () => ({
  AppMap: (p: Record<string, any>) => {
    React.useEffect(() => {
      h.mounts += 1;
    }, []);
    h.last = p;
    return <div data-testid="map" data-markers={String((p.markers ?? []).length)} />;
  },
}));
vi.mock('@/components/CatCard', () => ({ CatCard: () => null }));
vi.mock('@/components/purropolis', async () => {
  const { Chip } = await import('@/components/purropolis/Chip');
  return { Chip };
});
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({ data: h.profile }),
  getGetProfileQueryKey: (id: string) => [`/api/profile/${id}`],
}));

import CatalogScreen from '../../app/(tabs)/cats';

const cat = (id: number, name: string, lat: number, lng: number) => ({
  id, name, description: '', lat, lng, hasHome: id === 1, photoUrl: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  h.push.mockReset();
  h.coords = undefined;
  h.mounts = 0;
  h.last = null;
  h.cats = [cat(1, 'Agatha', 37.44, 24.94), cat(2, 'Bo', 37.44, 24.94), cat(3, 'Cy', 37.47, 24.99)];
  h.profile = undefined;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const openMap = () => {
  render(<CatalogScreen />);
  fireEvent.click(screen.getByText('viewMap'));
};

describe('a cat nobody has named yet on the map (SYC-677 D)', () => {
  it('the pin reads "No name yet" with its SYR number', () => {
    h.cats = [{ ...cat(1, 'SYR-0042', 37.44, 24.94), namePending: true }, cat(2, 'Bo', 37.47, 24.99)];
    openMap();
    const titles = (h.last!.markers as Array<Record<string, any>>).map((m) => m.title);
    expect(titles).toContain('noNameYet \u00b7 SYR-0042');
    expect(titles).toContain('Bo');
  });
});

describe('Cat-alogue map fit (SYC-573)', () => {
  it('a location fix does not remount the map', () => {
    const { rerender } = render(<CatalogScreen />);
    fireEvent.click(screen.getByText('viewMap'));
    expect(h.mounts).toBe(1);
    h.coords = { latitude: 37.4, longitude: 24.9 };
    rerender(<CatalogScreen />);
    expect(h.mounts).toBe(1);
    expect(h.last!.fitKey).toBe('all|');
    // The opening view never depends on the phone.
    expect(h.last!.latitude).not.toBe(37.4);
  });

  it('typing does not change the fit key until the search settles', () => {
    openMap();
    const before = h.last!.fitKey;
    fireEvent.change(screen.getByPlaceholderText('catalogSearchPlaceholder'), { target: { value: 'Ag' } });
    act(() => { vi.advanceTimersByTime(399); });
    expect(h.last!.fitKey).toBe(before);
    fireEvent.change(screen.getByPlaceholderText('catalogSearchPlaceholder'), { target: { value: 'Aga' } });
    act(() => { vi.advanceTimersByTime(399); });
    expect(h.last!.fitKey).toBe(before);
    act(() => { vi.advanceTimersByTime(2); });
    expect(h.last!.fitKey).not.toBe(before);
    expect(h.mounts).toBe(1);
  });

  it('a filter chip changes the fit key', () => {
    openMap();
    const before = h.last!.fitKey;
    fireEvent.click(screen.getByText('filterHasHome'));
    expect(h.last!.fitKey).not.toBe(before);
    expect(h.mounts).toBe(1);
  });

  it('labels shared squares "N cats" and gives every square a spoken label', () => {
    openMap();
    const areas = h.last!.areas as Array<Record<string, any>>;
    expect(areas).toHaveLength(2);
    const shared = areas.find((a) => a.label)!;
    expect(shared.label).toBe('catsInArea');
    expect(shared.accessibilityLabel).toBe('areaWithCats');
    const single = areas.find((a) => !a.label)!;
    expect(single.accessibilityLabel).toBe('areaOfCat');
  });

  it('web: tapping a shared square narrows the strip, and Show all restores it', () => {
    openMap();
    expect(h.last!.markers).toHaveLength(3);
    const shared = (h.last!.areas as Array<Record<string, any>>).find((a) => a.label)!;
    act(() => shared.onPress());
    expect(h.push).not.toHaveBeenCalled();
    expect((h.last!.markers as Array<{ id: string }>).map((m) => m.id)).toEqual(['1', '2']);
    expect(h.last!.stripAction.label).toBe('mapShowAll');
    act(() => h.last!.stripAction.onPress());
    expect(h.last!.markers).toHaveLength(3);
    expect(h.last!.stripAction).toBeUndefined();
  });

  it('web: a single-cat square still opens the cat', () => {
    openMap();
    const single = (h.last!.areas as Array<Record<string, any>>).find((a) => !a.label)!;
    act(() => single.onPress());
    expect(h.push).toHaveBeenCalledWith({ pathname: '/cat/[id]', params: { id: '3' } });
  });
});
