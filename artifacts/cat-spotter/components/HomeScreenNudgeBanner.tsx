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
 * onboarding hasn't produced anything worth losing yet. It also hides on
 * every iOS browser except Safari (see `detectHomeScreenPlatform`'s doc
 * comment) — the on-device check that justifies this banner only covers
 * Safari, and a third-party iOS browser may not share its storage.
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
 * `lib/modalVisibility.ts`, and for good once the browser reports the app
 * was actually installed (the `appinstalled` event) — belt and braces
 * alongside the live `standalone` check, which only reflects *this* tab.
 */
export function HomeScreenNudgeBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const { username, isReady } = useDevice();
  const { needsSignIn } = useOffline();
  const insets = useSafeAreaInsets();
  const anyModalOpen = useAnyModalOpen();

  const [standalone, setStandalone] = useState(true); // default hidden until checked
  const [installed, setInstalled] = useState(false);
  const [snoozed, setSnoozed] = useState<boolean | null>(null); // null = not loaded yet
  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => void;
  } | null>(null);

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
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as unknown as { prompt: () => void });
    };
    // Fires once the browser has actually installed the app — the
    // authoritative signal, unlike `standalone`/`display-mode`, which only
    // describe *this* tab and wouldn't catch "installed, still browsing
    // the old tab". Once seen, never show the card in this tab again.
    const onAppInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
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
  if (standalone || installed) return null;
  if (!isReady || !username) return null;
  if (snoozed !== false) return null; // still loading, or dismissed within 7 days
  // The sign-in-required prompt matters more; don't compete with it.
  if (needsSignIn) return null;
  // Don't overlap a modal/bottom sheet (e.g. ClaimCatSheet).
  if (anyModalOpen) return null;

  const platform = detectHomeScreenPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
    typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
  );

  // SYC-134 review, 30 Sep 2026: Samuel's on-device check only covered iOS
  // Safari. A third-party iOS browser (Chrome, Firefox, Edge, ...) may keep
  // its own storage separate from Safari's, so a Home Screen icon added
  // from one could open with Safari's *empty* storage — the exact loss this
  // banner exists to prevent. Stay hidden there until that's checked on a
  // real device (see detectHomeScreenPlatform's doc comment; follow-up
  // ticket filed).
  if (platform === 'ios-unsupported') return null;

  let instructions: string;
  let showShareIcon = false;
  let showInstallButton = false;
  switch (platform) {
    case 'ios-safari':
      instructions = t('homeScreenNudgeInstructionsIosSafari');
      showShareIcon = true;
      break;
    case 'android-chrome':
      if (installPrompt) {
        instructions = '';
        showInstallButton = true;
      } else {
        instructions = t('homeScreenNudgeInstructionsAndroidChromeMenu');
      }
      break;
    default:
      instructions = t('homeScreenNudgeInstructionsOther');
  }

  // Clear the saved event once used: a `beforeinstallprompt` event can only
  // be prompted once, and the browser doesn't fire a fresh one just because
  // the user tapped again — without this, a double tap (or the card
  // lingering after the prompt is dismissed) would call `.prompt()` on an
  // already-spent event.
  const onInstallPress = () => {
    installPrompt?.prompt();
    setInstallPrompt(null);
  };

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
        {showShareIcon && (
          <Feather
            name="share"
            size={16}
            color={colors.accentForeground}
            accessibilityLabel={t('homeScreenNudgeShareLabel')}
          />
        )}
        <View style={styles.textColumn}>
          <Text style={[styles.text, { color: colors.accentForeground }]}>
            {t('homeScreenNudgeText')}
          </Text>
          {!!instructions && (
            <Text
              style={[styles.instructions, { color: colors.accentForeground }]}
            >
              {instructions}
            </Text>
          )}
          {showInstallButton && (
            <Pressable
              onPress={onInstallPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('homeScreenNudgeInstallLabel')}
            >
              <Text
                style={[styles.action, { color: colors.accentForeground }]}
              >
                {t('homeScreenNudgeAddButton')}
              </Text>
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={10}
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
  action: {
    fontSize: 13,
    fontFamily: 'Inter_800ExtraBold',
    textDecorationLine: 'underline',
  },
});
