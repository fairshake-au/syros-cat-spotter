import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Shown instead of the app when DeviceProvider's one-time device id/secret
 * setup fails outright — most likely no cryptographically secure random
 * source is available at runtime (SYC-136: DeviceContext.tsx refuses to
 * fall back to Math.random()).
 *
 * This is NOT the top-level ErrorBoundary's fallback (components/
 * ErrorFallback.tsx): that only ever catches errors thrown synchronously
 * during render/lifecycle, never a rejected promise inside a useEffect.
 * DeviceProvider catches the failure itself and exposes it as
 * `startupError`; OnboardingGate (app/_layout.tsx) renders this screen for
 * it instead of `null`, so the app doesn't just sit on a blank screen.
 */
export function StartupErrorScreen() {
  const colors = useColors();
  const { t } = useLanguage();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t('startupErrorTitle')}
        </Text>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          {t('startupErrorBody')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    width: '100%',
    maxWidth: 600,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 40,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
});
