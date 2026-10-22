import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SignInRequiredBanner } from './SignInRequiredBanner';
import { ReviewReadyBanner } from './ReviewReadyBanner';
import { OwnershipNoticeBanner } from './OwnershipNoticeBanner';
import { HomeScreenNudgeBanner } from './HomeScreenNudgeBanner';
import { IssueReminderBanner, ReportReminderBanner } from './ReportReminderBanner';
import { BANNER_AREA_TOP_GAP, setBannerAreaHeight } from '@/lib/bannerArea';

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
 *
 * SYC-128: the stack still floats (it's shared by every screen), but it now
 * measures itself and publishes its height through lib/bannerArea, so a
 * screen can reserve that much room at its top instead of having its header
 * covered — on desktop web there's no safe-area inset to push the banners
 * clear of it. With no banner showing the stack is 0 tall and nothing moves.
 */
export function BannerStack() {
  const insets = useSafeAreaInsets();
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setBannerAreaHeight(e.nativeEvent.layout.height);
  }, []);
  // Leaving the tree (e.g. back to onboarding) must not strand a reserve.
  useEffect(() => () => setBannerAreaHeight(0), []);
  return (
    <>
      <View
        pointerEvents="box-none"
        onLayout={onLayout}
        style={[styles.stack, { top: insets.top + BANNER_AREA_TOP_GAP }]}
      >
        <SignInRequiredBanner />
        <ReportReminderBanner />
        <IssueReminderBanner />
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
    gap: BANNER_AREA_TOP_GAP,
  },
});
