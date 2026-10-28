/**
 * SYC-772: shared mocks for the "While we look" picture tests (and the waiting
 * card tests that follow). Use in a test file as:
 *
 *   vi.mock('react-native-svg', async () => (await import('./helpers/waitingCatsMocks')).svgMock());
 *   vi.mock('react-native-reanimated', async () => (await import('./helpers/waitingCatsMocks')).reanimatedMock());
 *
 * Set `motion.reduced` to drive `useReducedMotion`. The Animated.View mock
 * renders a div that exposes its flattened style as JSON in `data-style`, so
 * a test can read `animationName`, `transformOrigin` and so on; `readStyle`
 * parses it.
 */
import React from 'react';
import { vi } from 'vitest';

export const motion = { reduced: false };

function flatten(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style as Record<string, unknown>;
}

export function readStyle(el: Element): Record<string, any> {
  return JSON.parse(el.getAttribute('data-style') ?? '{}');
}

export function svgMock() {
  const make =
    (name: string) =>
    ({ testID, children, ...rest }: { testID?: string; children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(
        'span',
        { 'data-el': name, 'data-testid': testID, 'aria-hidden': rest['aria-hidden'] },
        children,
      );
  const names = ['G', 'Path', 'Ellipse', 'Circle', 'Rect', 'Polygon', 'Line'];
  return { __esModule: true, default: make('Svg'), ...Object.fromEntries(names.map((n) => [n, make(n)])) };
}

/** Spies Task 7 can assert on; reset them in a beforeEach. */
export const spies = {
  withTiming: vi.fn((to: unknown) => to),
  withRepeat: vi.fn((v: unknown) => v),
  withSequence: vi.fn((...v: unknown[]) => v[v.length - 1]),
  withDelay: vi.fn((_d: number, v: unknown) => v),
  cancelAnimation: vi.fn(),
  inOut: vi.fn((f: unknown) => f),
};

export function reanimatedMock() {
  const AnimatedView = ({
    style,
    testID,
    children,
  }: {
    style?: unknown;
    testID?: string;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': testID, 'data-style': JSON.stringify(flatten(style)) },
      children,
    );
  const Animated = { createAnimatedComponent: (C: unknown) => C, View: AnimatedView };
  return {
    __esModule: true,
    default: Animated,
    View: AnimatedView,
    useReducedMotion: () => motion.reduced,
    useSharedValue: (v: unknown) => ({ value: v }),
    withTiming: spies.withTiming,
    withRepeat: spies.withRepeat,
    withSequence: spies.withSequence,
    withDelay: spies.withDelay,
    cancelAnimation: spies.cancelAnimation,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedProps: (fn: () => unknown) => fn(),
    Easing: {
      inOut: spies.inOut,
      ease: vi.fn((t: unknown) => t),
      linear: vi.fn((t: unknown) => t),
      out: vi.fn((f: unknown) => f),
    },
  };
}
