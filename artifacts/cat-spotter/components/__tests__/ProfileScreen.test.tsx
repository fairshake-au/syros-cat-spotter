// @vitest-environment jsdom
/**
 * SYC-628: the Profile tab in three tabs (docs/specs/profile-tab-redesign.md §3,
 * §8). Unknown is never shown as zero; the reminder only when keep-safe is off.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  push: vi.fn(),
  refetch: vi.fn(),
  isOnline: true,
  profile: undefined as unknown,
  profileError: false,
  profileLoading: false,
  leaderboard: undefined as unknown,
  week: undefined as unknown,
  lang: 'en' as 'en' | 'el',
  keepSafe: undefined as { status: string } | undefined,
  keepSafeOffer: null as string | null,
  username: 'sam' as string | null,
  heldUsername: null as string | null,
  nameNote: null as unknown,
  setNameNote: vi.fn(),
  params: {} as { tab?: string },
  setParams: vi.fn(),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => new Proxy({}, { get: () => '#123456' }),
}));
vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-router', () => ({
  router: { push: h.push, setParams: h.setParams },
  useLocalSearchParams: () => h.params,
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({ t: (k: string) => TRANSLATIONS[h.lang][k] ?? k, language: h.lang }),
  };
});
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({
    deviceId: 'dev-1',
    username: h.username,
    heldUsername: h.heldUsername,
    nameNote: h.nameNote,
    setNameNote: h.setNameNote,
    keepSafeOffer: h.keepSafeOffer,
  }),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.isOnline }) }));
vi.mock('@/hooks/useKeepSafeState', () => ({
  useKeepSafeState: () => ({ data: h.keepSafe, isError: false }),
}));
vi.mock('@/lib/bannerArea', () => ({ useBannerAreaReserve: () => 0 }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/components/purropolis', async () => {
  const { Button } = await import('@/components/purropolis/Button');
  return {
    Button,
    Avatar: () => null,
    ProgressBar: (p: { value: number; max: number }) => <div data-testid="bar">{`${p.value}/${p.max}`}</div>,
    StatTile: (p: { value: React.ReactNode; label: string }) => (
      <div data-testid={`tile-${p.label}`}>{p.value}</div>
    ),
    StatTileGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});
vi.mock('@workspace/api-client-react', () => ({
  useGetProfile: () => ({
    data: h.profile,
    isError: h.profileError,
    isLoading: h.profileLoading,
    refetch: h.refetch,
  }),
  getGetProfileQueryKey: (id: string) => [`/api/profiles/${id}`],
  useGetLeaderboard: () => ({ data: h.leaderboard, isError: false, isLoading: false }),
  getGetLeaderboardQueryKey: () => ['/api/leaderboard'],
  useGetLeaderboardWeek: () => ({ data: h.week, isError: false, isLoading: false }),
  getGetLeaderboardWeekQueryKey: () => ['/api/leaderboard/week'],
}));

import ProfileScreen from '../../app/(tabs)/profile';

// The server's badgeProgress, in catalogue order: [id, group, stat, goal]. Pathfinder
// and Trailblazer are event badges (null value and goal).
const CATALOGUE: [string, string, string | null, number | null][] = [
  ['first_sighting', 'first_steps', 'totalSightings', 1],
  ['first_discovery', 'first_steps', 'uniqueCatsDiscovered', 1],
  ['five_cats', 'first_steps', 'catsSpotted', 5],
  ['ten_cats', 'first_steps', 'catsSpotted', 10],
  ['explorer', 'first_steps', 'totalSightings', 25],
  ['island_legend', 'first_steps', 'points', 500],
  ['weeks_2', 'coming_back', null, 2],
  ['weeks_4', 'coming_back', null, 4],
  ['weeks_8', 'coming_back', null, 8],
  ['podium', 'weekly', null, 1],
  ['champion', 'weekly', null, 1],
  ['ten_discoveries', 'finding', 'uniqueCatsDiscovered', 10],
  ['discover_25', 'finding', 'uniqueCatsDiscovered', 25],
  ['discover_50', 'finding', 'uniqueCatsDiscovered', 50],
  ['discover_100', 'finding', 'uniqueCatsDiscovered', 100],
  ['areas_3', 'covering', null, 3],
  ['areas_8', 'covering', null, 8],
  ['areas_all', 'covering', null, 20],
  ['pathfinder', 'covering', null, null],
  ['trailblazer', 'covering', null, null],
  ['remote_1', 'covering', null, 1],
  ['remote_5', 'covering', null, 5],
];

const progressFor = (stats: Record<string, number>, earned: string[]) =>
  CATALOGUE.map(([id, group, stat, goal]) => {
    const isEarned = earned.includes(id);
    const raw = stat ? stats[stat] ?? 0 : 0;
    return {
      id,
      group,
      earned: isEarned,
      value: goal === null ? null : isEarned ? goal : Math.min(raw, goal),
      goal,
    };
  });

const profile = (over: Record<string, unknown> = {}) => ({
  deviceId: 'dev-1',
  spotterCode: 'ME01',
  username: 'harbourcat',
  points: 85,
  totalSightings: 12,
  uniqueCatsDiscovered: 2,
  catsSpotted: 7,
  badges: ['first_sighting', 'first_discovery', 'five_cats'],
  spottedCatIds: [1, 2, 3, 4, 5, 6, 7],
  currentStreakDays: 3,
  totalCats: 40,
  badgeProgress: progressFor(
    { totalSightings: 12, uniqueCatsDiscovered: 2, catsSpotted: 7, points: 85, ...over },
    (over.badges as string[] | undefined) ?? ['first_sighting', 'first_discovery', 'five_cats'],
  ),
  newBadgeIds: [],
  weekPoints: 0,
  ...over,
});

const weekBoard = (over: Record<string, unknown> = {}) => ({
  weekStart: '2026-10-19',
  endsAt: '2026-10-26T00:00:00+02:00',
  entries: [
    { spotterCode: 'W1', username: 'weekly_wren', points: 55, rank: 1, uniqueCatsDiscovered: 0 },
    { spotterCode: 'ME01', username: 'harbourcat', points: 25, rank: 2, uniqueCatsDiscovered: 0 },
  ],
  lastWeek: [
    { place: 1, name: 'Marco', points: 90 },
    { place: 2, name: null, points: 60 },
    { place: 3, name: 'Sophie', points: 40 },
  ],
  ...over,
});

const board = [
  { spotterCode: 'A', username: 'kalimera_kat', points: 310, rank: 1, uniqueCatsDiscovered: 4 },
  { spotterCode: 'B', username: 'vaporia_vee', points: 120, rank: 2, uniqueCatsDiscovered: 1 },
  { spotterCode: 'ME01', username: 'harbourcat', points: 85, rank: 3, uniqueCatsDiscovered: 2 },
  { spotterCode: 'Z', username: 'Spotter A7CE', points: 0, rank: 4, uniqueCatsDiscovered: 0 },
];

beforeEach(() => {
  h.push.mockReset();
  h.refetch.mockReset();
  h.setNameNote.mockReset();
  h.params = {};
  h.setParams.mockReset().mockImplementation(() => {
    h.params = {};
  });
  h.lang = 'en';
  h.isOnline = true;
  h.profile = profile();
  h.profileError = false;
  h.profileLoading = false;
  h.leaderboard = board;
  h.week = weekBoard();
  h.keepSafe = { status: 'none' };
  h.keepSafeOffer = null;
  h.username = 'sam';
  h.heldUsername = null;
  h.nameNote = null;
});
afterEach(cleanup);

describe('Profile tabs (SYC-628)', () => {
  it('?tab=badges opens the Badges tab and is used up, so a second visit works too', () => {
    h.params = { tab: 'badges' };
    const { rerender } = render(<ProfileScreen />);
    expect(screen.getByTestId('badge-row-first_sighting')).toBeTruthy();
    expect(h.setParams).toHaveBeenCalledWith({ tab: undefined });
    rerender(<ProfileScreen />); // the param is now gone
    fireEvent.click(screen.getByTestId('profile-tab-me'));
    expect(screen.queryByTestId('badge-row-first_sighting')).toBeNull();
    // A later celebration's "See all my badges" sets the param again.
    h.params = { tab: 'badges' };
    rerender(<ProfileScreen />);
    expect(screen.getByTestId('badge-row-first_sighting')).toBeTruthy();
    expect(h.setParams).toHaveBeenCalledTimes(2);
  });

  it('opens on Me with Home’s three counts and the first-finds caption tucked under them', () => {
    render(<ProfileScreen />);
    expect(screen.getByTestId('tile-Spotted').textContent).toBe('7');
    expect(screen.getByTestId('tile-First finds').textContent).toBe('2');
    expect(screen.getByTestId('tile-Badges').textContent).toBe('3');
    // SYC-594
    expect(screen.getByTestId('profile-first-finds-hint').textContent).toBe(
      'First finds: Cats nobody had spotted before you.',
    );
    expect(screen.queryByTestId('badge-row-ten_cats')).toBeNull();
  });

  it('header: name, rank line, and a Settings button that says "Settings"', () => {
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-name').textContent).toBe('harbourcat');
    expect(screen.getByTestId('profile-rank-line').textContent).toBe('Spotter · 3rd on the island');
    const settings = screen.getByTestId('profile-settings-button');
    expect(settings.textContent).toBe('Settings');
    fireEvent.click(settings);
    expect(h.push).toHaveBeenCalledWith('/settings');
  });

  it('offline with no profile: the name still comes from the phone (SYC-13), counts are dashes', () => {
    h.isOnline = false;
    h.profile = undefined;
    h.leaderboard = undefined;
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-name').textContent).toBe('sam');
    expect(screen.getByTestId('tile-Spotted').textContent).toBe('—');
    expect(screen.getByTestId('profile-rank-line').textContent).toBe('Spotter');
    expect(screen.queryByTestId('profile-badges-panel')).toBeNull();
    expect(screen.queryByTestId('profile-safe-nudge')).toBeNull();
  });

  it('before the first spot: one card and a Spot a cat button instead of three zeros', () => {
    h.profile = profile({ catsSpotted: 0, spottedCatIds: [], totalSightings: 0, badges: [] });
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-first-spot')).toBeTruthy();
    expect(screen.queryByTestId('tile-Spotted')).toBeNull();
    fireEvent.click(screen.getByText('Spot a cat'));
    expect(h.push).toHaveBeenCalledWith('/spot');
  });

  it('the safety reminder shows only when keep-safe is known to be off', () => {
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-safe-nudge')).toBeTruthy();
    fireEvent.click(screen.getByText('Add'));
    expect(h.push).toHaveBeenCalledWith('/keep-safe');
    cleanup();

    h.keepSafe = { status: 'pending' };
    render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-safe-nudge')).toBeNull();
    cleanup();

    h.keepSafe = undefined;
    render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-safe-nudge')).toBeNull();
    cleanup();

    h.keepSafe = { status: 'none' };
    h.keepSafeOffer = 'skipped-onboarding';
    render(<ProfileScreen />);
    expect(screen.queryByTestId('profile-safe-nudge')).toBeNull();
  });

  it('badges panel: next badge with progress, and See all opens the Badges tab', () => {
    render(<ProfileScreen />);
    const next = screen.getByTestId('profile-next-badge');
    expect(next.textContent).toContain('Cat Whisperer');
    expect(next.textContent).toContain('3 to go');
    fireEvent.click(screen.getByTestId('profile-badges-see-all'));
    expect(screen.getByTestId('profile-badges-count').textContent).toBe('3 of 22 earned');
  });

  it('Badges tab: every badge says how to earn it; progress only for unearned ones', () => {
    render(<ProfileScreen />);
    fireEvent.click(screen.getByTestId('profile-tab-badges'));
    expect(screen.getByTestId('badge-row-first_sighting').textContent).toContain('Record your first sighting');
    expect(screen.queryByTestId('badge-progress-first_sighting')).toBeNull();
    expect(screen.getByTestId('badge-progress-ten_cats').textContent).toBe('7 of 10');
    expect(screen.getByTestId('badge-progress-island_legend').textContent).toBe('85 of 500 points');
    expect(screen.getByTestId('badge-row-ten_discoveries').textContent).toContain('Discover 10 new cats');
  });

  it('Badges tab without a badge list (old server): no lists, a dash, not "0 of 22"', () => {
    h.profile = profile({ badges: undefined, badgeProgress: undefined });
    render(<ProfileScreen />);
    fireEvent.click(screen.getByTestId('profile-tab-badges'));
    expect(screen.getByTestId('profile-badges-unknown').textContent).toBe('— of 22 earned');
    expect(screen.queryByTestId('badge-row-first_sighting')).toBeNull();
  });

  it('Spotters tab: no 0-point rows, "You" highlighted, and how far to the next spotter', () => {
    render(<ProfileScreen />);
    fireEvent.click(screen.getByTestId('profile-tab-spotters'));
    fireEvent.click(screen.getByTestId('spotters-period-all'));
    expect(screen.queryByTestId('leader-row-Z')).toBeNull();
    expect(screen.getByTestId('leader-row-me').textContent).toContain('You');
    const summary = screen.getByTestId('profile-rank-summary').textContent;
    expect(summary).toContain('You’re 3rd with 85 points');
    expect(summary).toContain('35 more points to pass vaporia_vee.');
  });

  it('Spotters tab: level on points says "level with", never "0 more points"', () => {
    h.leaderboard = [
      { spotterCode: 'B', username: 'vaporia_vee', points: 85, rank: 1, uniqueCatsDiscovered: 1 },
      { spotterCode: 'ME01', username: 'harbourcat', points: 85, rank: 2, uniqueCatsDiscovered: 2 },
    ];
    render(<ProfileScreen />);
    fireEvent.click(screen.getByTestId('profile-tab-spotters'));
    fireEvent.click(screen.getByTestId('spotters-period-all'));
    const summary = screen.getByTestId('profile-rank-summary').textContent;
    expect(summary).toContain('You’re level with vaporia_vee on 85 points.');
    expect(summary).not.toContain('0 more');
  });

  it('a failed profile load offers Try again', () => {
    h.profile = undefined;
    h.profileError = true;
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-stats-error').textContent).toContain('Couldn');
    fireEvent.click(screen.getByText('Try again'));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('rename note: Change it opens Settings with the name editor', () => {
    h.nameNote = { reason: 'taken', from: 'cat', to: 'cat-2' };
    render(<ProfileScreen />);
    fireEvent.click(screen.getByText(/Change/));
    expect(h.setNameNote).toHaveBeenCalledWith(null);
    expect(h.push).toHaveBeenCalledWith('/settings?editName=1');
  });

  it('goal reached but badge not given yet: "10 of 10", never "0 to go" (review #3)', () => {
    h.profile = profile({ catsSpotted: 10 });
    render(<ProfileScreen />);
    const next = screen.getByTestId('profile-next-badge').textContent;
    expect(next).toContain('10 of 10');
    expect(next).not.toContain('0 to go');
  });

  it('the rename note shows while the profile is still loading (review #8)', () => {
    h.profile = undefined;
    h.profileLoading = true;
    h.nameNote = { reason: 'taken', from: 'cat', to: 'cat-2' };
    render(<ProfileScreen />);
    expect(screen.getByTestId('name-note')).toBeTruthy();
  });

  it('"Not saved yet" only under a name held offline, not a loaded server name (review #9)', () => {
    h.username = null;
    h.heldUsername = 'held-name';
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-name').textContent).toBe('harbourcat');
    expect(screen.queryByText(/not saved yet/i)).toBeNull();
    cleanup();

    h.profile = undefined;
    h.isOnline = false;
    render(<ProfileScreen />);
    expect(screen.getByTestId('profile-name').textContent).toBe('held-name');
    expect(screen.getByText(/not saved yet/i)).toBeTruthy();
  });

  it('first but level on points: says "level with", not "top of the island"', () => {
    h.leaderboard = [
      { spotterCode: 'ME01', username: 'harbourcat', points: 85, rank: 1, uniqueCatsDiscovered: 2 },
      { spotterCode: 'B', username: 'vaporia_vee', points: 85, rank: 2, uniqueCatsDiscovered: 1 },
    ];
    render(<ProfileScreen />);
    fireEvent.click(screen.getByTestId('profile-tab-spotters'));
    fireEvent.click(screen.getByTestId('spotters-period-all'));
    const summary = screen.getByTestId('profile-rank-summary').textContent;
    expect(summary).toContain('You’re level with vaporia_vee on 85 points.');
    expect(summary).not.toContain('top of the island');
  });

  describe('weekly Spotters board (SYC-706)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    const openSpotters = () => {
      render(<ProfileScreen />);
      fireEvent.click(screen.getByTestId('profile-tab-spotters'));
    };

    it('opens on This week', () => {
      h.profile = profile({ weekPoints: 25 });
      openSpotters();
      expect(screen.getByTestId('spotters-period-week').getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId('leader-row-W1')).toBeTruthy();
      expect(screen.queryByTestId('leader-row-A')).toBeNull();
      const summary = screen.getByTestId('profile-rank-summary').textContent;
      expect(summary).toContain('You’re 2nd this week · 25 pts');
      expect(summary).toContain('30 more to pass weekly_wren.');
    });

    it('Greek week summary says "στη θέση" before the number', () => {
      h.lang = 'el';
      h.profile = profile({ weekPoints: 25 });
      openSpotters();
      expect(screen.getByTestId('profile-rank-summary').textContent).toContain(
        'Είσαι στη θέση 2 αυτή την εβδομάδα · 25 πόντοι',
      );
    });

    it('switching to All time shows the all-time rows', () => {
      openSpotters();
      fireEvent.click(screen.getByTestId('spotters-period-all'));
      expect(screen.getByTestId('leader-row-A')).toBeTruthy();
      expect(screen.queryByTestId('leader-row-W1')).toBeNull();
      expect(screen.queryByTestId('spotters-last-week')).toBeNull();
    });

    it('two people on equal points both show rank 1 and the next shows 3', () => {
      h.week = weekBoard({
        entries: [
          { spotterCode: 'P1', username: 'one', points: 50, rank: 1, uniqueCatsDiscovered: 0 },
          { spotterCode: 'P2', username: 'two', points: 50, rank: 1, uniqueCatsDiscovered: 0 },
          { spotterCode: 'P3', username: 'three', points: 20, rank: 3, uniqueCatsDiscovered: 0 },
        ],
      });
      openSpotters();
      const rank = (code: string) => screen.getByTestId(`leader-row-${code}`).textContent;
      expect(rank('P1')).toMatch(/^1one/);
      expect(rank('P2')).toMatch(/^1two/);
      expect(rank('P3')).toMatch(/^3three/);
    });

    it('empty week shows the friendly line and last week’s top three', () => {
      h.week = weekBoard({ entries: [] });
      openSpotters();
      expect(screen.getByTestId('spotters-week-empty').textContent).toBe(
        'A new week has started. Spot a cat to get on the board.',
      );
      expect(screen.getByTestId('spotters-last-week').textContent).toBe(
        '🏆 Last week: Marco, a spotter, Sophie',
      );
    });

    it('countdown says 3 days on Thursday evening and 5 hours on Sunday at 19:00 Athens', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-22T19:00:00+03:00'));
      openSpotters();
      expect(screen.getByTestId('spotters-countdown').textContent).toBe('New week in 3 days');
      cleanup();
      vi.setSystemTime(new Date('2026-10-25T19:00:00+02:00'));
      openSpotters();
      expect(screen.getByTestId('spotters-countdown').textContent).toBe('New week in 5 hours');
    });

    it('outside top 20 this week shows the outside summary', () => {
      h.profile = profile({ weekPoints: 5 });
      h.week = weekBoard({
        entries: [{ spotterCode: 'W1', username: 'weekly_wren', points: 55, rank: 1, uniqueCatsDiscovered: 0 }],
      });
      openSpotters();
      expect(screen.getByTestId('profile-rank-summary').textContent).toContain('You have 5 pts this week.');
    });

    it('offline shows the existing offline line on both tabs', () => {
      h.isOnline = false;
      h.week = undefined;
      h.leaderboard = undefined;
      openSpotters();
      expect(screen.getByTestId('profile-spotters-offline')).toBeTruthy();
      fireEvent.click(screen.getByTestId('spotters-period-all'));
      expect(screen.getByTestId('profile-spotters-offline')).toBeTruthy();
    });
  });
});
