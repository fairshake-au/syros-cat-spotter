// @vitest-environment jsdom
/**
 * SYC-130 Task 8: what a cat's page shows about claiming
 * (docs/specs/claiming-a-cat.md §4.1), and what it sends so the server can
 * decide. The button comes from the server's `canClaim`, never from
 * `hasHome` alone.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cat } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '7' }),
  useRouter: () => ({ canGoBack: () => false, back: () => {}, replace: () => {} }),
}));
vi.mock('@/components/AppMap', () => ({ AppMap: () => null }));
vi.mock('@/components/MoreToAdd', () => ({ MoreToAdd: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/ClaimCatSheet', () => ({
  ClaimCatSheet: (p: { mode: string }) => <div data-testid="sheet">{p.mode}</div>,
}));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return {
    Button,
    Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    StatTile: () => null,
    IconButton: () => null,
  };
});
vi.mock('@/lib/urls', () => ({ photoSource: (p: string) => ({ uri: p }) }));

const h = vi.hoisted(() => ({
  isOnline: true,
  deviceId: 'dev-1' as string | null,
  ownedCatIds: [] as number[],
  data: undefined as unknown,
  useGetCat: vi.fn(),
}));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ deviceId: h.deviceId, ownedCatIds: h.ownedCatIds }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({ notifications: [], markRead: () => {} }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return { useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k }) };
});
vi.mock('@workspace/api-client-react', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    useGetCat: (...args: unknown[]) => {
      h.useGetCat(...args);
      return { isLoading: false, data: h.data };
    },
    getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
  };
});

import CatDetailScreen from '../../app/cat/[id]';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;
const say = (key: string) => en[key]!.split('{name}').join('Agatha');

function cat(over: Partial<Cat> = {}): Cat {
  return {
    id: 7,
    name: 'Agatha',
    description: '',
    photoUrl: '/api/photos/7',
    sightingsCount: 2,
    lastSeenAt: '2026-09-01',
    locationPrecision: 'approximate',
    locationCellM: 250,
    lat: 37.4448,
    lng: 24.9425,
    hasHome: false,
    lifeStatus: 'street',
    notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
    ...over,
  } as Cat;
}

function page(c: Cat, canClaim: boolean) {
  h.data = { cat: c, sightings: [], fansCount: 1, careTimeline: [], canClaim };
  return render(<CatDetailScreen />);
}

const claimButton = () =>
  Array.from(document.querySelectorAll('[role="button"], button')).find(
    (e) => e.textContent?.trim() === 'This is my cat',
  ) as HTMLElement | undefined;

beforeEach(() => {
  h.isOnline = true;
  h.deviceId = 'dev-1';
  h.ownedCatIds = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the cat page and claiming (§4.1)', () => {
  it('sends the device id so the server can say whether this phone may claim', () => {
    page(cat(), true);
    const opts = h.useGetCat.mock.calls[0]![1];
    expect(opts.request).toEqual({ headers: { 'X-Device-Id': 'dev-1' } });
  });

  it('sends it whether or not this phone remembers owning the cat', () => {
    h.ownedCatIds = [];
    page(cat(), false);
    expect(h.useGetCat.mock.calls[0]![1].request.headers['X-Device-Id']).toBe('dev-1');
  });

  it('shows "This is my cat" when canClaim is true, and it opens the claim sheet', () => {
    page(cat(), true);
    expect(claimButton()).toBeTruthy();
    expect(screen.queryByText(say('claimNotMetHint'))).toBeNull();
    fireEvent.click(claimButton()!);
    expect(screen.getByTestId('sheet').textContent).toBe('claim');
  });

  it('a street cat this phone has not met gets the quiet hint and no button', () => {
    page(cat(), false);
    expect(claimButton()).toBeUndefined();
    expect(
      screen.getByText(
        'Is this your cat? Spot Agatha with the camera first, then you can say Agatha lives with you.',
      ),
    ).toBeTruthy();
  });

  it('never shows the button from hasHome alone: a cat with no home but canClaim false has none', () => {
    page(cat({ hasHome: false }), false);
    expect(claimButton()).toBeUndefined();
  });

  it('a cat with a home shows neither the button nor the hint', () => {
    page(cat({ hasHome: true, lifeStatus: 'homed' }), false);
    expect(claimButton()).toBeUndefined();
    expect(screen.queryByText(say('claimNotMetHint'))).toBeNull();
  });

  it('a cat in care or deceased shows neither', () => {
    for (const lifeStatus of ['in_care', 'deceased'] as const) {
      cleanup();
      page(cat({ lifeStatus }), false);
      expect(claimButton()).toBeUndefined();
      expect(screen.queryByText(say('claimNotMetHint'))).toBeNull();
    }
  });

  it('offline, the button is disabled with the connection line', () => {
    h.isOnline = false;
    page(cat(), true);
    expect(claimButton()!.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('You need a connection to do this.')).toBeTruthy();
  });

  it('under "Has a home", a visitor who is not the owner sees the new-phone line', () => {
    page(cat({ hasHome: true, lifeStatus: 'homed' }), false);
    expect(
      screen.getByText(
        'Got a new phone? Ask Syros Cats to remove the old owner, then you can say Agatha lives with you again.',
      ),
    ).toBeTruthy();
  });

  it('the owner sees their edit button and no new-phone line', () => {
    h.ownedCatIds = [7];
    page(cat({ hasHome: true, lifeStatus: 'homed', ownerName: 'Eleni' }), false);
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.queryByText(/Got a new phone/)).toBeNull();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('sheet').textContent).toBe('edit');
  });
});
