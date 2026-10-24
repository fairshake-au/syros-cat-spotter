// @vitest-environment jsdom
/**
 * SYC-677 D: a look-alike that is a cat nobody has named yet shows
 * "No name yet" on its card, never its SYR number.
 */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { squareCentre } from '@workspace/geo';
import type { MatchCandidate } from '@workspace/api-client-react';

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
const CANDIDATES = [
  { catId: 21, name: 'SYR-0042', namePending: true, photoUrl: '/api/photos/21', confidence: 0.9, reasoning: 'Same stripes.' },
  { catId: 22, name: 'Inky', namePending: false, photoUrl: '/api/photos/22', confidence: 0.5, reasoning: 'Dark coat.' },
] as MatchCandidate[];

describe('a pending cat as a look-alike card', () => {
  it('reads "No name yet", not its SYR number, and the button says which cat', () => {
    m.cats = [];
    m.params = buildReviewParams({ sightingId: 601, isCatPhoto: true, candidates: CANDIDATES, photoRef: 'review-601', ...FROM });
    const { container, getAllByText } = render(<ReviewScreen />);
    expect(container.textContent).toContain('No name yet');
    expect(container.textContent).toContain('Inky');
    expect(container.textContent).not.toContain('SYR-0042');
    const first = getAllByText(/That.s the one/)[0]!.closest('button')!;
    expect(first.getAttribute('aria-label')).toContain('No name yet');
  });
});

describe('naming a new cat with a SYR number', () => {
  it('shows the syrShapedName words when the server refuses SYR_SHAPED_NAME', async () => {
    const { ApiError } = await import('@workspace/api-client-react');
    m.cats = [];
    m.params = buildReviewParams({ sightingId: 602, isCatPhoto: true, candidates: [], photoRef: 'review-602', ...FROM });
    m.resolveSighting.mockRejectedValue(Object.assign(new ApiError(), { data: { error: 'x', code: 'SYR_SHAPED_NAME' } }));
    const { getByPlaceholderText, getByText, findByText, container } = render(<ReviewScreen />);
    if (!container.textContent!.includes('Add to the cat-alogue')) {
      fireEvent.click(getByText(/None of these/));
    }
    fireEvent.change(getByPlaceholderText('Name this cat…'), { target: { value: 'SYR-0042' } });
    fireEvent.click(getByText(/Add to the cat-alogue/));
    expect(await findByText('That looks like a cat’s SYR number. Choose a name.')).toBeTruthy();
  });
});
