// @vitest-environment jsdom
/**
 * SYC-772 (spec §3.3, §5.1): the thanks screen shows "Your next spot brings a
 * new cat fact." only when the hook says so. The hook's own logic is tested in
 * useResultNudge.test.tsx; here the hook is mocked to a boolean.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat } from '@workspace/api-client-react';

const m = vi.hoisted(() => ({
  params: { data: '' } as { data?: string },
  cats: [] as unknown[],
  details: {} as Record<number, unknown>,
  resolveSighting: vi.fn(),
  nextFact: true as boolean | undefined,
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: (p: { name: string }) => React.createElement('i', { 'data-icon': p.name }),
}));
vi.mock('expo-image', () => ({ Image: () => React.createElement('img') }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => m.params,
  usePathname: () => '/',
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), canGoBack: () => true, setParams: vi.fn() }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));
vi.mock('react-native-svg', () => {
  const make = (name: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-el': name }, children);
  const names = ['Svg', 'G', 'Rect', 'Circle', 'Ellipse', 'Path', 'Polygon', 'Defs', 'ClipPath'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
});
vi.mock('@workspace/api-client-react', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public data: unknown = null) {
      super(`HTTP ${status}`);
    }
  },
  RequestTimeoutError: class RequestTimeoutError extends Error {},
  resolveSighting: m.resolveSighting,
  markMomentCelebrated: vi.fn(async () => {}),
  recheckSighting: vi.fn(),
  suggestCatNames: vi.fn(async () => ({ suggestions: [] })),
  answerSightingQuestions: vi.fn(),
  useGetCat: (id: number, opts?: { query?: { enabled?: boolean } }) => {
    const enabled = opts?.query?.enabled !== false;
    return { data: enabled ? m.details[id] : undefined, isLoading: false };
  },
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#123456' }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('../../lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => TRANSLATIONS.en[key] ?? key, language: 'en' }) };
});
vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => ({
    remove: vi.fn(async () => {}),
    pending: [],
    isOnline: true,
    updateReview: vi.fn(async () => {}),
    reviewReadyCount: 0,
    reviewPromptVisible: true,
    dismissReviewPrompt: vi.fn(),
  }),
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'device-1' }) }));
vi.mock('@/context/AppSettingsContext', () => ({ useAppSettings: () => ({ donateHost: 'example.org' }) }));
vi.mock('@/hooks/useCatsWithCache', () => ({ useCatsWithCache: () => ({ cats: m.cats }) }));
vi.mock('@/hooks/useResultNudge', () => ({
  useResultNudge: () => ({ show: null, help: vi.fn(), dismiss: vi.fn(), nextSpotBringsNewFact: m.nextFact }),
}));
vi.mock('@/components/SightingPhoto', () => ({ SightingPhoto: () => React.createElement('img') }));
vi.mock('@/components/photoTips/PhotoTips', () => ({ PhotoTips: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/FeedNudge', () => ({ FeedNudge: () => null }));
vi.mock('@/components/SightingQuestions', () => ({
  SightingQuestions: () => React.createElement('div', { 'data-testid': 'questions' }, 'questions'),
}));
vi.mock('@/components/celebration/BadgeCelebration', () => ({
  BadgeCelebration: (p: { moment: { badgeIds: string[] }; onDone: () => void }) =>
    React.createElement('button', { 'data-testid': 'celebration', onClick: p.onDone }, p.moment.badgeIds.join(',')),
}));
vi.mock('@/context/CelebrationContext', () => ({
  useCelebration: () => ({ pending: false, claimMoment: vi.fn() }),
}));
vi.mock('@/lib/pendingPhotos', () => ({ deleteReviewPhoto: vi.fn(async () => {}) }));
vi.mock('@/lib/recentPhotos', () => ({ linkRecentPhotoToCat: vi.fn(async () => {}) }));
vi.mock('@/lib/reportHandoff', () => ({ reviewReportHandoff: vi.fn(() => ({})) }));

import ReviewScreen from '../../app/review';
import { buildReviewParams } from '../../lib/reviewParams';
import { TRANSLATIONS } from '../../lib/i18n';

const en = TRANSLATIONS.en as Record<string, string>;
const FROM = squareCentre({ lat: 37.4448, lng: 24.9425 });

const agatha = {
  id: 7, name: 'Agatha', description: '', photoUrl: '/api/photos/7', sightingsCount: 1,
  lastSeenAt: '2026-09-01', locationPrecision: 'approximate', locationCellM: 250, hasHome: false,
  distanceKm: 0.1, lifeStatus: 'street', notSeenSince: null,
  sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
  coat: [], coatColours: [], coatPattern: null, ...FROM,
} as unknown as Cat;

const profile = {
  badgeProgress: [{ id: 'first_sighting', group: 'first_steps', earned: true, value: 1, goal: 1 }],
  newBadgeIds: ['first_sighting'],
};

function spotWith(result: Record<string, unknown>) {
  m.resolveSighting.mockResolvedValueOnce({
    cat: { id: 7, name: 'Pixel' }, isNewCat: false, pointsAwarded: 15, pointsReason: null,
    newBadges: [], momentId: null, askEarTip: false, profile, ...result,
  });
  m.params = buildReviewParams({
    sightingId: 574, isCatPhoto: true, candidates: [], photoRef: 'review-574', ...FROM, hintCatId: 7,
  });
  render(<ReviewScreen />);
  fireEvent.click(screen.getByTestId('hint-yes'));
}

beforeEach(() => {
  m.cats = [agatha];
  m.details = { 7: { cat: agatha } };
  m.nextFact = true;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe('the next-fact line on the thanks screen (SYC-772)', () => {
  it('shows when the hook says the next spot brings a new fact', async () => {
    spotWith({});
    await waitFor(() => expect(screen.getByTestId('next-fact-line')).toBeTruthy());
    expect(screen.getByTestId('next-fact-line').textContent).toContain(en.factNextSpot);
  });

  it('is absent when the hook says false', async () => {
    m.nextFact = false;
    spotWith({});
    await waitFor(() => expect(screen.getByTestId('questions')).toBeTruthy());
    expect(screen.queryByTestId('next-fact-line')).toBeNull();
  });

  it('is absent when the hook gives no answer', async () => {
    m.nextFact = undefined;
    spotWith({});
    await waitFor(() => expect(screen.getByTestId('questions')).toBeTruthy());
    expect(screen.queryByTestId('next-fact-line')).toBeNull();
  });

  it('is hidden while the celebration plays, and shows after', async () => {
    spotWith({ newBadges: ['first_sighting'], momentId: 41 });
    await waitFor(() => expect(document.body.innerHTML).toContain(en.matchConfirmed));
    expect(screen.queryByTestId('next-fact-line')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByTestId('celebration')).toBeTruthy();
    expect(screen.queryByTestId('next-fact-line')).toBeNull();
    fireEvent.click(screen.getByTestId('celebration'));
    expect(screen.getByTestId('next-fact-line')).toBeTruthy();
  });

  it('shows on a repeat spot with no points', async () => {
    spotWith({ pointsAwarded: 0, pointsReason: 'repeat_today' });
    await waitFor(() => expect(screen.getByTestId('next-fact-line')).toBeTruthy());
    expect(document.body.textContent).not.toContain('+0');
  });
});
