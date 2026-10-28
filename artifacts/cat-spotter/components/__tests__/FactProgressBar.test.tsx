// @vitest-environment jsdom
/**
 * SYC-772 (spec §3.1, §3.4, §5.1): FactProgressBar is ProgressBar plus a small
 * cat that walks from the previous fact's place to this one's, or sleeps at the
 * end when every fact has been seen.
 */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', async () => (await import('./helpers/waitingCatsMocks')).svgMock());
vi.mock('react-native-reanimated', async () => (await import('./helpers/waitingCatsMocks')).reanimatedMock());
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ primary: '#123456', accent: '#654321', muted: '#eeeeee', mutedForeground: '#666666' }),
}));

import { FactProgressBar } from '@/components/FactProgressBar';
import { WALKING_CAT_ASPECT } from '@/components/waitingCats/WalkingCat';
import { SLEEPING_CAT_ASPECT } from '@/components/waitingCats/SleepingCat';
import { catPosition } from '@/lib/catPosition';
import { hidesFromNativeReaders, motion, readStyle, spies } from './helpers/waitingCatsMocks';

const STRINGS: Record<string, string> = {
  factProgress: 'Cat fact {n} of {total}',
  factProgressDone: 'All {total} cat facts seen',
};
const t = (key: string) => STRINGS[key] ?? key;

const WALK_W = 24 * WALKING_CAT_ASPECT;
const SLEEP_W = 24 * SLEEPING_CAT_ASPECT;

/** The fill's width as a percentage of the track (react-native-web drops accessibilityValue.now). */
function fillPct() {
  return (screen.getByRole('progressbar').firstElementChild as HTMLElement).style.width;
}

/** jsdom has no layout; react-native-web hands onLayout to a node property. */
function layOut(width: number) {
  const node = screen.getByTestId('fact-progress') as any;
  act(() => {
    node.__reactLayoutHandler({ nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } });
  });
}

const count = { kind: 'count', n: 3, total: 11, walkFrom: 2 } as const;

describe('FactProgressBar', () => {
  beforeEach(() => {
    motion.reduced = false;
    Object.values(spies).forEach((s) => s.mockClear());
  });
  afterEach(cleanup);

  it('shows "Cat fact 3 of 11" and the bar carries the same words', () => {
    render(<FactProgressBar progress={count} t={t} />);
    expect(screen.getByText('Cat fact 3 of 11')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('Cat fact 3 of 11');
  });

  it('hides the visible words from screen readers', () => {
    render(<FactProgressBar progress={count} t={t} />);
    expect(screen.getByText('Cat fact 3 of 11').closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('also hides the visible words from native readers (Android would read them twice)', () => {
    render(<FactProgressBar progress={count} t={t} />);
    expect(hidesFromNativeReaders(screen.getByText('Cat fact 3 of 11'))).toBe(true);
  });

  it('shows the done words and a sleeping cat, no walking cat', () => {
    render(<FactProgressBar progress={{ kind: 'done', total: 11 }} t={t} />);
    layOut(330);
    expect(screen.getByText('All 11 cat facts seen')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toBe('All 11 cat facts seen');
    expect(screen.getByTestId('sleeping-cat')).toBeTruthy();
    expect(screen.queryByTestId('walking-cat')).toBeNull();
    expect(spies.withTiming).not.toHaveBeenCalled();
  });

  it('places the sleeping cat at the end of the bar', () => {
    render(<FactProgressBar progress={{ kind: 'done', total: 11 }} t={t} />);
    layOut(330);
    const holder = screen.getByTestId('sleeping-cat-holder') as HTMLElement;
    expect(holder.style.left).toBe(`${catPosition(11, 11, 330, SLEEP_W)}px`);
  });

  it('starts the bar at the walk start before layout, then at n', () => {
    render(<FactProgressBar progress={count} t={t} />);
    expect(fillPct()).toBe(`${(2 / 11) * 100}%`);
    expect(screen.queryByTestId('walking-cat')).toBeNull();
    layOut(330);
    expect(fillPct()).toBe(`${(3 / 11) * 100}%`);
  });

  it('walks the cat and shrinks the cover over 1000 ms after layout', () => {
    render(<FactProgressBar progress={count} t={t} />);
    layOut(330);
    const targets = (spies.withTiming.mock.calls as unknown[][]).map((c) => [c[0], (c[1] as any).duration]);
    expect(targets).toContainEqual([catPosition(3, 11, 330, WALK_W), 1000]);
    expect(targets).toContainEqual([0, 1000]);
    expect(screen.getByTestId('walking-cat')).toBeTruthy();
    const holder = screen.getByTestId('walking-cat-holder');
    expect(readStyle(holder).left).toBe(catPosition(2, 11, 330, WALK_W));
    const cover = screen.getByTestId('fact-progress-cover');
    expect(readStyle(cover).width).toBe((330 * 1) / 11);
  });

  it('with reduced motion, has no cover and puts the cat straight at n', () => {
    motion.reduced = true;
    render(<FactProgressBar progress={count} t={t} />);
    layOut(330);
    expect(spies.withTiming).not.toHaveBeenCalled();
    expect(screen.queryByTestId('fact-progress-cover')).toBeNull();
    expect(readStyle(screen.getByTestId('walking-cat-holder')).left).toBe(catPosition(3, 11, 330, WALK_W));
  });

  it('cancels the walk when unmounted mid-walk', () => {
    const { unmount } = render(<FactProgressBar progress={count} t={t} />);
    layOut(330);
    spies.cancelAnimation.mockClear();
    unmount();
    expect(spies.cancelAnimation).toHaveBeenCalledTimes(2);
  });
});
