/**
 * SYC-772 (spec §3.1, §3.4, §5.1): the app's ProgressBar with a small cat
 * standing on it. On a new fact the fill and the cat move together, from the
 * previous fact's place to this one's, in about a second; once every fact has
 * been seen a cat sleeps at the end instead. "Cat fact 3 of 11" sits under the
 * bar and is also the bar's spoken text, so the visible words are hidden from
 * screen readers.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { catPosition } from '@/lib/catPosition';
import type { FactProgress } from '@/lib/waitingCard';
import { ProgressBar } from '@/components/purropolis/ProgressBar';
import { WalkingCat, WALKING_CAT_ASPECT } from '@/components/waitingCats/WalkingCat';
import { SleepingCat, SLEEPING_CAT_ASPECT } from '@/components/waitingCats/SleepingCat';

const CAT_HEIGHT = 24;
const BAR_HEIGHT = 10; // ProgressBar's track
/** The picture has a little empty margin under the feet; sink the cat so they meet the bar. */
const CAT_SINK = 2;
const WALK_MS = 1000;
const WALK_CAT_WIDTH = CAT_HEIGHT * WALKING_CAT_ASPECT;
const SLEEP_CAT_WIDTH = CAT_HEIGHT * SLEEPING_CAT_ASPECT;

/**
 * The walk, mounted once the bar's width is known so its shared values start in
 * the right place: the previous fact's spot, or straight at this one's with
 * reduced motion (then there is no cover and nothing animates).
 */
function Walk({ width, n, from, total, reduced }: { width: number; n: number; from: number; total: number; reduced: boolean }) {
  const colors = useColors();
  const end = catPosition(n, total, width, WALK_CAT_WIDTH);
  const catLeft = useSharedValue(reduced ? end : catPosition(from, total, width, WALK_CAT_WIDTH));
  const coverWidth = useSharedValue(reduced ? 0 : (width * (n - from)) / total);
  const first = useRef(true);

  useEffect(() => {
    if (reduced || !first.current) {
      // a later resize or reduced motion: no walk, just stand at n
      cancelAnimation(catLeft);
      cancelAnimation(coverWidth);
      catLeft.value = end;
      coverWidth.value = 0;
    } else {
      const timing = { duration: WALK_MS, easing: Easing.inOut(Easing.ease) };
      catLeft.value = withTiming(end, timing);
      coverWidth.value = withTiming(0, timing);
    }
    first.current = false;
    // catLeft and coverWidth are stable shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, width, reduced]);

  // Leaving mid-walk must stop the animation on both values (spec §5.1).
  useEffect(
    () => () => {
      cancelAnimation(catLeft);
      cancelAnimation(coverWidth);
    },
    [catLeft, coverWidth],
  );

  const catStyle = useAnimatedStyle(() => ({ left: catLeft.value }));
  const coverStyle = useAnimatedStyle(() => ({ width: coverWidth.value }));

  return (
    <>
      {reduced || n <= from ? null : (
        // Matches ProgressBar's track only because no label is passed; anchored at n so it uncovers left to right.
        <Animated.View
          testID="fact-progress-cover"
          pointerEvents="none"
          style={[styles.cover, { right: width - (width * n) / total, backgroundColor: colors.muted }, coverStyle]}
        />
      )}
      <Animated.View testID="walking-cat-holder" pointerEvents="none" style={[styles.cat, catStyle]}>
        <WalkingCat height={CAT_HEIGHT} />
      </Animated.View>
    </>
  );
}

export function FactProgressBar({ progress, t }: { progress: FactProgress; t: (key: string) => string }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);

  const done = progress.kind === 'done';
  const total = progress.total;
  const n = done ? total : progress.n;
  const from = done ? total : progress.walkFrom;
  const words = done
    ? t('factProgressDone').replace('{total}', String(total))
    : t('factProgress').replace('{n}', String(n)).replace('{total}', String(total));

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);

  // Before the width is known the bar sits at the walk's start, so there is no flash of the end state.
  const value = width > 0 ? n : from;

  return (
    <View testID="fact-progress" onLayout={onLayout} style={styles.wrap}>
      {/* the cat's strip above the bar is reserved, so nothing above it is overlapped */}
      <View style={styles.bar}>
        <ProgressBar value={value} max={total} hideValue accessibilityText={words} />
        {width > 0 && !done ? <Walk width={width} n={n} from={from} total={total} reduced={reduced} /> : null}
        {width > 0 && done ? (
          <View
            testID="sleeping-cat-holder"
            pointerEvents="none"
            style={[styles.cat, { left: catPosition(total, total, width, SLEEP_CAT_WIDTH) }]}
          >
            <SleepingCat height={CAT_HEIGHT} />
          </View>
        ) : null}
      </View>
      <Text
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.words, { color: colors.mutedForeground }]}
      >
        {words}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: CAT_HEIGHT - CAT_SINK,
    gap: spacing[1],
  },
  bar: {
    position: 'relative',
  },
  cover: {
    position: 'absolute',
    top: 0,
    height: BAR_HEIGHT,
    borderRadius: radii.pill,
  },
  // Inside the bar's box, so the cat rides in the strip reserved above it.
  cat: {
    position: 'absolute',
    top: -(CAT_HEIGHT - CAT_SINK),
  },
  words: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.bodyBold,
  },
});
