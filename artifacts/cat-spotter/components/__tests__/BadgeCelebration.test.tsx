// @vitest-environment jsdom
/**
 * SYC-706: the full-screen badge celebration. Steps through several badges,
 * one screen for the history, the week line, the quiet replay, the sound
 * setting and reduced motion.
 */
import React from 'react';
import { Platform } from 'react-native';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  soundsOn: true,
  hydrated: true,
  reduced: false,
  push: vi.fn(),
  play: vi.fn(),
  remove: vi.fn(),
  createAudioPlayer: vi.fn(),
  notificationAsync: vi.fn(),
}));

vi.mock('expo-router', () => ({ router: { push: h.push } }));
vi.mock('expo-audio', () => ({ createAudioPlayer: h.createAudioPlayer }));
vi.mock('expo-haptics', () => ({
  notificationAsync: h.notificationAsync,
  NotificationFeedbackType: { Success: 'success' },
}));
vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => h.reduced }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('react-native-svg', () => {
  const React = require('react');
  const make = (name: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('span', { 'data-el': name }, children);
  const names = ['RadialGradient', 'Stop', 'Rect', 'Defs'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
});
vi.mock('@/context/CelebrationSettingsContext', () => ({
  useCelebrationSettings: () => ({ soundsOn: h.soundsOn, isHydrated: h.hydrated, setSoundsOn: vi.fn() }),
}));
vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS } = await import('@/lib/i18n');
  return {
    useLanguage: () => ({ t: (k: string) => TRANSLATIONS.en[k] ?? k, language: 'en' }),
  };
});

import { BadgeCelebration } from '@/components/celebration/BadgeCelebration';
import type { BadgeView } from '@/lib/badgeProgress';

const view = (id: string, group: string, extra: Partial<BadgeView> = {}): BadgeView => ({
  id,
  group,
  earned: true,
  isNew: true,
  value: null,
  goal: null,
  ...extra,
});

const views: BadgeView[] = [
  view('areas_3', 'areas', { value: 3, goal: 3 }),
  view('areas_8', 'areas', { earned: false, isNew: false, value: 3, goal: 8 }),
  view('areas_all', 'areas', { earned: false, isNew: false, value: 3, goal: 12 }),
  view('podium', 'weekly'),
];

