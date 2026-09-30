import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useDevice } from '@/context/DeviceContext';
import {
  HOME_SCREEN_DISMISSED_KEY,
  detectHomeScreenPlatform,
  isHomeScreenStandalone,
  isWithinDismissalSnooze,
} from '@/lib/homeScreenNudge';

/**
 * SYC-134 / SYC-3 Decision 1(a): a spotter's identity on the website lives
 * only in that browser's storage for that one address, and Safari clears it
 * after 7 days without a visit. A Home Screen icon isn't subject to that
 * rule (checked on a real iPhone for SYC-134). This banner nudges web
 * testers to add one — it never claims to make the app work offline, only
 * that it protects against the browser clearing saved storage.
 *
 * Native builds never render this (there's no "Home Screen" concept to add
 * to — the app already is the icon), and it hides itself once the site is
 * already running standalone, so it can never nag someone it already
 * helped. It only appears once a username has been claimed: before that,
 * onboarding hasn't produced anything worth losing yet.
 *
 * Mounted via BannerStack, after the other banners (lowest priority — the
 * sign-in gate and any urgent notice matter more than this nudge).
 */
export function HomeScreenNudgeBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const { username, isReady } = useDevice();

  const [standalone, setStandalone] = useState(true); // default hidden until checked
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
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as unknown as { prompt: () => void });
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
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

  const platform = detectHomeScreenPlatform(
    typeof navigator !== 'undefined' ? navigator.userAgent : '',
    typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
  );

  let instructions: string;
  let showShareIcon = false;
  let showInstallButton = false;
  switch (platform) {
    case 'ios-safari':
      instructions = t('homeScreenNudgeInstructionsIosSafari');
      showShareIcon = true;
      break;
    case 'ios-chrome':
      instructions = t('homeScreenNudgeInstructionsIosChrome');
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

  const onInstallPress = () => {
    installPrompt?.prompt();
  };

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: colors.accent,
          shadowColor: '#000',
        },
      ]}
    >
      {showShareIcon && (
        <Feather name="share" size={16} color={colors.accentForeground} />
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
          <Pressable onPress={onInstallPress} hitSlop={6}>
            <Text
              style={[styles.action, { color: colors.accentForeground }]}
            >
              {t('homeScreenNudgeAddButton')}
            </Text>
          </Pressable>
        )}
      </View>
      <Pressable onPress={dismiss} hitSlop={10}>
        <Feather name="x" size={16} color={colors.accentForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
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
