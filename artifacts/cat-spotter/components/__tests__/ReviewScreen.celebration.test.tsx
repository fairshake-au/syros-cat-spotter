// @vitest-environment jsdom
/**
 * SYC-706: after a spot, "well done" shows the cat and the points, then the
 * badge celebration plays, then the questions. A repeat spot shows a kind line
 * with the cat's name, never "+0".
 */import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat, MatchCandidate } from '@workspace/api-client-react';

const claim = vi.hoisted(() => vi.fn());

const m = vi.hoisted(() => ({
  params: { data: '' } as { data?: string },
  cats: [] as unknown[],
  details: {} as Record<number, unknown>,
  loading: false,
  pending: [] as unknown[],
  resolveSighting: vi.fn(),
  nudge: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({
  Image: (p: { accessibilityLabel?: string }) =>
    React.createElement('img', { 'data-testid': 'cat-image', 'aria-label': p.accessibilityLabel }),
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => m.params,
  usePathname: () => '/',
  useRouter: () => ({ back: vi.fn(), replace: m.replace, push: m.push, canGoBack: () => true, setParams: vi.fn() }),
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
    constructor(
      public status: number,
      public data: unknown = null,
    ) {
      super(`HTTP ${status}`);
    }
  },
  RequestTimeoutError: class RequestTimeoutError extends Error {},
  resolveSighting: m.resolveSighting,
  markMomentCelebrated: mark,
  recheckSighting: vi.fn(),
  suggestCatNames: vi.fn(async () => ({ suggestions: [] })),
  answerSightingQuestions: vi.fn(),
  useGetCat: (id: number, opts?: { query?: { enabled?: boolean } }) => {
    const enabled = opts?.query?.enabled !== false;
    return { data: enabled ? m.details[id] : undefined, isLoading: enabled && m.loading };
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
    pending: m.pending,
    isOnline: true,
    updateReview: vi.fn(async () => {}),
    reviewReadyCount: m.pending.length,
    reviewPromptVisible: true,
    dismissReviewPrompt: vi.fn(),
  }),
}));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'device-1' }) }));
vi.mock('@/context/AppSettingsContext', () => ({ useAppSettings: () => ({ donateHost: 'example.org' }) }));
vi.mock('@/hooks/useCatsWithCache', () => ({ useCatsWithCache: () => ({ cats: m.cats }) }));
vi.mock('@/hooks/useResultNudge', () => ({
  useResultNudge: (args: unknown) => {
    m.nudge(args);
    return { show: null, help: vi.fn(), dismiss: vi.fn() };
  },
}));
vi.mock('@/components/SightingPhoto', () => ({
  SightingPhoto: (p: { testID?: string }) => React.createElement('img', { 'data-testid': p.testID ?? 'sighting-photo' }),
}));
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
const mark = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/context/CelebrationContext', () => ({
  useCelebration: () => ({ pending: false, claimMoment: claim }),
}));
vi.mock('@/lib/pendingPhotos', () => ({ deleteReviewPhoto: vi.fn(async () => {}) }));
vi.mock('@/lib/recentPhotos', () => ({ linkRecentPhotoToCat: vi.fn(async () => {}) }));
vi.mock('@/lib/reportHandoff', () => ({ reviewReportHandoff: vi.fn(() => ({})) }));

import ReviewScreen from '../../app/review';
import { buildReviewParams } from '../../lib/reviewParams';
import { TRANSLATIONS } from '../../lib/i18n';

const en = TRANSLATIONS.en as Record<string, string>;
const FROM = squareCentre({ lat: 37.4448, lng: 24.9425 });
const north = (km: number) => ({ lat: FROM.lat + km / 111.2, lng: FROM.lng });

function publicCat(id: number, name: string, km: number, lifeStatus: Cat['lifeStatus'] = 'street'): Cat {
  return {
    id,
    name,
    description: '',
    photoUrl: `/api/photos/${id}`,
    sightingsCount: 1,
    lastSeenAt: '2026-09-01',
    locationPrecision: 'approximate',
    locationCellM: 250,
    hasHome: false,
    distanceKm: 0.1,
    lifeStatus,
    notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
    coat: [],
    coatColours: [],
    coatPattern: null,
    ...north(km),
  } as Cat;
}

