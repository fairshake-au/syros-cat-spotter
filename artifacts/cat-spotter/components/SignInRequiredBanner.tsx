import React from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useOffline } from '@/context/OfflineContext';
import { absoluteUrl } from '@/lib/urls';

/**
 * SYC-121: shown when a sync hit the pre-launch gate's own 401 — e.g. a
 * sighting queued before the Neon cutover, replayed after with no valid
 * website session cookie. `needsSignIn` is only ever true on web (see
 * OfflineContext), so this never renders on a native store build, which
 * has no sign-in flow to point at.
 *
 * Mounted once in app/_layout.tsx, like ReviewReadyBanner and
 * OwnershipNoticeBanner, so it shows on every screen. Tapping it opens the
 * website's sign-in page in a new tab; the app itself retries automatically
 * once the tab regains focus (OfflineContext's retryAfterSignIn).
 */
export function SignInRequiredBanner() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { needsSignIn } = useOffline();

  if (!needsSignIn) return null;

  const openSignIn = () => {
    Linking.openURL(absoluteUrl('/_gate/login')).catch(() => {});
  };

  return (
    <Pressable
      onPress={openSignIn}
      style={[
        styles.banner,
        {
          top: insets.top + 8,
          backgroundColor: colors.accent,
          shadowColor: '#000',
        },
      ]}
    >
      <Feather name="lock" size={16} color={colors.accentForeground} />
      <Text style={[styles.text, { color: colors.accentForeground }]}>
        {t('signInRequiredTitle')}
      </Text>
      <Text style={[styles.action, { color: colors.accentForeground }]}>
        {t('signInRequiredAction')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    zIndex: 20,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  action: {
    fontSize: 13,
    fontFamily: 'Inter_800ExtraBold',
    textDecorationLine: 'underline',
  },
});
