// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchCandidate } from '@workspace/api-client-react';
import { ApiError, RequestTimeoutError } from '@workspace/api-client-react';

const m = vi.hoisted(() => ({
  params: { data: '' } as { data?: string },
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
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), canGoBack: () => true, setParams: m.setParams }),
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
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ remove: vi.fn(), pending: [], isOnline: true, updateReview: m.updateReview }) }));
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
vi.mock('@/lib/pendingPhotos', () => ({ deleteReviewPhoto: vi.fn(async () => {}) }));
vi.mock('@/lib/recentPhotos', () => ({ linkRecentPhotoToCat: vi.fn(async () => {}) }));
vi.mock('@/lib/reportHandoff', () => ({ reviewReportHandoff: vi.fn(() => ({})) }));

import ReviewScreen from '../../app/review';
import { buildReviewParams, parseReviewParams } from '../../lib/reviewParams';
import { TRANSLATIONS } from '../../lib/i18n';

// SYC-503 (when-the-photo-check-fails.md §2): when the look-alike check
// failed, the spotter is told so, never "you're the first to spot this cat".
// Lives under components/ because vitest only collects tests there.

const en = TRANSLATIONS.en as Record<string, string>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FOUND: MatchCandidate = {
  catId: 12,
  name: 'Krispy',
  photoUrl: '/api/photos/12',
  confidence: 0.91,
  reasoning: 'Same stripes.',
} as MatchCandidate;

function renderReview(over: Parameters<typeof buildReviewParams>[0] = {}) {
  m.cats = [];
  m.params = buildReviewParams({
    sightingId: 503,
    isCatPhoto: true,
    candidates: [],
    matchCheck: 'failed',
    canRecheck: true,
    photoRef: 'review-503',
    lat: 37.44,
    lng: 24.94,
    ...over,
  });
  return render(<ReviewScreen />);
}

const text = () => document.body.textContent ?? '';

describe("the couldn't-check screen", () => {
  it('opens instead of naming or "not a cat", with the photo and three actions', () => {
    renderReview();
    expect(screen.getByTestId('couldnt-check')).toBeTruthy();
    expect(text()).toContain(en.couldntCheckTitle);
    expect(text()).not.toContain(en.newFurriendSubtitle);
    expect(text()).not.toContain(en.notACat);
    expect(screen.getByTestId('sighting-photo')).toBeTruthy();
    expect(screen.getByTestId('couldnt-check-find').textContent).toBe(en.couldntCheckFind);
    expect(screen.getByTestId('couldnt-check-again').textContent).toBe(en.couldntCheckAgain);
    expect(screen.getByTestId('couldnt-check-new').textContent).toBe(en.couldntCheckNew);
  });

  it('even if the route also says "not a cat", a failed check never claims it', () => {
    renderReview({ isCatPhoto: false });
    expect(screen.getByTestId('couldnt-check')).toBeTruthy();
    expect(text()).not.toContain(en.notACat);
  });

  it('"Find this cat" opens the picker, and closing it comes back here', () => {
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-find'));
    expect(screen.queryByTestId('couldnt-check')).toBeNull();
    expect(text()).toContain(en.pickerAddNewAction);
    fireEvent.click(screen.getByLabelText(en.back));
    expect(screen.getByTestId('couldnt-check')).toBeTruthy();
  });

  it('a name that is taken by a nearby cat, then "no", keeps the unchecked subtitle', async () => {
    m.resolveSighting.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, d: unknown) => Error)(409, {
        code: 'NAME_TAKEN',
        cat: { id: 77, name: 'Mitsos', photoUrl: null },
      }),
    );
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-new'));
    fireEvent.change(screen.getByPlaceholderText(en.nameYourCat), { target: { value: 'Mitsos' } });
    fireEvent.click(screen.getByText(en.addToCatalogButton));
    await waitFor(() => expect(m.resolveSighting).toHaveBeenCalled());
    // The taken cat isn't nearby here, so the spotter is asked for another name.
    await waitFor(() =>
      expect(screen.getByTestId('naming-subtitle').textContent).toBe(en.newFurriendSubtitleUnchecked),
    );
  });

  it('"It\'s a new cat" names it without "first to spot", and back returns here', () => {
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-new'));
    expect(screen.getByTestId('naming-subtitle').textContent).toBe(en.newFurriendSubtitleUnchecked);
    expect(screen.getByTestId('naming-photo')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(en.back));
    expect(screen.getByTestId('couldnt-check')).toBeTruthy();
  });

  it('the picker\'s "Add it as a new cat" also shows the unchecked subtitle', () => {
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-find'));
    fireEvent.click(screen.getByText(en.pickerAddNewAction));
    expect(screen.getByTestId('naming-subtitle').textContent).toBe(en.newFurriendSubtitleUnchecked);
  });

  it('hides "Check again" when the photo has gone, and says why', () => {
    renderReview({ canRecheck: false });
    expect(screen.queryByTestId('couldnt-check-again')).toBeNull();
    expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.couldntCheckCant);
  });
});