// Agatha (7) is the hinted cat. She is nearby, and in one scenario the matcher
// lists her LAST, below two look-alikes.
const CATS = [
  publicCat(11, 'Inky', 0.05),
  publicCat(12, 'Krispy', 0.1),
  publicCat(7, 'Agatha', 0.15),
  publicCat(13, 'Smoke', 0.2),
];

const profile = {
  badgeProgress: [
    { id: 'first_sighting', group: 'first_steps', earned: true, value: 1, goal: 1 },
    { id: 'five_cats', group: 'first_steps', earned: false, value: 1, goal: 10 },
  ],
  newBadgeIds: ['first_sighting'],
};

function spotWith(result: Record<string, unknown>) {
  m.resolveSighting.mockResolvedValueOnce({
    cat: { id: 7, name: 'Pixel' },
    isNewCat: false,
    pointsAwarded: 15,
    pointsReason: null,
    newBadges: [],
    momentId: null,
    askEarTip: false,
    profile,
    ...result,
  });
  m.params = buildReviewParams({
    sightingId: 574,
    isCatPhoto: true,
    candidates: [],
    photoRef: 'review-574',
    ...FROM,
    hintCatId: 7,
  });
  render(<ReviewScreen />);
  fireEvent.click(screen.getByTestId('hint-yes'));
}

beforeEach(() => {
  m.cats = [publicCat(7, 'Agatha', 0.15)];
  m.details = { 7: { cat: publicCat(7, 'Agatha', 0.15) } };
  m.pending = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

describe('after a spot (SYC-706)', () => {
  it('review screen shows well done, then the celebration, then the questions', async () => {
    spotWith({ newBadges: ['first_sighting'], momentId: 41 });
    await waitFor(() => expect(document.body.innerHTML).toContain(en.matchConfirmed));
    // Well done (cat and points) first; the badge and the questions are not up yet.
    expect(document.body.innerHTML).toContain('+15');
    expect(screen.queryByTestId('celebration')).toBeNull();
    expect(screen.queryByTestId('questions')).toBeNull();
    // The queue must not play this moment a second time.
    expect(claim).toHaveBeenCalledWith(41);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByTestId('celebration').textContent).toBe('first_sighting');
    expect(screen.queryByTestId('questions')).toBeNull();
    // The old pill is gone.
    expect(document.body.innerHTML).not.toContain(en.newBadge);

    fireEvent.click(screen.getByTestId('celebration'));
    expect(screen.getByTestId('questions')).toBeTruthy();
    expect(screen.queryByTestId('celebration')).toBeNull();
    expect(mark).toHaveBeenCalledWith('device-1', 41);
  });

  it('shows the questions at once when the spot earned no badge', async () => {
    spotWith({});
    await waitFor(() => expect(screen.getByTestId('questions')).toBeTruthy());
    expect(screen.queryByTestId('celebration')).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });

  it('repeat_today shows the kind line and no +0', async () => {
    spotWith({ pointsAwarded: 0, pointsReason: 'repeat_today' });
    await waitFor(() => expect(document.body.innerHTML).toContain(en.matchConfirmed));
    expect(document.body.textContent).toContain(
      "You've already spotted Pixel today. Thanks for checking on them! Points come again tomorrow.",
    );
    expect(document.body.textContent).not.toContain('+0');
  });

  it('a cat name with $& in it shows literally in the repeat line', async () => {
    spotWith({ pointsAwarded: 0, pointsReason: 'repeat_today', cat: { id: 7, name: 'Tom$&Jerry' } });
    await waitFor(() => expect(document.body.innerHTML).toContain(en.matchConfirmed));
    expect(document.body.textContent).toContain("You've already spotted Tom$&Jerry today.");
  });
});
