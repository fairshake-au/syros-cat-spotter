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
vi.mock('@/components/report/NeedsHelpLink', () => ({
  NeedsHelpLink: () => null,
  useOpenNeedsHelp: () => () => {},
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));
vi.mock('@/components/ClaimCatSheet', () => ({
  ClaimCatSheet: (p: { mode: string; onClose: () => void }) => (
    <div data-testid="sheet">
      {p.mode}
      <button data-testid="sheet-close" onClick={p.onClose} />
    </div>
  ),
}));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return {
    Button,
    IconButton: ({ label, onPress }: { label: string; onPress?: () => void }) => (
      <button type="button" aria-label={label} onClick={onPress} />
    ),
  };
});
vi.mock('@/lib/urls', () => ({ photoSource: (p: string) => ({ uri: p }) }));

const h = vi.hoisted(() => ({
  isOnline: true,
  deviceId: 'dev-1' as string | null,
  isReady: true,
  startupError: null as Error | null,
  ownedCatIds: [] as number[],
  data: undefined as unknown,
  useGetCat: vi.fn(),
}));
vi.mock('@/components/report/ReportIssueSheet', () => ({ ReportIssueSheet: () => null }));
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: h.deviceId,
    ownedCatIds: h.ownedCatIds,
    isReady: h.isReady,
    startupError: h.startupError,
  }),
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

function page(c: Cat, canClaim: boolean, claimCooldown = false) {
  h.data = { cat: c, sightings: [], fansCount: 1, careTimeline: [], canClaim, claimCooldown };
  return render(<CatDetailScreen />);
}

// The 🏠 "{name} lives with me" card replaced both the claim button and the
// "Does {name} live with you?" link (SYC-624): one card, three behaviours.
const card = () => screen.queryByTestId('lives-with-me-card') as HTMLElement | null;

