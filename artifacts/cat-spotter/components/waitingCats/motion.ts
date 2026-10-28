/**
 * SYC-772 (spec §3.4): how the "While we look" pictures move.
 *
 * Each moving part is its own layer, turned about a pivot with
 * `transformOrigin` and moved by a Reanimated 4 CSS animation. The Task 1
 * trial (docs/superpowers/plans/2026-10-27-while-we-look-trial-result.md)
 * measured that only CSS animations keep moving on the web while JavaScript
 * is busy with a send.
 *
 * A loop stops by its iteration count, so there is no timer to clear and
 * nothing to cancel: the animation ends on its own, and goes with the view
 * when the card leaves. Every keyframes object starts and ends at the resting
 * pose, so the picture settles at rest when the loops end.
 */
import type { ViewStyle } from 'react-native';

/** Motion stops this long after the picture appears (spec §3.4). */
export const STOP_AFTER_MS = 5000;

export type Frame = {
  transform?: Array<Record<string, number | string>>;
  opacity?: number;
};
export type Keyframes = Record<string, Frame>;

export type ViewBox = { x: number; y: number; w: number; h: number };

/** `transformOrigin` for a pivot given in viewBox units, as percentages of the layer. */
export function pivotOrigin(px: number, py: number, vb: ViewBox): string {
  const pct = (v: number) => `${parseFloat(v.toFixed(3))}%`;
  return `${pct(((px - vb.x) / vb.w) * 100)} ${pct(((py - vb.y) / vb.h) * 100)}`;
}

/**
 * The style that loops `keyframes` every `periodMs` for the whole periods
 * that fit in `stopAfterMs`, then stops at the last frame (the resting pose).
 * Empty under "reduce motion": the picture stays still.
 */
export function loopStyle(
  keyframes: Keyframes,
  periodMs: number,
  opts: { reduced: boolean; stopAfterMs?: number },
): ViewStyle {
  if (opts.reduced) return {};
  return {
    animationName: keyframes,
    animationDuration: `${periodMs}ms`,
    animationIterationCount: Math.max(1, Math.floor((opts.stopAfterMs ?? STOP_AFTER_MS) / periodMs)),
    animationTimingFunction: 'ease-in-out',
  } as ViewStyle;
}