describe('BadgeCelebration', () => {
  beforeEach(() => {
    h.soundsOn = true;
    h.hydrated = true;
    h.reduced = false;
    h.createAudioPlayer.mockReset().mockReturnValue({ play: h.play, remove: h.remove });
    h.play.mockReset();
    h.remove.mockReset();
    h.notificationAsync.mockReset().mockResolvedValue(undefined);
    h.push.mockReset();
    // Tests run on react-native-web; the buzz is native only, so act as a phone.
    (Platform as { OS: string }).OS = 'ios';
  });
  afterEach(() => {
    cleanup();
    (Platform as { OS: string }).OS = 'web';
  });

  it('steps through two badges with 1 of 2 then 2 of 2 then calls onDone', () => {
    const onDone = vi.fn();
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3', 'podium'] }} views={views} onDone={onDone} />);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('Explorer')).toBeTruthy();
    expect(screen.getByText('Next: Roamer 🗺️', { exact: false })).toBeTruthy();
    expect(screen.getByText('3 of 8')).toBeTruthy();
    fireEvent.click(screen.getByText('Lovely!'));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText('2 of 2')).toBeTruthy();
    fireEvent.click(screen.getByText('Lovely!'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows the group-done line when there is no next badge', () => {
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['podium'] }} views={views} onDone={vi.fn()} />);
    expect(screen.getByTestId('celebration-group-done')).toBeTruthy();
  });

  it('history moment with one badge says 1 new badge, not 1 new badges', () => {
    render(<BadgeCelebration moment={{ kind: 'history', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(screen.getByText('Your spots so far have earned you 1 new badge')).toBeTruthy();
  });

  it('history moment shows one screen with all medals', () => {
    const onDone = vi.fn();
    render(<BadgeCelebration moment={{ kind: 'history', badgeIds: ['areas_3', 'podium'] }} views={views} onDone={onDone} />);
    expect(screen.getByText('Your spots so far have earned you 2 new badges')).toBeTruthy();
    expect(screen.getByText('Explorer')).toBeTruthy();
    expect(screen.queryByText(/ of 2$/)).toBeNull();
    fireEvent.click(screen.getByText('Lovely!'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('week moment shows the place line', () => {
    render(
      <BadgeCelebration
        moment={{ kind: 'week_result', badgeIds: ['podium'], place: 2, weekPoints: 140 }}
        views={views}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByTestId('celebration-week-line').textContent).toBe('You came 2nd last week with 140 points');
  });

  it('week moment with no badge ids falls back to the podium or champion medal', () => {
    const { unmount } = render(
      <BadgeCelebration
        moment={{ kind: 'week_result', badgeIds: [], place: 3, weekPoints: 90 }}
        views={views}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText('Podium')).toBeTruthy();
    unmount();
    render(
      <BadgeCelebration
        moment={{ kind: 'week_result', badgeIds: [], place: 1, weekPoints: 200 }}
        views={views}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText('Champion of the week')).toBeTruthy();
  });

  it('week moment eyebrow says top three last week, not New badge', () => {
    render(
      <BadgeCelebration
        moment={{ kind: 'week_result', badgeIds: ['podium'], place: 2, weekPoints: 140 }}
        views={views}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText('Top three last week')).toBeTruthy();
    expect(screen.queryByText('New badge')).toBeNull();
  });

  it('see all my badges opens the Badges tab and closes', () => {
    const onDone = vi.fn();
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={onDone} />);
    fireEvent.click(screen.getByText('See all my badges'));
    expect(h.push).toHaveBeenCalledWith({ pathname: '/profile', params: { tab: 'badges' } });
    expect(onDone).toHaveBeenCalled();
  });

  it('plays the chime and the buzz, with confetti', () => {
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.notificationAsync).toHaveBeenCalledWith('success');
    expect(screen.getByTestId('confetti')).toBeTruthy();
  });

  it('quiet replay never plays sound or buzz', () => {
    render(<BadgeCelebration quiet moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(h.createAudioPlayer).not.toHaveBeenCalled();
    expect(h.notificationAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confetti')).toBeNull();
  });

  it('sound off setting plays no sound but still buzzes', () => {
    h.soundsOn = false;
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(h.createAudioPlayer).not.toHaveBeenCalled();
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('web gets the chime attempt but no buzz', () => {
    (Platform as { OS: string }).OS = 'web';
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.notificationAsync).not.toHaveBeenCalled();
  });

  it('no chime until the sound setting has loaded, but the buzz still fires', () => {
    h.hydrated = false;
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(h.createAudioPlayer).not.toHaveBeenCalled();
    expect(h.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('releases the audio player on unmount, and after 3 s if still mounted', () => {
    vi.useFakeTimers();
    try {
      const first = render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
      expect(h.remove).not.toHaveBeenCalled();
      first.unmount();
      expect(h.remove).toHaveBeenCalledTimes(1);
      h.remove.mockClear();
      render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
      vi.advanceTimersByTime(3000);
      expect(h.remove).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a sound that fails to play does not break the screen', () => {
    h.createAudioPlayer.mockImplementation(() => {
      throw new Error('NotAllowedError');
    });
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(screen.getByText('Explorer')).toBeTruthy();
  });

  it('reduced motion renders no confetti or shine', () => {
    h.reduced = true;
    render(<BadgeCelebration moment={{ kind: 'badges', badgeIds: ['areas_3'] }} views={views} onDone={vi.fn()} />);
    expect(screen.queryByTestId('confetti')).toBeNull();
    expect(screen.queryByTestId('celebration-shine')).toBeNull();
    expect(screen.getByText('Explorer')).toBeTruthy();
  });
});
