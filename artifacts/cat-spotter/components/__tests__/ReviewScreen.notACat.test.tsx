// @vitest-environment jsdom
/**
 * SYC-508 (couldnt-load-try-again.md §3.4, §5 with D1 Option A, Samuel 24 Oct):
 * "No cat found" says what happens and goes back to the Spot tab; a review
 * opened from a broken link has a way out.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchCandidate } from '@workspace/api-client-react';
import { ApiError, RequestTimeoutError } from '@workspace/api-client-react';

const m = vi.hoisted(() => ({
  params: { data: '' } as { data?: string },
  remove: vi.fn(async (_localId: string) => {}),
  dismissTo: vi.fn(),
  deleteReviewPhoto: vi.fn(async (_id: number) => {}),
  pending: [] as unknown[],
  cats: [] as unknown[],
  resolveSighting: vi.fn(),
  recheckSighting: vi.fn(),
  setParams: vi.fn(),
  updateReview: vi.fn(async () => {}),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => m.params,
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), canGoBack: () => true, setParams: m.setParams, dismissTo: m.dismissTo }),
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
  recheckSighting: m.recheckSighting,
  suggestCatNames: vi.fn(async () => ({ suggestions: [] })),
  answerSightingQuestions: vi.fn(),
  useGetCat: () => ({ data: undefined }),
  getGetCatQueryKey: (id: number) => [`/api/cats/${id}`],
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#123456' }) }));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('../../lib/i18n');
  return { useLanguage: () => ({ t: (key: string) => TRANSLATIONS.en[key] ?? key, language: 'en' }) };
});
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ remove: m.remove, pending: m.pending, isOnline: true, updateReview: m.updateReview }) }));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'device-1' }) }));
vi.mock('@/context/AppSettingsContext', () => ({ useAppSettings: () => ({ donateHost: 'example.org' }) }));
vi.mock('@/hooks/useCatsWithCache', () => ({ useCatsWithCache: () => ({ cats: m.cats }) }));
vi.mock('@/hooks/useResultNudge', () => ({ useResultNudge: () => ({ show: null, help: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/components/SightingPhoto', () => ({
  SightingPhoto: (p: { testID?: string }) => React.createElement('img', { 'data-testid': p.testID ?? 'sighting-photo' }),
}));
vi.mock('@/components/photoTips/PhotoTips', () => ({ PhotoTips: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/FeedNudge', () => ({ FeedNudge: () => null }));
vi.mock('@/components/SightingQuestions', () => ({ SightingQuestions: () => null }));
vi.mock('@/lib/pendingPhotos', () => ({ deleteReviewPhoto: m.deleteReviewPhoto }));
vi.mock('@/lib/recentPhotos', () => ({ linkRecentPhotoToCat: vi.fn(async () => {}) }));
vi.mock('@/lib/reportHandoff', () => ({ reviewReportHandoff: vi.fn(() => ({})) }));

import ReviewScreen from '../../app/review';
import { buildReviewParams } from '../../lib/reviewParams';
import { TRANSLATIONS } from '../../lib/i18n';

const en = TRANSLATIONS.en as Record<string, string>;

function open(input: Parameters<typeof buildReviewParams>[0]) {
  m.params = buildReviewParams(input);
  return render(<ReviewScreen />);
}

beforeEach(() => {
  m.remove.mockClear();
  m.dismissTo.mockClear();
  m.deleteReviewPhoto.mockClear();
  m.pending = [];
});
afterEach(cleanup);

describe('"No cat found" (D1 Option A)', () => {
  it('says the photo won\'t be added, and the button is Take another photo', () => {
    open({ sightingId: 9, isCatPhoto: false, candidates: [], matchCheck: 'done', photoRef: 'review-9' });
    expect(screen.getByText(en.notACatNotAdded!)).toBeTruthy();
    expect(screen.getByText(en.notACatRetake!)).toBeTruthy();
    expect(screen.queryByText(en.tryAgain!)).toBeNull();
  });

  it('a sent spot: deletes its 7-day photo by sighting id and goes to the Spot tab', async () => {
    open({ sightingId: 9, isCatPhoto: false, candidates: [], matchCheck: 'done', photoRef: 'review-9' });
    fireEvent.click(screen.getByText(en.notACatRetake!));
    await waitFor(() => expect(m.dismissTo).toHaveBeenCalledWith('/spot'));
    expect(m.deleteReviewPhoto).toHaveBeenCalledWith(9);
    expect(m.remove).not.toHaveBeenCalled();
  });

  it('a spot saved for later: leaves the review list, then the Spot tab', async () => {
    m.pending = [{ localId: 'loc-1', status: 'review', sightingId: 9, photos: [] }];
    open({ sightingId: 9, isCatPhoto: false, candidates: [], matchCheck: 'done', localId: 'loc-1' });
    fireEvent.click(screen.getByText(en.notACatRetake!));
    await waitFor(() => expect(m.dismissTo).toHaveBeenCalledWith('/spot'));
    expect(m.remove).toHaveBeenCalledWith('loc-1');
    expect(m.deleteReviewPhoto).not.toHaveBeenCalled();
  });
});

describe('"No cat found": one Take another photo at a time', () => {
  it('a double tap navigates once', async () => {
    open({ sightingId: 9, isCatPhoto: false, candidates: [], matchCheck: 'done', photoRef: 'review-9' });
    const button = screen.getByText(en.notACatRetake!);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(m.dismissTo).toHaveBeenCalled());
    expect(m.dismissTo).toHaveBeenCalledTimes(1);
    expect(m.deleteReviewPhoto).toHaveBeenCalledTimes(1);
  });
});

describe('a review opened from a broken link', () => {
  it('says so, with Go to the Spot tab and a back arrow, never "Something went wrong"', () => {
    m.params = { data: 'not json' };
    render(<ReviewScreen />);
    expect(screen.getByText(en.reviewOpenFailedTitle!)).toBeTruthy();
    expect(screen.getByText(en.reviewOpenFailedBody!)).toBeTruthy();
    expect(screen.queryByText(en.error!)).toBeNull();
    expect(screen.getByLabelText(en.back!)).toBeTruthy();
    fireEvent.click(screen.getByText(en.reviewOpenFailedCta!));
    expect(m.dismissTo).toHaveBeenCalledWith('/spot');
  });
});
