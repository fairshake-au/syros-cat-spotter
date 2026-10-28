Result: B+C — move each part as its own full-size `Svg` layer inside an `Animated.View` (B), animated with Reanimated 4's CSS animations (C), because on the web only C kept moving while JavaScript was busy, it stops at its resting pose after a set number of loops with no JavaScript timer, and its props are plain data that are easy to test.

# SYC-772 Task 1 trial result: moving parts of the While we look pictures

Run on 27 Oct 2026 in the Expo web preview only (Expo 54, RN 0.81.5, new architecture on, react-native-svg 15.12.1, Reanimated 4.1.7, react-native-worklets 0.5.1). Headless Chromium, driven by Playwright. The trial route (`app/dev-trial-cats.tsx`) was deleted afterwards and not committed.

**iPhone and Android were not run.** This Mac has no Xcode and no Android SDK. Everything below about native is read from the installed package source and is **unverified on device**. Task 6 must check the first picture on an iPhone and an Android phone before porting the rest.

## The pivot recipe that worked

Each moving part is its own layer. The layer is an `Animated.View` filling the picture, `position: absolute`, holding an `Svg` with the **same viewBox** (`0 0 160 160`) as the whole drawing, so the part sits where it sits in the file. The picture box must be square, like the viewBox, so viewBox units and the layer's percentages line up.

- **Pivot:** `transformOrigin: '<px/160*100>% <py/160*100>%'` on the layer. Tail 108,124 → `'67.5% 77.5%'`. Eyes 80,56 → `'50% 35%'`. Measured in the browser: the tail layer's computed `transform-origin` was `135px 155px` on a 200px picture, which is exactly 108,124 scaled.
- **Turn, scale, skew:** plain RN transforms on the layer: `{ rotate: '8deg' }`, `{ scaleY: 0.1 }`, `{ skewX: '10deg' }`. The pivot comes from `transformOrigin`, so there's no translate–turn–translate sandwich.
- **Move:** `translateY` is in screen pixels, not viewBox units. Multiply by `size / 160` (2 units on a 200px picture = 2.5px).
- **Fade:** `opacity` on the layer.
- **Drawing order:** layers stack in the order they're written. A part behind the body (the tail) goes in a layer before the still body layer; parts in front (eyes, nose) go after it. The still parts can share one layer, or split into "behind" and "in front" layers if a moving part sits between them.

For approach A (animated `G` props), the recipe that drew correctly **on the web** was a `transform` prop on the `G`, either the string `translate(108 124) rotate(a) translate(-108 -124)` or a 6-number matrix array. A `matrix` prop did nothing on the web. On native it's the other way round (see below), so A needs a different prop per platform.

## What was measured on the web

Five panels showed the same cat: three versions of A, plus B and C. Each moved the tail (turn about 108,124), the eyes (blink about 80,56), the nose (move down), the left ear (skew about 57,46) and a dot (fade).

**Do the parts move, and stop at rest?** Computed transforms were read at 0.1, 0.7, 1.3, 2.5, 4.0, 5.5 and 6.5 s:

| Version | Moves correctly about the pivot | At rest by 5.5 s |
|---|---|---|
| A, `transform` string on `G` | yes | yes (angle 0) |
| A, `transform` 6-number array on `G` | yes (drawn as `matrix(...)`) | yes |
| A, `matrix` prop on `G` | **no**: set as a meaningless `matrix=` attribute, never drawn | n/a |
| B, layer + `useAnimatedStyle` | yes | yes |
| C, layer + CSS animation | yes | yes: all 5 browser animations had ended, transform `none` |

**While JavaScript is busy (3-second busy loop, as during a send).** A Chrome screen recording (CDP screencast, about 70 frames a second from the compositor) was compared frame by frame inside each panel. A requestAnimationFrame watcher confirmed the page's main thread was blocked for 3,000 ms.

| Version | Frames with motion, before | during the busy loop | after |
|---|---|---|---|
| A | 24 of 24 | **0 of 206 (frozen)** | 62 of 62 |
| B | 24 of 24 | **0 of 206 (frozen)** | 62 of 62 |
| C | 24 of 24 | **206 of 206 (kept moving)** | 62 of 62 |

