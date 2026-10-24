// @vitest-environment jsdom
/**
 * SYC-574 T2.2 (docs/specs/design-review-fixes-oct22.md §2.1): "I've spotted
 * {name}" on a cat's page. Shown for street and homed cats (the owner too),
 * hidden for a cat in care or one that has died, and it opens the Spot tab
 * with the cat as a hint: `/spot?for={id}`.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cat } from '@workspace/api-client-react';

const r = vi.hoisted(() => ({ push: vi.fn() }));

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
  useRouter: () => ({ canGoBack: () => false, back: () => {}, replace: () => {}, push: r.push }),
}));
vi.mock('@/components/AppMap', () => ({ AppMap: () => null }));
vi.mock('@/components/MoreToAdd', () => ({ MoreToAdd: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({
  NeedsHelpLink: () => null,
  useOpenNeedsHelp: () => () => {},
}));
vi.mock('@/lib/modalVisibility', () => ({ registerModalOpen: () => () => {} }));
vi.mock('@/components/ClaimCatSheet', () => ({
  ClaimCatSheet: (p: { mode: string }) => <div data-testid="sheet">{p.mode}</div>,
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

function page(c: Cat) {
  h.data = { cat: c, sightings: [], fansCount: 1, careTimeline: [], canClaim: false, claimCooldown: false };
  return render(<CatDetailScreen />);
}

const spotted = () => screen.queryByTestId('spotted-cat-button');

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

describe('"I\'ve spotted {name}" on the cat page', () => {
  it.each(['street', 'homed'] as const)('shows for a %s cat, with the cat\'s name', (lifeStatus) => {
    page(cat({ lifeStatus, hasHome: lifeStatus === 'homed' }));
    expect(spotted()?.textContent).toBe('I’ve spotted Agatha');
  });

  it('shows for the owner too', () => {
    h.ownedCatIds = [7];
    page(cat({ lifeStatus: 'homed', hasHome: true }));
    expect(spotted()).toBeTruthy();
  });

  it.each(['in_care', 'deceased'] as const)('is hidden for a cat that is %s', (lifeStatus) => {
    page(cat({ lifeStatus }));
    expect(spotted()).toBeNull();
  });

  it('opens the Spot tab with the cat as a hint, and nothing else', () => {
    page(cat());
    fireEvent.click(spotted()!);
    expect(r.push).toHaveBeenCalledTimes(1);
    expect(r.push).toHaveBeenCalledWith({ pathname: '/spot', params: { for: '7' } });
  });

  it('sits under the status lines and above the "{name} needs help" card', () => {
    page(cat());
    const html = document.body.innerHTML;
    const button = html.indexOf('data-testid="spotted-cat-button"');
    expect(button).toBeGreaterThan(html.indexOf('Last seen'));
    expect(button).toBeLessThan(html.indexOf('data-testid="needs-help-card"'));
  });
});

describe('"Spot {name} now" in the "lives with you?" sheet (T2.6)', () => {
  it('closes the sheet and makes the same push as the page button', () => {
    page(cat());
    fireEvent.click(screen.getByTestId('lives-with-me-card'));
    fireEvent.click(screen.getByTestId('claim-ask-spot-now'));
    expect(screen.queryByTestId('claim-ask-sheet')).toBeNull();
    expect(r.push).toHaveBeenCalledTimes(1);
    expect(r.push).toHaveBeenCalledWith({ pathname: '/spot', params: { for: '7' } });
  });
});
