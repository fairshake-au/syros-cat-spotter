import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SignInRequiredBanner } from './SignInRequiredBanner';
import { ReviewReadyBanner } from './ReviewReadyBanner';
import { OwnershipNoticeBanner } from './OwnershipNoticeBanner';
import { HomeScreenNudgeBanner } from './HomeScreenNudgeBanner';

/**
 * SYC-121 review fix: SignInRequiredBanner, ReviewReadyBanner and
 * OwnershipNoticeBanner used to each render at the same absolute rect,
 * telling themselves apart only by zIndex (SignInRequiredBanner and
 * OwnershipNoticeBanner had one, ReviewReadyBanner had none). When two were
 * visible at once — a plausible case: one queued item finishes syncing
 * while another hits the sign-in gate — the lower banner was completely
 * hidden.
 *
 * Stack every visible banner in one column instead, in priority order
 * (sign-in, review-ready, ownership notice), so no banner is ever silently
 * hidden. Each banner still decides its own visibility by returning null;
 * this container only owns the shared position (below the safe area) and
 * the vertical gap between whichever banners are currently showing.
 *
 * SYC-134 review, 30 Sep 2026 (Samuel): the Home Screen nudge is a floating
 * card centred on the screen, not a top banner, so it's mounted as a
 * sibling of the top stack rather than inside it — the sign-in and urgent
 * banners keep the top of the screen to themselves, and the nudge owns its
 * own full-screen positioning (see HomeScreenNudgeBanner). It still defers
 * to the sign-in-required prompt itself (checked inside that component),
 * so the two never show at once.
 */
export function BannerStack() {
  const insets = useSafeAreaInsets();
  return (
    <>
      <View
        pointerEvents="box-none"
        style={[styles.stack, { top: insets.top + 8 }]}
      >
        <SignInRequiredBanner />
        <ReviewReadyBanner />
        <OwnershipNoticeBanner />
      </View>
      <HomeScreenNudgeBanner />
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'column',
    gap: 8,
  },
});