A and B froze for the whole 3 s, then jumped to where the clock said they should be (one frame changed 7,500 pixels) and carried on. That's expected: on the web, Reanimated's own animations run on the page's one JavaScript thread. C became real browser CSS animations (`REA-CSS-*`), and the browser runs transform and opacity animations off the main thread.

**"Reduce motion" on** (Playwright `reducedMotion: 'reduce'`, page reloaded): `useReducedMotion()` returned `true`. All versions held their resting pose, with no browser animations running. Like the app's badge celebration, `useReducedMotion` reads the setting once at start-up; switching it while the page was open didn't change it.

**Ending without a timer (C).** `animationIterationCount` set to `floor(5000 / period)` (tail 2.4 s × 2 = 4.8 s, blink 4 s × 1, nose 1.6 s × 3) made each motion end at its last keyframe. With the first and last keyframes both at the resting pose, the picture settles at rest by 5 s. There's no `setTimeout` and no `cancelAnimation`. Reanimated 4.1.7's CSS animations don't check reduced motion themselves (there's nothing about it in `src/css`), so the component leaves out `animationName` when `useReducedMotion()` is true. That was tested above.

## Per-platform notes

**Web (run).** C is the only one that keeps moving during a send. A works only with `transform`, not `matrix`. B works but freezes with A.

**iPhone and Android (not run, unverified on device; read from source):**
- **A on native needs `matrix`, not `transform`.** The native `RNSVGGroup` takes its own transform as `matrix` (6 floats): `GroupNativeComponent.ts`, iOS `RNSVGFabricConversions.h` `setCommonNodeProps` (`nodeProps.matrix.size() == 6`), and Android `VirtualView.setMatrix`. The string `transform` is turned into `matrix` by `extractTransform` only in the `G` component's JavaScript `render`/`setNativeProps`. Reanimated 4's `useAnimatedProps` writes props on the UI thread and skips that step. So a `transform` string is unlikely to reach native in a usable form. (iOS also reads an RN-style `transform` array through `resolveTransform`, but with view-layout origin rules.) A therefore needs `matrix` on native and `transform` on the web, and each half can only be checked on its own platform. That's why it's the least certain choice.
- **Reanimated's CSS support for SVG doesn't cover `G`.** `src/css/svg/init.ts` registers Circle, Ellipse, Line, Path and Rect only, and passes `transform` through untouched ("TODO - add preprocessor"). So "CSS animation on an SVG part" isn't an option in 4.1.7. C has to sit on an `Animated.View`.
- **B and C on native** animate ordinary `View` transform and opacity. That's Reanimated's main, most used path. The native CSS style config (`src/css/native/style/config.ts`) lists `transform` and `transformOrigin`, and RN 0.81 supports `transformOrigin` percentages. On native, C runs in Reanimated's C++ on the UI thread and B runs worklets on the UI thread, so both should keep moving while JavaScript is busy. That is the documented behaviour, **unverified on device**.
- **Things to check on the device in Task 6:** skew with `transformOrigin` on Android; the blink's `scaleY` not blurring the eye outline (each layer is a separate native view, so it may be drawn as a bitmap); whether one picture with five full-size layers is light enough on a cheap Android phone.

## Why B+C over the others

| Criterion | A (`G` props) | B (layers + `useAnimatedStyle`) | C (layers + CSS animation) |
|---|---|---|---|
| Keeps moving on the web while JS is busy | no (measured) | no (measured) | **yes (measured)** |
| Confidence on native without a device | low: needs `matrix` on native and `transform` on web | high: the most used Reanimated path | medium-high: newer API, same View transforms |
| Stops at rest after about 5 s | yes, with `withRepeat(n)` | yes, with `withRepeat(n)` | **yes, with an iteration count; no timer, no cancel** |
| Cancels on unmount | `cancelAnimation` in cleanup | `cancelAnimation` in cleanup | automatic: the view goes, the animation goes |
| Holds still with "reduce motion" on | yes (`useReducedMotion`) | yes | yes (leave out `animationName`) |
| Testable in vitest/jsdom | needs a worklet and Reanimated mock; tests mock values, not motion | same | **plain props: check `animationName`, `animationIterationCount` and `transformOrigin` in the style** |

If a device check shows C misbehaving on one platform, fall back to B for that platform only. B uses the same layers and pivots, so only the driver changes. The helper below is written so that swap stays local.