describe('"Check again"', () => {
  it('a check that now works lands on the look-alikes, and the answer is kept', async () => {
    m.recheckSighting.mockResolvedValueOnce({
      sightingId: 503,
      isCatPhoto: true,
      candidates: [FOUND],
      matchCheck: 'done',
      canRecheck: false,
    });
    renderReview({ localId: 'local-503' });
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() => expect(text()).toContain(en.lookalikesFound));
    expect(m.recheckSighting).toHaveBeenCalledWith(503, { deviceId: 'device-1' });
    expect(screen.queryByTestId('couldnt-check')).toBeNull();
    expect(m.updateReview).toHaveBeenCalledWith('local-503', expect.objectContaining({ matchCheck: 'done' }));
    const kept = parseReviewParams(m.setParams.mock.calls[0]![0].data);
    expect(kept).toMatchObject({ matchCheck: 'done', candidates: [expect.objectContaining({ catId: 12 })] });
  });

  it('a check that now works with no look-alikes names it as first to spot', async () => {
    m.recheckSighting.mockResolvedValueOnce({
      sightingId: 503,
      isCatPhoto: true,
      candidates: [],
      matchCheck: 'done',
      canRecheck: false,
    });
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() =>
      expect(screen.getByTestId('naming-subtitle').textContent).toBe(en.newFurriendSubtitle),
    );
  });

  it('failing again stays here with a line, and can be tried again', async () => {
    m.recheckSighting.mockResolvedValueOnce({
      sightingId: 503,
      isCatPhoto: true,
      candidates: [],
      matchCheck: 'failed',
      canRecheck: true,
    });
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() =>
      expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.couldntCheckStill),
    );
    expect(screen.getByTestId('couldnt-check-again')).toBeTruthy();
  });

  it('at the limit says to try again in a few minutes', async () => {
    m.recheckSighting.mockRejectedValueOnce(new (ApiError as unknown as new (s: number) => Error)(429));
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() =>
      expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.couldntCheckLimit),
    );
  });

  it('"still checking" (an earlier tap is running) keeps the button and says wait', async () => {
    m.recheckSighting.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, d: unknown) => Error)(409, { code: 'CHECK_RUNNING' }),
    );
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() =>
      expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.couldntCheckBusy),
    );
    expect(screen.getByTestId('couldnt-check-again')).toBeTruthy();
  });

  it('a check that already worked elsewhere comes back with its look-alikes', async () => {
    m.recheckSighting.mockResolvedValueOnce({
      sightingId: 503,
      isCatPhoto: true,
      candidates: [{ ...FOUND, reasoning: '' }],
      matchCheck: 'done',
      canRecheck: false,
    });
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() => expect(text()).toContain('Krispy'));
  });

  it('a refusal (resolved, or never recorded) hides the button', async () => {
    m.recheckSighting.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, d: unknown) => Error)(409, { code: 'RESOLVED' }),
    );
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() => expect(screen.queryByTestId('couldnt-check-again')).toBeNull());
    expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.couldntCheckCant);
  });

  it('a request that never answers stops "Checking…" and says there is no signal', async () => {
    m.recheckSighting.mockRejectedValueOnce(new (RequestTimeoutError as unknown as new () => Error)());
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() =>
      expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.pickerNoSignalStay),
    );
    expect(screen.getByTestId('couldnt-check-again').textContent).toBe(en.couldntCheckAgain);
  });

  it('with no signal says so', async () => {
    m.recheckSighting.mockRejectedValueOnce(new TypeError('Network request failed'));
    renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() =>
      expect(screen.getByTestId('couldnt-check-line').textContent).toBe(en.pickerNoSignalStay),
    );
  });
});

describe('the naming screen after a check that worked', () => {
  it('keeps "first to spot" and shows the spotter\'s own photo', () => {
    renderReview({ matchCheck: 'done', canRecheck: false });
    expect(screen.queryByTestId('couldnt-check')).toBeNull();
    expect(screen.getByTestId('naming-subtitle').textContent).toBe(en.newFurriendSubtitle);
    expect(screen.getByTestId('naming-photo')).toBeTruthy();
  });

  it('shows the emoji when this phone has no copy of the photo', () => {
    renderReview({ matchCheck: 'done', canRecheck: false, photoRef: undefined });
    expect(screen.queryByTestId('naming-photo')).toBeNull();
    expect(text()).toContain('🐈');
  });
});

describe('a different sighting in the same screen (review finding 9)', () => {
  it('starts fresh, without the previous sighting\'s recheck answer', async () => {
    m.recheckSighting.mockResolvedValueOnce({
      sightingId: 503,
      isCatPhoto: true,
      candidates: [FOUND],
      matchCheck: 'done',
      canRecheck: false,
    });
    const view = renderReview();
    fireEvent.click(screen.getByTestId('couldnt-check-again'));
    await waitFor(() => expect(text()).toContain(en.lookalikesFound));
    m.params = buildReviewParams({
      sightingId: 504,
      isCatPhoto: true,
      candidates: [],
      matchCheck: 'failed',
      canRecheck: true,
      photoRef: 'review-504',
    });
    view.rerender(<ReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('couldnt-check')).toBeTruthy());
  });
});
