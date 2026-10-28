/**
 * SYC-772 (spec §3.4): the keyframes for every moving part, from each
 * drawing's "Moving parts" comment. Distances in the drawings are viewBox
 * units, so each is scaled to points (`k` = points per viewBox unit). Every
 * set starts and ends at the resting pose, which is how the drawing looks
 * with no animation: no turn, scale 1, no shift, full opacity.
 */
import type { Frame, Keyframes } from './motion';

const turn = (deg: number) => ({ transform: [{ rotate: `${deg}deg` }] });
const skew = (deg: number) => ({ transform: [{ skewX: `${deg}deg` }] });
const grow = (s: number) => ({ transform: [{ scale: s }] });
const blinkY = (s: number) => ({ transform: [{ scaleY: s }] });

/** A gentle there-and-back turn: rest, `a`, `b`, rest. */
const swing = (a: number, b: number): Keyframes => ({
  '0%': turn(0),
  '25%': turn(a),
  '75%': turn(b),
  '100%': turn(0),
});

/** Open eyes, one quick blink near the end of the period. */
const BLINK: Keyframes = {
  '0%': blinkY(1),
  '93%': blinkY(1),
  '95%': blinkY(0.1),
  '97%': blinkY(1),
  '100%': blinkY(1),
};

/**
 * A part that fades in at `from`, drifts to `to` while it fades out, then
 * fades back in on its resting spot (the heart, the "z").
 */
function drift(from: { x: number; y: number }, to: { x: number; y: number }, k: number): Keyframes {
  const at = (p: { x: number; y: number }, opacity: number): Frame => ({
    transform: [{ translateX: p.x * k }, { translateY: p.y * k }],
    opacity,
  });
  return {
    '0%': at({ x: 0, y: 0 }, 1),
    '10%': at(from, 0),
    '30%': at({ x: (from.x + to.x) / 3, y: (from.y + to.y) / 3 }, 1),
    '80%': at(to, 0),
    '81%': at(from, 0),
    '100%': at({ x: 0, y: 0 }, 1),
  };
}

const cache = new Map<string, Keyframes>();
function memo(key: string, k: number, build: () => Keyframes): Keyframes {
  const id = `${key}@${k}`;
  let kf = cache.get(id);
  if (!kf) {
    kf = build();
    cache.set(id, kf);
  }
  return kf;
}

/** A named set of keyframes, its period and the picture it belongs to. */
export type MotionSpec = { keyframes: (k: number) => Keyframes; periodMs: number };

export const MOTIONS = {
  /** topic 1 tail: -6..8deg, 2.4s */
  readingTail: { periodMs: 2400, keyframes: (k) => memo('readingTail', k, () => swing(-6, 8)) },
  /** blink every 4s (topics 1 and 3) */
  blink: { periodMs: 4000, keyframes: (k) => memo('blink', k, () => BLINK) },
  /** topic 2: the mother and kitten nod, translateY 0..-3, 2.8s, half a cycle apart */
  motherNod: {
    periodMs: 2800,
    keyframes: (k) =>
      memo('motherNod', k, () => ({
        '0%': { transform: [{ translateY: 0 }] },
        '50%': { transform: [{ translateY: -3 * k }] },
        '100%': { transform: [{ translateY: 0 }] },
      })),
  },
  kittenNod: {
    periodMs: 2800,
    keyframes: (k) =>
      memo('kittenNod', k, () => ({
        '0%': { transform: [{ translateY: 0 }] },
        '50%': { transform: [{ translateY: 0 }] },
        '75%': { transform: [{ translateY: -3 * k }] },
        '100%': { transform: [{ translateY: 0 }] },
      })),
  },
  /** topic 3 heart: translateY 8..-18, opacity 0..1..0, 3s */
  heart: { periodMs: 3000, keyframes: (k) => memo('heart', k, () => drift({ x: 0, y: 8 }, { x: 0, y: -18 }, k)) },
  /** topic 4 tail: -4..5deg, 3.2s */
  colonyTail: { periodMs: 3200, keyframes: (k) => memo('colonyTail', k, () => swing(-4, 5)) },
  /** topic 4 ripple: scale 0.4..1.2, opacity 0.9..0, 2s */
  ripple: {
    periodMs: 2000,
    keyframes: (k) =>
      memo('ripple', k, () => ({
        '0%': { transform: [{ scale: 1 }], opacity: 1 },
        '6%': { transform: [{ scale: 0.4 }], opacity: 0.9 },
        '90%': { transform: [{ scale: 1.2 }], opacity: 0 },
        '91%': { transform: [{ scale: 0.4 }], opacity: 0 },
        '100%': { transform: [{ scale: 1 }], opacity: 1 },
      })),
  },
  /** topic 5 aid: scale 1..1.12, 1.8s */
  aidPulse: {
    periodMs: 1800,
    keyframes: (k) => memo('aidPulse', k, () => ({ '0%': grow(1), '50%': grow(1.12), '100%': grow(1) })),
  },
  /** topic 5 left ear: a twitch 0..-10deg every 3s */
  earTwitch: {
    periodMs: 3000,
    keyframes: (k) =>
      memo('earTwitch', k, () => ({
        '0%': turn(0),
        '88%': turn(0),
        '92%': turn(-10),
        '96%': turn(0),
        '100%': turn(0),
      })),
  },
  /** topic 6 lens: translateX -6..8, 3s */
  lensScan: {
    periodMs: 3000,
    keyframes: (k) =>
      memo('lensScan', k, () => ({
        '0%': { transform: [{ translateX: 0 }] },
        '20%': { transform: [{ translateX: -6 * k }] },
        '70%': { transform: [{ translateX: 8 * k }] },
        '100%': { transform: [{ translateX: 0 }] },
      })),
  },
  /** walking cat legs: skewX -14..14deg, one step cycle 1s, in opposite phase */
  legsA: {
    periodMs: 1000,
    keyframes: (k) => memo('legsA', k, () => ({ '0%': skew(0), '25%': skew(-14), '75%': skew(14), '100%': skew(0) })),
  },
  legsB: {
    periodMs: 1000,
    keyframes: (k) => memo('legsB', k, () => ({ '0%': skew(0), '25%': skew(14), '75%': skew(-14), '100%': skew(0) })),
  },
  /** walking cat bob: translateY 0..-1, 0.25s each way */
  walkBob: {
    periodMs: 500,
    keyframes: (k) =>
      memo('walkBob', k, () => ({
        '0%': { transform: [{ translateY: 0 }] },
        '50%': { transform: [{ translateY: -1 * k }] },
        '100%': { transform: [{ translateY: 0 }] },
      })),
  },
  /** sleeping cat breath: scaleY 1..1.05, 3s */
  breathe: {
    periodMs: 3000,
    keyframes: (k) => memo('breathe', k, () => ({ '0%': blinkY(1), '50%': blinkY(1.05), '100%': blinkY(1) })),
  },
  /** sleeping cat z: translate 0,4..4,-6, opacity 0..1..0, 3s */
  zDrift: { periodMs: 3000, keyframes: (k) => memo('zDrift', k, () => drift({ x: 0, y: 4 }, { x: 4, y: -6 }, k)) },
} satisfies Record<string, MotionSpec>;
