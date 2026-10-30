// @vitest-environment jsdom
/**
 * SYC-59 PR 5.2 (which-cat-is-which.md §3.1 item 1, D8; spec test 23): after
 * the usual questions the reward screen may ask "These two look alike. Are
 * they the same cat?", with the spotter's own photo above the two cats' main
 * photos. It is optional: skipping sends nothing. An older server sends no
 * `duplicateQuestion`, and then nothing is asked.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { Cat } from '@workspace/api-client-react';

const m = vi.hoisted(() => ({
  params: { data: '' } as { data?: string },
  cats: [] as unknown[],
  details: {} as Record<number, unknown>,
  resolveSighting: vi.fn(),
  answerSightingQuestions: vi.fn(),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: (p: { name: string }) => React.createElement('i', { 'data-icon': p.name }),
}));
vi.mock('expo-image', () => ({
  Image: (p: { source?: { uri?: string }; accessibilityLabel?: string }) =>
    React.createElement('img', { alt: p.accessibilityLabel, src: p.source?.uri }),
}));
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
  answerSightingQuestions: m.answerSightingQuestions,
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
  useResultNudge: () => ({ show: null, help: vi.fn(), dismiss: vi.fn(), nextSpotBringsNewFact: false }),
}));
vi.mock('@/components/SightingPhoto', () => ({
  SightingPhoto: (p: { uri?: string }) => React.createElement('img', { 'data-testid': 'your-photo', src: p.uri }),
}));
vi.mock('@/components/photoTips/PhotoTips', () => ({ PhotoTips: () => null }));
vi.mock('@/components/report/NeedsHelpLink', () => ({ NeedsHelpLink: () => null }));
vi.mock('@/components/FeedNudge', () => ({ FeedNudge: () => null }));
vi.mock('@/components/SightingQuestions', () => ({
  SightingQuestions: () => React.createElement('div', { 'data-testid': 'questions' }, 'questions'),
}));
vi.mock('@/components/celebration/BadgeCelebration', () => ({ BadgeCelebration: () => null }));
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

const catNamed = (id: number, name: string, photoUrl: string | null) =>
  ({
    id, name, description: '', photoUrl, sightingsCount: 1,
    lastSeenAt: '2026-09-01', locationPrecision: 'approximate', locationCellM: 250, hasHome: false,
    distanceKm: 0.1, lifeStatus: 'street', notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
    coat: [], coatColours: [], coatPattern: null, ...FROM,
  }) as unknown as Cat;
const agatha = catNamed(7, 'Agatha', '/api/photos/agatha');
const mimi = catNamed(8, 'Mimi', '/api/photos/mimi');

const profile = {
  badgeProgress: [{ id: 'first_sighting', group: 'first_steps', earned: true, value: 1, goal: 1 }],
  newBadgeIds: ['first_sighting'],
};

function spotWith(result: Record<string, unknown>) {
  m.resolveSighting.mockResolvedValueOnce({
    cat: agatha, isNewCat: false, pointsAwarded: 15, pointsReason: null,
    newBadges: [], momentId: null, askEarTip: false, profile, ...result,
  });
  m.params = buildReviewParams({
    sightingId: 574, isCatPhoto: true, candidates: [], photoRef: 'review-574', ...FROM, hintCatId: 7,
  });
  render(<ReviewScreen />);
  fireEvent.click(screen.getByTestId('hint-yes'));
}

beforeEach(() => {
  m.cats = [agatha, mimi];
  m.details = { 7: { cat: agatha } };
  m.answerSightingQuestions.mockResolvedValue({ recorded: ['duplicate'] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const QUESTION = { catId: 7, otherCatId: 8 };
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('"Are these the same cat?" on the reward screen (spec test 23)', () => {
  it('asks below the usual questions, in the spec\'s words, with the three answers', async () => {
    spotWith({ duplicateQuestion: QUESTION });
    const box = await screen.findByTestId('duplicate-question');
    expect(en.dupQuestion).toBe('These two look alike. Are they the same cat?');
    expect(box.textContent).toContain(en.dupQuestion);
    expect([en.dupSame, en.dupDifferent, en.dupNotSure]).toEqual(['Same cat', 'Different cats', 'Not sure']);
    for (const label of [en.dupSame, en.dupDifferent, en.dupNotSure]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(follows(screen.getByTestId('questions'), box)).toBe(true);
  });

  it('shows the spotter\'s own photo above the two cats\' main photos, each with its name', async () => {
    spotWith({ duplicateQuestion: QUESTION });
    const box = await screen.findByTestId('duplicate-question');
    const yours = screen.getByTestId('duplicate-your-photo');
    const chosen = screen.getByTestId('duplicate-cat-chosen');
    const other = screen.getByTestId('duplicate-cat-other');
    expect(box.contains(yours) && box.contains(chosen) && box.contains(other)).toBe(true);
    expect(follows(yours, chosen)).toBe(true);
    expect(follows(chosen, other)).toBe(true);
    expect(yours.querySelector('img')?.getAttribute('src')).toBe('review-574');
    expect(chosen.textContent).toContain('Agatha');
    expect(other.textContent).toContain('Mimi');
    expect(chosen.querySelector('img')?.getAttribute('src')).toContain('/api/photos/agatha');
    expect(other.querySelector('img')?.getAttribute('src')).toContain('/api/photos/mimi');
  });

  it('sends the answer with the others when the spotter carries on', async () => {
    spotWith({ duplicateQuestion: QUESTION });
    await screen.findByTestId('duplicate-question');
    fireEvent.click(screen.getByText(en.dupSame));
    fireEvent.click(screen.getByText('Agatha →'));
    await waitFor(() => expect(m.answerSightingQuestions).toHaveBeenCalledTimes(1));
    expect(m.answerSightingQuestions).toHaveBeenCalledWith(574, { deviceId: 'device-1', duplicate: 'same' });
  });

  it.each([
    ['dupDifferent', 'different'],
    ['dupNotSure', 'not_sure'],
  ] as const)('%s is sent as %s', async (key, sent) => {
    spotWith({ duplicateQuestion: QUESTION });
    await screen.findByTestId('duplicate-question');
    fireEvent.click(screen.getByText(en[key]!));
    fireEvent.click(screen.getByText('Agatha →'));
    await waitFor(() => expect(m.answerSightingQuestions).toHaveBeenCalledWith(574, { deviceId: 'device-1', duplicate: sent }));
  });

  it('skipping sends nothing at all', async () => {
    spotWith({ duplicateQuestion: QUESTION });
    await screen.findByTestId('duplicate-question');
    fireEvent.click(screen.getByText(en.dupSame));
    fireEvent.click(screen.getByText(en.dupSame));
    fireEvent.click(screen.getByText('Agatha →'));
    // Carrying on opens the cat's page (the router is mocked, so the screen stays).
    await new Promise((r) => setTimeout(r, 20));
    expect(m.answerSightingQuestions).not.toHaveBeenCalled();
  });

  it('is not asked when the server sent no question (an older server, or none worth asking)', async () => {
    spotWith({});
    await screen.findByTestId('questions');
    expect(screen.queryByTestId('duplicate-question')).toBeNull();
  });

  it('is not asked when the question is null', async () => {
    spotWith({ duplicateQuestion: null });
    await screen.findByTestId('questions');
    expect(screen.queryByTestId('duplicate-question')).toBeNull();
  });

  it('fetches the look-alike when the phone\'s cat-alogue does not have it', async () => {
    m.cats = [agatha];
    m.details = { 7: { cat: agatha }, 8: { cat: mimi } };
    spotWith({ duplicateQuestion: QUESTION });
    const other = await screen.findByTestId('duplicate-cat-other');
    expect(other.textContent).toContain('Mimi');
  });

  it('is not asked when the look-alike cannot be shown', async () => {
    m.cats = [agatha];
    spotWith({ duplicateQuestion: QUESTION });
    await screen.findByTestId('questions');
    expect(screen.queryByTestId('duplicate-question')).toBeNull();
  });

  it('is not asked about a cat other than the one the spotter confirmed', async () => {
    spotWith({ duplicateQuestion: { catId: 99, otherCatId: 8 } });
    await screen.findByTestId('questions');
    expect(screen.queryByTestId('duplicate-question')).toBeNull();
  });
});
