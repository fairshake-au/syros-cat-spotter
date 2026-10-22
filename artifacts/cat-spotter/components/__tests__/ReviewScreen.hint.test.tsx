// @vitest-environment jsdom
/**
 * SYC-574 T2.5 (docs/specs/design-review-fixes-oct22.md §2.3, §2.4): "Is this
 * {name}?" is its own first step, before whichever screen the result opens.
 *
 * The privacy rule: the hint never changes what the matcher shows. The
 * question is the same whatever the matcher returned (decision D2: always
 * ask), and after a "No" every screen is exactly what it would have been with
 * no hint: the matches list (not reordered, highlighted or filtered), the
 * naming subtitle, the couldn't-check screen, "Find the cat"'s nearby list,
 * and the screen recorded as `openedOn`.
 *
 * Lives under components/ because vitest only collects tests there.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat, MatchCandidate } from '@workspace/api-client-react';

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
vi.mock('@/components/SightingQuestions', () => ({ SightingQuestions: () => null }));
vi.mock('@/lib/pendingPhotos', () => ({ deleteReviewPhoto: vi.fn(async () => {}) }));
vi.mock('@/lib/recentPhotos', () => ({ linkRecentPhotoToCat: vi.fn(async () => {}) }));
vi.mock('@/lib/reportHandoff', () => ({ reviewReportHandoff: vi.fn(() => ({})) }));

import ReviewScreen from '../../app/review';
import { ReviewReadyBanner } from '../ReviewReadyBanner';
import { ApiError } from '@workspace/api-client-react';
import { buildReviewParams } from '../../lib/reviewParams';
import { TRANSLATIONS } from '../../lib/i18n';

const en = TRANSLATIONS.en as Record<string, string>;
const say = (key: string, name = 'Agatha') => en[key]!.split('{name}').join(name);

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
const cand = (catId: number, name: string, confidence: number): MatchCandidate =>
  ({ catId, name, photoUrl: `/api/photos/${catId}`, confidence, reasoning: `Looks like ${name}.` }) as MatchCandidate;
const WITH_AGATHA = [cand(12, 'Krispy', 0.91), cand(11, 'Inky', 0.55), cand(7, 'Agatha', 0.42)];
const WITHOUT_AGATHA = [cand(12, 'Krispy', 0.91), cand(11, 'Inky', 0.55)];
// Review finding 1: the matcher confident it's Agatha, at the top and alone.
const AGATHA_TOP = [cand(7, 'Agatha', 0.95), cand(12, 'Krispy', 0.6), cand(11, 'Inky', 0.45)];
const AGATHA_ONLY = [cand(7, 'Agatha', 0.97)];

type Scenario = {
  name: string;
  over: Parameters<typeof buildReviewParams>[0];
  opens: 'matches' | 'naming' | 'couldntCheck';
};
const SCENARIOS: Scenario[] = [
  { name: 'matches that include the hinted cat', over: { candidates: WITH_AGATHA }, opens: 'matches' },
  { name: 'matches without the hinted cat', over: { candidates: WITHOUT_AGATHA }, opens: 'matches' },
  { name: 'the hinted cat as the confident top match', over: { candidates: AGATHA_TOP }, opens: 'matches' },
  { name: 'the hinted cat as the only, confident match', over: { candidates: AGATHA_ONLY }, opens: 'matches' },
  { name: 'no candidates', over: { candidates: [] }, opens: 'naming' },
  { name: "a check that couldn't run", over: { candidates: [], matchCheck: 'failed', canRecheck: true }, opens: 'couldntCheck' },
];

function setRoute(over: Parameters<typeof buildReviewParams>[0], hint: number | null) {
  m.params = buildReviewParams({
    sightingId: 574,
    isCatPhoto: true,
    candidates: [],
    photoRef: 'review-574',
    ...FROM,
    ...over,
    ...(hint !== null ? { hintCatId: hint } : {}),
  });
}

function renderReview(over: Parameters<typeof buildReviewParams>[0], hint: number | null = 7) {
  setRoute(over, hint);
  return render(<ReviewScreen />);
}

const html = () => document.body.innerHTML;
const question = () => screen.queryByTestId('hint-question');

/** What the spotter would see with no hint at all, for the same result. */
function baseline(over: Parameters<typeof buildReviewParams>[0], then?: () => void): string {
  renderReview(over, null);
  then?.();
  const out = html();
  cleanup();
  return out;
}

