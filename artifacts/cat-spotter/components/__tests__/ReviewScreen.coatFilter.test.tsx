// @vitest-environment jsdom
/**
 * SYC-398 PR D (coat-colours-and-pattern.md §4 "they never feed the
 * matcher", §5; plan Task D.3): the colour and pattern chips in "Find the
 * cat" never touch the review screen's suggestions. They are the matcher's,
 * whatever the filter, and a pick sends colourFilterOn as the chips stood.
 *
 * Lives under components/ because vitest only collects tests there, not
 * under app/.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat, MatchCandidate } from '@workspace/api-client-react';

const m = vi.hoisted(() => ({
  params: { data: '' } as { data?: string },
  cats: [] as unknown[],
  resolveSighting: vi.fn(),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => m.params,
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), canGoBack: () => true }),
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
  ApiError: class ApiError extends Error {},
  resolveSighting: m.resolveSighting,
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
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ remove: vi.fn(), pending: [], isOnline: true }) }));
vi.mock('@/context/DeviceContext', () => ({ useDevice: () => ({ deviceId: 'device-1' }) }));
vi.mock('@/context/AppSettingsContext', () => ({ useAppSettings: () => ({ donateHost: 'example.org' }) }));
vi.mock('@/hooks/useCatsWithCache', () => ({ useCatsWithCache: () => ({ cats: m.cats }) }));
vi.mock('@/hooks/useResultNudge', () => ({ useResultNudge: () => ({ show: null, help: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/components/SightingPhoto', () => ({ SightingPhoto: () => null }));
vi.mock('@/components/photoTips/PhotoTips', () => ({ PhotoTips: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/FeedNudge', () => ({ FeedNudge: () => null }));
vi.mock('@/components/SightingQuestions', () => ({ SightingQuestions: () => null }));
vi.mock('@/lib/pendingPhotos', () => ({ deleteReviewPhoto: vi.fn(async () => {}) }));
vi.mock('@/lib/recentPhotos', () => ({ linkRecentPhotoToCat: vi.fn(async () => {}) }));
vi.mock('@/lib/reportHandoff', () => ({ reviewReportHandoff: vi.fn(() => ({})) }));

import ReviewScreen from '../../app/review';
import { buildReviewParams } from '../../lib/reviewParams';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FROM = squareCentre({ lat: 37.4448, lng: 24.9425 });
const north = (km: number) => ({ lat: FROM.lat + km / 111.2, lng: FROM.lng });

function cat(id: number, name: string, km: number, coatColours: string[], coatPattern: string | null): Cat {
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
    lifeStatus: 'street',
    notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
    coat: [],
    coatColours,
    coatPattern,
    ...north(km),
  } as Cat;
}

// The matcher's three suggestions have three different coats, and a fourth
// cat nearby. Whatever the chips pick, at least one suggestion would be
// hidden if the filter ever reached them.
const CATS = [
  cat(11, 'Inky', 0.05, ['black'], 'plain'),
  cat(12, 'Krispy', 0.1, ['brown', 'ginger'], 'stripes'),
  cat(13, 'Smoke', 0.15, ['grey'], null),
  cat(14, 'Toula', 0.2, ['ginger', 'white'], 'plain'),
];
const CANDIDATES: MatchCandidate[] = [
  { catId: 12, name: 'Krispy', photoUrl: '/api/photos/12', confidence: 0.91, reasoning: 'Same stripes.' },
  { catId: 11, name: 'Inky', photoUrl: '/api/photos/11', confidence: 0.55, reasoning: 'Dark coat.' },
  { catId: 13, name: 'Smoke', photoUrl: '/api/photos/13', confidence: 0.2, reasoning: 'Similar build.' },
] as MatchCandidate[];

function renderReview() {
  m.cats = CATS;
  m.params = buildReviewParams({ sightingId: 501, isCatPhoto: true, candidates: CANDIDATES, photoRef: 'review-501', ...FROM });
  return render(<ReviewScreen />);
}

/** The suggestion list as the spotter sees it: each card's text, in order. */
function suggestions(container: HTMLElement): string[] {
  const out: string[] = [];
  for (const btn of Array.from(container.querySelectorAll('button'))) {
    if (btn.textContent !== 'That’s the one' && btn.textContent !== "That's the one") continue;
    out.push(btn.parentElement!.textContent!);
  }
  return out;
}

const PICKS: string[][] = [
  [],
  ['coat-chip-colour-black'],
  ['coat-chip-colour-grey', 'coat-chip-pattern-stripes'],
  ['coat-chip-colour-white'],
  ['coat-chip-pattern-patches'],
  ['coat-chip-colour-brown', 'coat-chip-colour-ginger', 'coat-chip-pattern-plain'],
];

describe('the review screen\'s suggestions are identical whatever the filter', () => {
  it('the baseline lists the matcher\'s three, in its order', () => {
    const { container } = renderReview();
    const list = suggestions(container);
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.match(/^(Krispy|Inky|Smoke)/)?.[1])).toEqual(['Krispy', 'Inky', 'Smoke']);
  });

  it.each(PICKS.map((p) => [p.join(' + ') || 'nothing', p] as const))('after picking %s in Find the cat and coming back', (_name, chips) => {
    const { container, getByTestId, getByText, getByLabelText, unmount } = renderReview();
    const before = suggestions(container);

    fireEvent.click(getByTestId('find-the-cat-card'));
    expect(getByText('Which cat is it?')).toBeTruthy();
    for (const chip of chips) fireEvent.click(getByTestId(chip));
    // The chips really are filtering the picker...
    if (chips.length) expect(container.querySelector('[data-testid="picker-hidden-line"], [data-testid="picker-not-known"]')).not.toBeNull();
    fireEvent.click(getByLabelText('Back'));

    // ...and the suggestions are exactly as they were.
    expect(suggestions(container)).toEqual(before);
    unmount();
  });

  it('a suggestion confirmed after filtering sends no colourFilterOn (it was not a hand pick)', async () => {
    m.resolveSighting.mockRejectedValue(new TypeError('offline'));
    const { getByTestId, getByLabelText, getAllByText } = renderReview();
    fireEvent.click(getByTestId('find-the-cat-card'));
    fireEvent.click(getByTestId('coat-chip-colour-grey'));
    fireEvent.click(getByLabelText('Back'));
    fireEvent.click(getAllByText(/That.s the one/)[0]!);
    await vi.waitFor(() => expect(m.resolveSighting).toHaveBeenCalled());
    expect(m.resolveSighting).toHaveBeenCalledWith(501, { deviceId: 'device-1', catId: 12 });
  });

  it('a hand pick from the picker sends colourFilterOn as the chips stood', async () => {
    m.resolveSighting.mockRejectedValue(new TypeError('offline'));
    const { getByTestId, getByText } = renderReview();
    fireEvent.click(getByTestId('find-the-cat-card'));
    fireEvent.click(getByTestId('coat-chip-colour-ginger'));
    fireEvent.click(getByTestId('picker-cat-14'));
    fireEvent.click(getByText('Yes, this is the cat'));
    await vi.waitFor(() => expect(m.resolveSighting).toHaveBeenCalled());
    expect(m.resolveSighting).toHaveBeenCalledWith(501, { deviceId: 'device-1', catId: 14, pickedFrom: 'nearby', colourFilterOn: true });
  });
});
