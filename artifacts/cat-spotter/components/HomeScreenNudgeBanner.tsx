import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useAnyModalOpen } from '@/lib/modalVisibility';
import { useKeepSafeState } from '@/hooks/useKeepSafeState';
import {
  HOME_SCREEN_DISMISSED_KEY,
  detectHomeScreenPlatform,
  isHomeScreenStandalone,
  isWithinDismissalSnooze,
} from '@/lib/homeScreenNudge';

/** Conservative estimate of the bottom tab bar's height (label + icon,
 * plus a little breathing room) so the floating card never sits under it.
 * There's no exposed constant for NativeTabs' actual height, and it's web
 * only here anyway, so this stays a fixed approximation rather than reading
 * a native measurement. */
const TAB_BAR_CLEARANCE = 72;

/**
 * SYC-134 / SYC-3 Decision 1(a): a spotter's identity on the website lives
 * only in that browser's storage for that one address, and Safari clears it
 * after 7 days without a visit. A Home Screen icon isn't subject to that
 * rule (checked on a real iPhone for SYC-134, in Safari). This banner
 * nudges web testers to add one — it never claims to make the app work
 * offline, only that it protects against the browser clearing saved
 * storage.
 *
 * Native builds never render this (there's no "Home Screen" concept to add
 * to — the app already is the icon), and it hides itself once the site is
 * already running standalone, so it can never nag someone it already
 * helped. It only appears once a username has been claimed: before that,
 * onboarding hasn't produced anything worth losing yet.
 *
 * SYC-134 review round 3, 30 Sep 2026 (Samuel): **scoped to iPhone/iPad
 * Safari only.** Safari's 7-day storage-clearing rule is what this banner
 * protects against, and that's specifically Safari's rule, not the
 * platform's — so the card never shows on Android (Chrome included) or on
 * desktop (any browser, Mac Safari included) at all, regardless of what's
 * detected there. It also still hides on every *other* iOS browser (see
 * `detectHomeScreenPlatform`'s doc comment) — the on-device check that
 * justifies this banner only covers Safari specifically.
 *
 * SYC-134 review, 30 Sep 2026 (Samuel): renders as a floating card centred
 * on the screen, not a top banner — see the placement note below. Mounted
 * by BannerStack, but as a sibling of the top stack, not inside it, so the
 * sign-in and urgent banners keep the top of the screen to themselves. It
 * still defers to the sign-in-required prompt: while `needsSignIn` is true,
 * this stays hidden rather than compete with it for attention.
 *
 * Placement (Samuel, 30 Sep 2026): a floating card, centred both ways over
 * the content, no dimmed backdrop and no blocking of anything except the
 * card itself (`pointerEvents="box-none"` on the full-screen wrapper).
 * Comfortable max-width on desktop, margins at 390px, kept clear of the tab
 * bar and the safe-area insets. There's no on-screen keyboard to dodge here
 * — this never renders on native, and a web page's own keyboard doesn't
 * push RN's `Keyboard` events, so no separate keyboard-avoiding logic is
 * needed.
 *
 * SYC-134 review round 2, 30 Sep 2026: also hides while any modal/bottom
 * sheet (e.g. ClaimCatSheet) is open, via the tiny shared flag in
 * `lib/modalVisibility.ts`.
 *
 * SYC-274 (Samuel, 9 Oct 2026): hidden once this phone's "keep my spots
 * safe" email is **confirmed**. Both exist so a web tester doesn't lose their
 * spots, and a confirmed address already gets them back. A pending address
 * restores nothing yet, so the card still shows until it's confirmed.
 */
export function HomeScreenNudgeBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const { username, isReady } = useDevice();
  const { needsSignIn } = useOffline();
  const insets = useSafeAreaInsets();
  const anyModalOpen = useAnyModalOpen();
  // Only where the card can show (iPhone/iPad Safari, with a spotter), so no
  // other browser makes the request just for this.
  const couldShow =
    Platform.OS === 'web' &&
    Boolean(username) &&
    typeof navigator !== 'undefined' &&
    detectHomeScreenPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios-safari';
  const keepSafe = useKeepSafeState({ enabled: couldShow });

  const [standalone, setStandalone] = useState(true); // default hidden until checked
  const [snoozed, setSnoozed] = useState<boolean | null>(null); // null = not loaded yet

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    setStandalone(
      isHomeScreenStandalone(
        navigator as unknown as { standalone?: boolean },
        typeof window !== 'undefined' ? window : undefined,
      ),
    );
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    AsyncStorage.getItem(HOME_SCREEN_DISMISSED_KEY).then((raw) => {
      setSnoozed(isWithinDismissalSnooze(raw, Date.now()));
    });
  }, []);

  const dismiss = useCallback(() => {
    setSnoozed(true);
    AsyncStorage.setItem(HOME_SCREEN_DISMISSED_KEY, String(Date.now())).catch(
      () => {},
    );
  }, []);

  if (Platform.OS !== 'web') return null;
  if (standalone) return null;
  if (!isReady || !username) return null;
  if (snoozed !== false) return null; // still loading, or dismissed within 7 days
  // The sign-in-required prompt matters more; don't compete with it.
  if (needsSignIn) return null;
  // Don't overlap a modal/bottom sheet (e.g. ClaimCatSheet).
  if (anyModalOpen) return null;
  // SYC-274: a confirmed keep-safe email already protects these spots.
  if (keepSafe.data?.status === 'confirmed') return null;

  const platform = detectHomeScreenPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
    typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
  );

  // Scoped to iPhone/iPad Safari only (see the doc comment above) — Android,
  // desktop, and every other iOS browser are out of scope entirely.
  if (platform !== 'ios-safari') return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlay,
        {
          top: insets.top,
          bottom: insets.bottom + TAB_BAR_CLEARANCE,
          left: insets.left,
          right: insets.right,
        },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.accent,
            shadowColor: '#000',
          },
        ]}
      >
        <Feather
          name="share"
          size={16}
          color={colors.accentForeground}
          accessibilityLabel={t('homeScreenNudgeShareLabel')}
        />
        <View style={styles.textColumn}>
          <Text style={[styles.text, { color: colors.accentForeground }]}>
            {t('homeScreenNudgeText')}
          </Text>
          <Text
            style={[styles.instructions, { color: colors.accentForeground }]}
          >
            {t('homeScreenNudgeInstructionsIosSafari')}
          </Text>
        </View>
        <Pressable
          onPress={dismiss}
          style={styles.closeHit}
          accessibilityRole="button"
          accessibilityLabel={t('homeScreenNudgeDismissLabel')}
        >
          <Feather name="x" size={16} color={colors.accentForeground} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // SYC-509: 44pt tap area around the 16pt close icon; the negative margins keep the row height without covering the text beside it.
  closeHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -14, marginHorizontal: -4 },
  // Full-screen wrapper, clear of the tab bar and safe-area insets.
  // `box-none` so nothing except the card itself is tappable — no dimmed
  // backdrop, no blocking of the content behind it.
  overlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    width: '100%',
    maxWidth: 420,
  },
  textColumn: {
    flex: 1,
    gap: 4,
  },
  text: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  instructions: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
