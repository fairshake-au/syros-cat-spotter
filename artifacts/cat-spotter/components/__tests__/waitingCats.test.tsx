// @vitest-environment jsdom
/**
 * SYC-772 (spec §3.4): the eight animated cat pictures. They are decoration,
 * hidden from screen readers; they hold still under "reduce motion"; and all
 * motion ends within 5 seconds on its own (a CSS-animation iteration count, no
 * timer) at the resting pose.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-svg', async () => (await import('./helpers/waitingCatsMocks')).svgMock());
vi.mock('react-native-reanimated', async () => (await import('./helpers/waitingCatsMocks')).reanimatedMock());

import { motion, readStyle } from './helpers/waitingCatsMocks';
import { TopicCat } from '@/components/waitingCats/TopicCat';
import { WalkingCat, WALKING_CAT_ASPECT } from '@/components/waitingCats/WalkingCat';
import { SleepingCat, SLEEPING_CAT_ASPECT } from '@/components/waitingCats/SleepingCat';
import { MOTIONS } from '@/components/waitingCats/keyframes';
import { loopStyle, pivotOrigin, STOP_AFTER_MS } from '@/components/waitingCats/motion';

const STRANDS = [1, 2, 3, 4, 5, 6] as const;
const pictures: Array<[string, string, () => React.ReactElement]> = [
  ...STRANDS.map((s): [string, string, () => React.ReactElement] => [
    `topic ${s}`,
    `topic-cat-${s}`,
    () => <TopicCat strand={s} />,
  ]),
  ['walking cat', 'walking-cat', () => <WalkingCat />],
  ['sleeping cat', 'sleeping-cat', () => <SleepingCat />],
];

/** Every layer element of a rendered picture, with its parsed style. */
const layers = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[data-style]")).map((el) => ({ el, style: readStyle(el) }));

beforeEach(() => {
  motion.reduced = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('loopStyle', () => {
  const kf = { '0%': { opacity: 1 }, '100%': { opacity: 1 } };
  it('is empty under reduced motion', () => {
    expect(loopStyle(kf, 2400, { reduced: true })).toEqual({});
  });
  it('fits whole periods into 5 s: 2400 ms loops twice', () => {
    const s = loopStyle(kf, 2400, { reduced: false });
    expect(s).toMatchObject({ animationName: kf, animationDuration: '2400ms', animationIterationCount: 2 });
  });
  it('still plays one period when it is longer than 5 s', () => {
    expect(loopStyle(kf, 7000, { reduced: false })).toMatchObject({ animationIterationCount: 1 });
  });
  it('can stop sooner', () => {
    expect(loopStyle(kf, 1000, { reduced: false, stopAfterMs: 2500 })).toMatchObject({
      animationIterationCount: 2,
    });
  });
});

describe('pivotOrigin', () => {
  it('turns viewBox units into percentages of the layer', () => {
    expect(pivotOrigin(108, 124, { x: 0, y: 0, w: 160, h: 160 })).toBe('67.5% 77.5%');
  });
  it('allows for the walking cat viewBox origin offset', () => {
    expect(pivotOrigin(24, 24, { x: 0, y: -3, w: 48, h: 35 })).toBe('50% 77.143%');
  });
});

describe('keyframes', () => {
  const REST_TRANSFORM = new Set(['rotate:0deg', 'skewX:0deg', 'scale:1', 'scaleY:1', 'translateX:0', 'translateY:0']);
  for (const [name, spec] of Object.entries(MOTIONS)) {
    it(`${name} starts and ends at the resting pose`, () => {
      // 40 points square: translations scale with size, rest is still 0
      const kf = spec.keyframes(40 / 160);
      expect(kf['0%']).toEqual(kf['100%']);
      for (const t of kf['0%'].transform ?? []) {
        const [key, value] = Object.entries(t)[0];
        expect(REST_TRANSFORM.has(`${key}:${value}`), `${key}:${value}`).toBe(true);
      }
      if (kf['0%'].opacity !== undefined) expect(kf['0%'].opacity).toBe(1);
    });
  }

  it('scales distances from viewBox units to points', () => {
    const kf = MOTIONS.motherNod.keyframes(0.5);
    expect(kf['50%'].transform).toEqual([{ translateY: -1.5 }]);
  });
});

describe.each(pictures)('%s', (_label, testId, ui) => {
  it('is hidden from screen readers', () => {
    render(ui());
    const root = screen.getByTestId(testId);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    // react-native-web drops the native-only props; the outer View still gets accessible={false}
    expect(root.getAttribute('tabindex')).toBeNull();
  });

  it('holds still under reduced motion', () => {
    motion.reduced = true;
    const { container } = render(ui());
    const all = layers(container);
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) expect(l.style.animationName).toBeUndefined();
  });

  it('ends all its motion within 5 seconds', () => {
    const { container } = render(ui());
    const moving = layers(container).filter((l) => l.style.animationName);
    expect(moving.length).toBeGreaterThan(0);
    for (const { style } of moving) {
      const total = style.animationIterationCount * parseFloat(style.animationDuration);
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(STOP_AFTER_MS);
    }
  });

  it('leaves no pending timers when it leaves early', () => {
    vi.useFakeTimers();
    const { unmount } = render(ui());
    vi.advanceTimersByTime(2000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TopicCat', () => {
  it.each(STRANDS)('draws a distinct picture for strand %i on a light rounded plate', (s) => {
    render(<TopicCat strand={s} size={48} />);
    const root = screen.getByTestId(`topic-cat-${s}`);
    expect(root.getAttribute('data-testid')).toBe(`topic-cat-${s}`);
    const style = getComputedStyle(root);
    expect(style.backgroundColor).toBe('rgb(251, 250, 246)');
    expect(parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0);
    expect(root.style.width).toBe('48px');
  });

  it('defaults to 48 points', () => {
    render(<TopicCat strand={1} />);
    expect(screen.getByTestId('topic-cat-1').style.width).toBe('48px');
  });

  it('turns the reading cat tail about 108,124 and blinks its eyes about 80,56', () => {
    render(<TopicCat strand={1} />);
    expect(readStyle(screen.getByTestId('layer-tail')).transformOrigin).toBe('67.5% 77.5%');
    expect(readStyle(screen.getByTestId('layer-eyes')).transformOrigin).toBe('50% 35%');
  });
});

describe('WalkingCat and SleepingCat', () => {
  it('size from their aspect ratios', () => {
    expect(WALKING_CAT_ASPECT).toBeCloseTo(48 / 35);
    expect(SLEEPING_CAT_ASPECT).toBeCloseTo(48 / 32);
    render(<WalkingCat height={35} />);
    expect(screen.getByTestId('walking-cat').style.width).toBe('48px');
    cleanup();
    render(<SleepingCat height={32} />);
    expect(screen.getByTestId('sleeping-cat').style.width).toBe('48px');
  });

  it('defaults to 24 points tall', () => {
    render(<WalkingCat />);
    expect(screen.getByTestId('walking-cat').style.height).toBe('24px');
  });

  it('moves the legs in opposite phase about 24,24', () => {
    render(<WalkingCat />);
    const a = readStyle(screen.getByTestId('layer-legs-a'));
    const b = readStyle(screen.getByTestId('layer-legs-b'));
    expect(a.transformOrigin).toBe('50% 77.143%');
    expect(a.animationName['25%']).toEqual({ transform: [{ skewX: '-14deg' }] });
    expect(b.animationName['25%']).toEqual({ transform: [{ skewX: '14deg' }] });
  });
});