beforeEach(() => {
  m.cats = CATS;
  m.details = { 7: { cat: publicCat(7, 'Agatha', 0.15) } };
  m.loading = false;
  m.pending = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('"Is this {name}?" shows whatever the matcher said (decision D2)', () => {
  it.each(SCENARIOS)('shows first for $name', ({ over }) => {
    renderReview(over);
    expect(question()).toBeTruthy();
    expect(screen.getByTestId('hint-question-title').textContent).toBe('Is this Agatha?');
    expect(html()).not.toContain(en.lookalikesFound);
    expect(screen.queryByTestId('couldnt-check')).toBeNull();
    expect(screen.queryByTestId('naming-subtitle')).toBeNull();
  });

  it('THE LEAK TEST: the question step is identical, byte for byte, for every result', () => {
    const seen = SCENARIOS.map(({ over }) => {
      renderReview(over);
      const q = question();
      expect(q, 'the question must show for every result').toBeTruthy();
      const out = q!.outerHTML;
      cleanup();
      return out;
    });
    for (const other of seen.slice(1)) expect(other).toBe(seen[0]);
  });

  it('is not asked for "not a cat"; the hint is dropped and that screen opens', () => {
    renderReview({ isCatPhoto: false, candidates: [] });
    expect(question()).toBeNull();
    expect(html()).toContain(en.notACat);
  });

  it('shows both photos side by side, and both buttons name the cat', () => {
    renderReview({ candidates: WITHOUT_AGATHA });
    expect(screen.getByTestId('sighting-photo')).toBeTruthy();
    expect(screen.getByLabelText("Agatha’s photo")).toBeTruthy();
    expect(screen.getByLabelText(say('hintYes')).textContent).toBe('Yes, it’s Agatha');
    expect(screen.getByLabelText(say('hintNo')).textContent).toBe(en.hintNo);
  });

  it.each(['in_care', 'deceased'] as const)('is never asked about a cat that is %s', (lifeStatus) => {
    m.details = { 7: { cat: publicCat(7, 'Agatha', 0.15, lifeStatus) } };
    renderReview({ candidates: WITHOUT_AGATHA });
    expect(question()).toBeNull();
    expect(html()).toContain(en.lookalikesFound);
  });

  it('waits for the hinted cat, then asks', () => {
    m.loading = true;
    m.details = {};
    const view = renderReview({ candidates: WITHOUT_AGATHA });
    expect(question()).toBeNull();
    expect(html()).not.toContain(en.lookalikesFound);
    m.loading = false;
    m.details = { 7: { cat: publicCat(7, 'Agatha', 0.15) } };
    view.rerender(<ReviewScreen />);
    expect(question()).toBeTruthy();
  });

  it('a route with no hint shows no question (as before)', () => {
    renderReview({ candidates: WITHOUT_AGATHA }, null);
    expect(question()).toBeNull();
  });
});

describe('after "No", every screen is exactly what it would have been with no hint', () => {
  it.each(SCENARIOS)('$name: the whole screen matches the no-hint screen', ({ over }) => {
    const expected = baseline(over);
    renderReview(over);
    fireEvent.click(screen.getByTestId('hint-no'));
    expect(question()).toBeNull();
    expect(html()).toBe(expected);
  });

  it('the matches list keeps the matcher\'s order, with the hinted cat last and unmarked', () => {
    renderReview({ candidates: WITH_AGATHA });
    fireEvent.click(screen.getByTestId('hint-no'));
    const names = Array.from(document.querySelectorAll('button'))
      .filter((b) => b.textContent === en.thatsTheOne)
      .map((b) => b.parentElement!.textContent!);
    expect(names.map((n) => n.split(/\d+%/)[0])).toEqual(['Krispy', 'Inky', 'Agatha']);
  });

  it('the naming subtitle is the ordinary one', () => {
    renderReview({ candidates: [] });
    fireEvent.click(screen.getByTestId('hint-no'));
    expect(screen.getByTestId('naming-subtitle').textContent).toBe(en.newFurriendSubtitle);
  });

  it('"Find the cat"\'s nearby list is the same as with no hint', () => {
    const openPicker = () => fireEvent.click(screen.getByTestId('find-the-cat-card'));
    const expected = baseline({ candidates: WITH_AGATHA }, openPicker);
    renderReview({ candidates: WITH_AGATHA });
    fireEvent.click(screen.getByTestId('hint-no'));
    openPicker();
    expect(html()).toBe(expected);
    expect(screen.getByTestId('picker-cat-7')).toBeTruthy();
  });

  it.each(SCENARIOS)('$name: openedOn records the result\'s own screen, never the question', ({ over, opens }) => {
    renderReview(over);
    const screens = new Set(m.nudge.mock.calls.map(([a]) => (a as { screen: string }).screen));
    expect([...screens]).toEqual([opens]);
    fireEvent.click(screen.getByTestId('hint-no'));
    const after = new Set(m.nudge.mock.calls.map(([a]) => (a as { screen: string }).screen));
    expect([...after]).toEqual([opens]);
  });
});

describe('"Yes"', () => {
  it('resolves to the hinted cat with pickedFrom cat_page, and shows the usual success screen', async () => {
    m.resolveSighting.mockResolvedValueOnce({
      cat: { id: 7, name: 'Agatha' },
      isNewCat: false,
      pointsAwarded: 15,
      newBadges: [],
      askEarTip: false,
    });
    renderReview({ candidates: WITHOUT_AGATHA });
    fireEvent.click(screen.getByTestId('hint-yes'));
    await waitFor(() => expect(html()).toContain(en.matchConfirmed));
    expect(m.resolveSighting).toHaveBeenCalledTimes(1);
    expect(m.resolveSighting).toHaveBeenCalledWith(574, {
      deviceId: 'device-1',
      catId: 7,
      pickedFrom: 'cat_page',
    });
    expect(html()).toContain('+15');
  });

  it.each([
    ['matches', { candidates: WITHOUT_AGATHA }, () => expect(html()).toContain(en.lookalikesFound)],
    ['naming', { candidates: [] }, () => expect(screen.getByTestId('naming-subtitle')).toBeTruthy()],
    [
      "couldn't-check",
      { candidates: [], matchCheck: 'failed' as const, canRecheck: true },
      () => expect(screen.getByTestId('couldnt-check')).toBeTruthy(),
    ],
  ])('a NOT_NEARBY refusal shows on the step itself; "Carry on" opens %s', async (_n, over, opened) => {
    m.resolveSighting.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, d: unknown) => Error)(422, { code: 'NOT_NEARBY' }),
    );
    renderReview(over);
    fireEvent.click(screen.getByTestId('hint-yes'));
    await waitFor(() => expect(screen.getByTestId('hint-message').textContent).toBe(say('hintNotNearby')));
    // Still the question step, with "Yes" replaced by "Carry on".
    expect(question()).toBeTruthy();
    expect(screen.queryByTestId('hint-yes')).toBeNull();
    expect(screen.getByTestId('hint-carry-on').textContent).toBe(en.hintCarryOn);
    fireEvent.click(screen.getByTestId('hint-carry-on'));
    expect(question()).toBeNull();
    opened();
    // The message lived only in the step's own slot: nothing carries over.
    expect(html()).not.toContain(say('hintNotNearby'));
    expect(html()).not.toContain(en.pickerNotNearby);
  });

  it('another refusal says so on the step, and Carry on goes on', async () => {
    m.resolveSighting.mockRejectedValueOnce(
      new (ApiError as unknown as new (s: number, d: unknown) => Error)(409, { code: 'CAT_DECEASED' }),
    );
    renderReview({ candidates: WITHOUT_AGATHA });
    fireEvent.click(screen.getByTestId('hint-yes'));
    await waitFor(() => expect(screen.getByTestId('hint-message').textContent).toBe(say('hintCantAdd')));
    fireEvent.click(screen.getByTestId('hint-carry-on'));
    expect(html()).toContain(en.lookalikesFound);
  });

  it('no signal is not a refusal: "Yes" stays, to try again', async () => {
    m.resolveSighting.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderReview({ candidates: WITHOUT_AGATHA });
    fireEvent.click(screen.getByTestId('hint-yes'));
    await waitFor(() => expect(screen.getByTestId('hint-message').textContent).toBe(en.pickerNoSignalStay));
    expect(screen.getByTestId('hint-yes')).toBeTruthy();
    expect(screen.queryByTestId('hint-carry-on')).toBeNull();
  });
});

