import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/purropolis/Button';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts, fontSizes, spacing } from '@/constants/theme';
import { decorative } from '@/lib/a11yText';

/**
 * SYC-508 (couldnt-load-try-again.md §2): the one "Couldn't load" state, used
 * wherever a load can fail and never for a real empty state.
 *
 * - `full` fills the empty area of a screen: icon, title, line, Try again.
 * - `line` sits inside a section: one line and a Try again. `message`
 *   replaces the standard words (Home's stats keep their own).
 *
 * Try again waits for `onRetry` to settle, so the spinner stops whether it
 * worked or not, and a second press while it's busy does nothing.
 */
export function LoadFailed({
  size,
  onRetry,
  message,
  retryLabel,
  testID,
}: {
  size: 'full' | 'line';
  onRetry: () => Promise<unknown> | void;
  message?: string;
  /** What screen readers hear for Try again when a screen has more than one. */
  retryLabel?: string;
  testID?: string;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const retry = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await onRetry();
    } catch {
      // The screen shows the outcome; a failed retry just leaves this here.
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const button = (
    <Button
      variant={size === 'full' ? 'primary' : 'ghost'}
      size={size === 'full' ? 'lg' : 'md'}
      busy={busy}
      onPress={retry}
      accessibilityLabel={retryLabel}
      iconLeft={
        busy ? (
          <ActivityIndicator
            size="small"
            color={size === 'full' ? colors.primaryForeground : colors.primary}
          />
        ) : undefined
      }
      wrapLabel
      style={styles.button}
      testID={testID ? `${testID}-retry` : undefined}
    >
      {t('tryAgain')}
    </Button>
  );

  if (size === 'line') {
    return (
      <View style={styles.line} testID={testID}>
        <View accessibilityLiveRegion="polite" aria-live="polite" style={styles.lineText}>
          <Text style={[styles.lineMessage, { color: colors.mutedForeground }]}>
            {message ?? t('loadFailedTitle')}
          </Text>
        </View>
        {button}
      </View>
    );
  }

  return (
    <View style={styles.full} testID={testID}>
      <View {...decorative}>
        <Feather name="cloud-off" size={40} color={colors.mutedForeground} />
      </View>
      <View accessibilityLiveRegion="polite" aria-live="polite" style={styles.fullText}>
        <Text role="heading" style={[styles.title, { color: colors.foreground }]}>
          {message ?? t('loadFailedTitle')}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {t('loadFailedBody')}
        </Text>
      </View>
      {button}
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[5],
  },
  fullText: { alignItems: 'center', gap: spacing[2], maxWidth: 320 },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.lg,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    lineHeight: fontSizes.sm * 1.45,
    textAlign: 'center',
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing[1],
  },
  lineText: { flexShrink: 1 },
  lineMessage: { fontFamily: fonts.body, fontSize: fontSizes.sm },
  button: { minHeight: 44, maxWidth: '100%' },
});