## What changes for Task 6

The plan's `useLoop(periodMs, { stopAfterMs })` + `cancelAnimation` helper becomes a pure function that builds the style:

- `loopStyle(keyframes, periodMs, { stopAfterMs = 5000, reduced })` returns `{}` when `reduced`, and otherwise `{ animationName: keyframes, animationDuration: '<period>ms', animationIterationCount: max(1, floor(stopAfterMs / periodMs)), animationTimingFunction }`.
- No timer and no cleanup.
- Tests call it directly. Keyframes must start and end at the resting pose; a small test can check each picture's keyframes for that.

The walking cat's move along the bar is a one-off move, not a loop. It can use a CSS transition on the layer's `transform`, or Reanimated's `withTiming` (it runs once while the card appears, before the send gets busy). Task 6 decides that.

## Minimal code of the winning pattern

```tsx
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useReducedMotion } from 'react-native-reanimated';

const VB = 160;
const pct = (v: number) => `${(v / VB) * 100}%`;

/** Pure: a loop that ends at rest after the whole periods that fit in stopAfterMs. */
export function loopStyle(
  keyframes: Record<string, object>,
  periodMs: number,
  opts: { reduced: boolean; stopAfterMs?: number },
) {
  if (opts.reduced) return {};
  return {
    animationName: keyframes,
    animationDuration: `${periodMs}ms`,
    animationIterationCount: Math.max(1, Math.floor((opts.stopAfterMs ?? 5000) / periodMs)),
    animationTimingFunction: 'ease-in-out',
  };
}

// First and last keyframes are the resting pose.
const SWISH = {
  '0%': { transform: [{ rotate: '0deg' }] },
  '25%': { transform: [{ rotate: '-6deg' }] },
  '75%': { transform: [{ rotate: '8deg' }] },
  '100%': { transform: [{ rotate: '0deg' }] },
};

function Layer({ size, style, children }: { size: number; style?: object; children: React.ReactNode }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>{children}</Svg>
    </Animated.View>
  );
}

export function ReadingCat({ size = 120 }: { size?: number }) {
  const reduced = useReducedMotion();
  return (
    <View style={{ width: size, height: size }} aria-hidden accessible={false}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* tail: behind the body, turns about 108,124 */}
      <Layer size={size} style={[{ transformOrigin: `${pct(108)} ${pct(124)}` }, loopStyle(SWISH, 2400, { reduced })]}>
        <Path d="M104 128 Q132 128 132 96 Q132 70 120 56 Q114 50 112 58 Q122 74 122 96 Q122 116 104 116 Z" fill="#e38b3a" stroke="#3b3934" strokeWidth={2} />
      </Layer>
      <Layer size={size}>{/* still body and head */}</Layer>
      {/* eyes: in front, blink about 80,56 with scaleY keyframes, period 4000 */}
    </View>
  );
}
```

## Update, 28 Oct 2026: iPhone simulator run

After Xcode was installed, the finished pictures were run in the **iOS simulator**: an iPhone 17e on iOS 27.1, in Expo Go 54.0.7, with the new architecture. The iPhone SE simulator won't run on the iOS 27 runtimes that come with this Xcode ("Incompatible device"), so the 17e (390 × 844 points) was the smallest phone available. This tested the built components, not the throwaway trial screen.

| Check | iPhone result |
|---|---|
| All eight pictures draw as in their SVG files | **pass** |
| The parts move about the right points (tail, blink, nod, heart, ripple, pulse, magnifier, legs, breathing, "z") | **pass**: frames caught mid-motion matched the drawings' motions |
| Motion stops | **pass**: screenshot hashes changed every 0.4 s until 5.1 s and were identical from 6.5 s to 16.4 s |
| The walk along the bar | **pass**: it starts at 2 of 11 and ends with the paws at 3 of 11 |
| "Reduce motion" on (simulator accessibility setting, app relaunched) | **pass**: identical frames from the first one, and the cat placed straight at 3 of 11 |
| Dark mode | **pass**: the plates keep the topic cats visible, and the grey walking and sleeping cats show on the dark card |

**Not run on the iPhone:** the 3-second busy-JavaScript stress from the trial, and VoiceOver. **Android was not run** (no Android SDK on this Mac). Both stay on SYC-776, which blocks the merge.