describe('a queued spot keeps its hint on the queue item (§2.4)', () => {
  const QUEUED = {
    localId: 'q-1',
    photoUri: 'file:///documents/pending-photos/q-1.jpg',
    lat: FROM.lat,
    lng: FROM.lng,
    createdAt: '2026-10-21T09:00:00.000Z',
    status: 'review' as const,
    sightingId: 574,
    isCatPhoto: true,
    candidates: WITHOUT_AGATHA,
    matchCheck: 'done' as const,
    hintCatId: 7,
  };
  /** The route the Spot tab's list and the banner build: the item's id only. */
  const queuedRoute = (extra: { hintCatId?: number } = {}) =>
    buildReviewParams({
      sightingId: QUEUED.sightingId,
      isCatPhoto: QUEUED.isCatPhoto,
      candidates: QUEUED.candidates,
      matchCheck: QUEUED.matchCheck,
      localId: QUEUED.localId,
      ...extra,
    });

  it('opened through the "ready to review" banner, the question still shows', () => {
    m.pending = [QUEUED];
    render(<ReviewReadyBanner />);
    fireEvent.click(screen.getByText(en.reviewReadyOne));
    expect(m.push).toHaveBeenCalledTimes(1);
    const route = m.push.mock.calls[0]![0] as { pathname: string; params: { data: string } };
    expect(route.pathname).toBe('/review');
    // The banner's route carries only the item's id, never the hint.
    expect(route.params.data).not.toMatch(/hint/);
    cleanup();
    m.params = route.params;
    render(<ReviewScreen />);
    expect(question()).toBeTruthy();
    expect(screen.getByTestId('hint-question-title').textContent).toBe('Is this Agatha?');
  });

  it('a queued item with no hint asks nothing, even if the route is crafted to carry one', () => {
    m.pending = [{ ...QUEUED, hintCatId: undefined }];
    m.params = queuedRoute({ hintCatId: 7 });
    render(<ReviewScreen />);
    expect(question()).toBeNull();
    expect(html()).toContain(en.lookalikesFound);
  });

  it('"Yes" on a queued spot sends cat_page too', async () => {
    m.pending = [QUEUED];
    m.resolveSighting.mockResolvedValueOnce({
      cat: { id: 7, name: 'Agatha' },
      isNewCat: false,
      pointsAwarded: 15,
      newBadges: [],
      askEarTip: false,
    });
    m.params = queuedRoute();
    render(<ReviewScreen />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('hint-yes'));
    });
    expect(m.resolveSighting).toHaveBeenCalledWith(574, { deviceId: 'device-1', catId: 7, pickedFrom: 'cat_page' });
  });
});
