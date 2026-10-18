// @vitest-environment jsdom
/**
 * SYC-44 PR 6.1 on the cat page (report-an-issue.md §3, §4.2, D4): the main
 * photo opens full screen once loaded, with the date and who spotted it; a
 * hidden sighting photo shows the tile; no report link is offered until PR
 * 6.2's reason sheet exists. Harness as CatPageClaim.test.tsx.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cat, Sighting } from '@workspace/api-client-react';

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({
  Image: ({ source, testID, onLoad }: { source?: { uri?: string }; testID?: string; onLoad?: () => void }) => (
    <img data-testid={testID ?? 'image'} data-uri={source?.uri ?? ''} onLoad={onLoad} />
  ),
}));
vi.mock('react-native', async () => {
  const rn = await vi.importActual<Record<string, unknown>>('react-native-web');
  return {
    ...rn,
    Modal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? <div data-testid="mock-modal">{children}</div> : null,
  };
});
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
  isReady: true,
  startupError: null as Error | null,
  ownedCatIds: [] as number[],
  data: undefined as unknown,
  useGetCat: vi.fn(),
}));
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

const SIGHTINGS: Sighting[] = [
  {
    catId: 7,
    spotterCode: 'AB12',
    spotterUsername: null,
    spotterNickname: 'Eleni',
    photoUrl: null,
    photoHidden: true,
    createdAt: '2026-10-10',
  },
  {
    catId: 7,
    spotterCode: 'CD34',
    spotterUsername: 'maria',
    spotterNickname: null,
    photoUrl: '/api/photos/7',
    photoHidden: false,
    createdAt: '2026-09-01',
  },
];

function page(c: Cat, sightings: Sighting[] = SIGHTINGS) {
  h.data = {
    cat: c,
    sightings,
    fansCount: 1,
    careTimeline: [{ type: 'discovered', message: 'maria', at: '2026-09-01' }],
    canClaim: false,
    claimCooldown: false,
  };
  return render(<CatDetailScreen />);
}


const viewer = () => document.querySelector('[data-testid="sighting-photo-viewer"]');

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

describe('the cat page\'s photos (SYC-44 PR 6.1)', () => {
  it('the main photo opens full screen once loaded, with its sighting\'s date and spotter', () => {
    page(cat());
    const hero = screen.getByTestId('cat-hero-open');
    fireEvent.click(hero);
    expect(viewer(), 'not before the photo has loaded').toBeNull();

    fireEvent.load(hero.querySelector('img')!);
    fireEvent.click(hero);
    expect(viewer()).not.toBeNull();
    expect(screen.getByTestId('photo-viewer-date').textContent).toBe(new Date(2026, 8, 1).toLocaleDateString());
    expect(screen.getByTestId('photo-viewer-spotter').textContent).toBe('Spotted by maria');
    expect(screen.getByTestId('sighting-photo-viewer-close').textContent).toBe(en.extraPhotoClose);
    fireEvent.click(screen.getByTestId('sighting-photo-viewer-close'));
    expect(viewer()).toBeNull();
  });

  it('a cat with no photo opens nothing', () => {
    page(cat({ photoUrl: null }), []);
    const hero = screen.getByTestId('cat-hero-open');
    fireEvent.load(hero.querySelector('img')!);
    fireEvent.click(hero);
    expect(viewer()).toBeNull();
  });

  it('a hidden sighting photo shows the tile, and the visible one stays a photo', () => {
    page(cat());
    const tiles = screen.getAllByTestId('photo-hidden-tile');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.textContent).toBe('Photo hidden while Syros Cats take a look.');
    expect(screen.getAllByTestId('sighting-cover')).toHaveLength(1);
  });

  it('offers no "Report an issue" link yet: PR 6.2 adds it with its sheet', () => {
    page(cat());
    expect(document.body.textContent).not.toContain(en.reportIssue);
    const hero = screen.getByTestId('cat-hero-open');
    fireEvent.load(hero.querySelector('img')!);
    fireEvent.click(hero);
    expect(screen.queryByTestId('photo-viewer-report')).toBeNull();
  });
});