beforeEach(() => {
  h.isOnline = true;
  h.deviceId = 'dev-1';
  h.isReady = true;
  h.startupError = null;
  h.ownedCatIds = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the cat page waits for who the phone is (ship review 3)', () => {
  // On a cold start the device id and secret load from storage. A request that
  // leaves first is answered as the public, so an owner would not see Edit or
  // "doesn't live with me" until a refetch.
  it('does not ask for the cat until the device context is ready', () => {
    h.isReady = false;
    h.deviceId = null;
    page(cat(), false);
    expect(h.useGetCat.mock.calls[0]![1].query.enabled).toBe(false);
  });

  it('shows the spinner, not the error page, while it waits', () => {
    h.isReady = false;
    h.deviceId = null;
    h.data = undefined;
    render(<CatDetailScreen />);
    expect(screen.queryByText(TRANSLATIONS.en.error!)).toBeNull();
  });

  it('asks once ready, and the query key carries the device id so each phone has its own answer', () => {
    page(cat(), false);
    const q = h.useGetCat.mock.calls[0]![1].query;
    expect(q.enabled).toBe(true);
    expect(q.queryKey).toEqual(['/api/cats/7', 'dev-1']);
  });

  it('still loads when the device setup failed outright (no endless spinner)', () => {
    h.isReady = false;
    h.deviceId = null;
    h.startupError = new Error('no secure random source');
    page(cat(), false);
    expect(h.useGetCat.mock.calls[0]![1].query.enabled).toBe(true);
  });
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

  it('shows the "{name} lives with me" card when canClaim is true, and it opens the claim sheet', () => {
    page(cat(), true);
    expect(card()!.textContent).toContain('Agatha lives with me');
    expect(screen.queryByTestId('claim-ask-sheet')).toBeNull();
    fireEvent.click(card()!);
    expect(screen.getByTestId('sheet').textContent).toBe('claim');
    expect(screen.queryByTestId('claim-ask-sheet')).toBeNull();
  });

  it('a street cat this phone has not met gets the card, and it opens the "lives with you?" sheet, not the claim sheet', () => {
    page(cat(), false);
    expect(card()!.textContent).toContain('Agatha lives with me');
    expect(screen.queryByText(/Spot Agatha with the camera first/)).toBeNull();
    expect(screen.queryByTestId('claim-ask-sheet')).toBeNull();
    fireEvent.click(card()!);
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(screen.getByTestId('claim-ask-body').textContent).toBe(say('claimAskStreet'));
  });

  it('the card is a button with its words as its label, and keeps a 44pt tap height', () => {
    page(cat(), false);
    expect(card()!.getAttribute('role')).toBe('button');
    expect(card()!.getAttribute('aria-label')).toBe('Agatha lives with me');
    expect(getComputedStyle(card()!).minHeight).toBe('44px');
  });

  it('"Does {name} live with you?" is no longer a link on the page', () => {
    page(cat(), false);
    expect(screen.queryByTestId('claim-ask-link')).toBeNull();
    expect(screen.queryByText('Does Agatha live with you?')).toBeNull();
  });

  it('during the 7-day cooldown there is no card, because this phone has spotted it', () => {
    page(cat(), false, true);
    expect(card()).toBeNull();
    expect(screen.getByTestId('needs-help-card')).toBeTruthy();
  });

  it('an older server that sends no claimCooldown still shows the card', () => {
    h.data = { cat: cat(), sightings: [], fansCount: 1, careTimeline: [], canClaim: false };
    render(<CatDetailScreen />);
    expect(card()).toBeTruthy();
  });

  it('a cat with no home that this phone may not claim opens the street sheet, never the claim sheet (not from hasHome alone)', () => {
    page(cat({ hasHome: false }), false);
    fireEvent.click(card()!);
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  it('a cat with a home shows the card for everyone but the owner, and it opens the "email us" sheet', () => {
    page(cat({ hasHome: true, lifeStatus: 'homed' }), false);
    expect(card()).toBeTruthy();
    fireEvent.click(card()!);
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(screen.getByTestId('claim-ask-body').textContent).toBe(say('claimAskHomed'));
  });

  it('a cat in care or deceased shows no card, and the help card takes the whole row', () => {
    for (const lifeStatus of ['in_care', 'deceased'] as const) {
      cleanup();
      page(cat({ lifeStatus }), false);
      expect(card()).toBeNull();
      expect(screen.getByTestId('needs-help-card')).toBeTruthy();
    }
  });

  it('offline, the card is disabled with the connection line', () => {
    h.isOnline = false;
    page(cat(), true);
    expect(card()!.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('You need a connection to do this.')).toBeTruthy();
  });

  it('the old "new phone" and "spot it first" lines are gone', () => {
    page(cat({ hasHome: true, lifeStatus: 'homed' }), false);
    expect(screen.queryByText(/Got a new phone/)).toBeNull();
    cleanup();
    page(cat(), false);
    expect(screen.queryByText(/Is this your cat\?/)).toBeNull();
  });

  it('a street cat: the card opens the sheet with the street text, OK closes it and returns focus to the card', async () => {
    page(cat(), false);
    fireEvent.click(card()!);
    const body = screen.getByTestId('claim-ask-body');
    expect(body.textContent).toBe(say('claimAskStreet'));
    expect(screen.queryByTestId('claim-ask-mailto')).toBeNull();
    fireEvent.click(screen.getByTestId('claim-ask-close'));
    expect(screen.queryByTestId('claim-ask-sheet')).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(card());
  });

  it('closing the claim sheet returns focus to the card', async () => {
    page(cat(), true);
    fireEvent.click(card()!);
    fireEvent.click(screen.getByTestId('sheet-close'));
    expect(screen.queryByTestId('sheet')).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(card());
  });

  it('a homed cat keeps its card during the cooldown', () => {
    page(cat({ hasHome: true, lifeStatus: 'homed' }), false, true);
    expect(card()).toBeTruthy();
  });

  it('a cat with a home: the card opens the sheet with the "email us" text', () => {
    page(cat({ hasHome: true, lifeStatus: 'homed' }), false);
    fireEvent.click(card()!);
    expect(screen.getByTestId('claim-ask-body').textContent).toBe(say('claimAskHomed'));
    expect(screen.getByTestId('claim-ask-mailto').textContent).toBe('hello@catspotters.com');
  });

  it('a stale local list does not make a phone the owner: the server gave the public view', () => {
    // This phone remembers owning cat 7, but the team removed it and someone
    // else claimed: the server answers with the cell, not the exact spot.
    h.ownedCatIds = [7];
    page(cat({ hasHome: true, lifeStatus: 'homed', locationPrecision: 'approximate' }), false);
    expect(screen.queryByText('Edit')).toBeNull();
  });

  it('offline, the saved list is the fallback for showing Edit', () => {
    h.isOnline = false;
    h.ownedCatIds = [7];
    page(cat({ hasHome: true, lifeStatus: 'homed', locationPrecision: 'approximate' }), false);
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('the owner sees their edit button and no 🏠 card', () => {
    h.ownedCatIds = [7];
    page(cat({ hasHome: true, lifeStatus: 'homed', ownerName: 'Eleni', locationPrecision: 'exact' }), false);
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(card()).toBeNull();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('sheet').textContent).toBe('edit');
  });
});
