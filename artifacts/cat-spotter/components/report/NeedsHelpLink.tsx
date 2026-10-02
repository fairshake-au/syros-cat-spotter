import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts } from '@/constants/theme';
import { setReportHandoff, type ReportHandoff } from '@/lib/reportHandoff';

/**
 * "This cat needs help" (spec §4.1; SYC-42 plan item 1.8). Quiet on purpose:
 * a text link, never the biggest thing on the screen. Most cats are fine, and
 * an app that shouts REPORT A PROBLEM at everybody teaches people to ignore it.
 */
export function NeedsHelpLink({
  handoff,
  prepare,
  style,
}: {
  handoff?: ReportHandoff;
  /** Builds the handoff on tap (the review screen reads the sighting's photo). */
  prepare?: () => Promise<ReportHandoff>;
  style?: object;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={async () => {
        if (handoff) setReportHandoff(handoff);
        if (prepare) {
          // Nothing blocks a report: if the photo can't be read, open anyway.
          const ready = await prepare().catch(() => null);
          if (ready) setReportHandoff(ready);
        }
        router.push('/report');
      }}
      hitSlop={8}
      style={[styles.link, style]}
      testID="needs-help-link"
    >
      <Feather name="alert-circle" size={14} color={colors.mutedForeground} />
      <Text style={[styles.text, { color: colors.mutedForeground }]}>{t('reportNeedsHelp')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: 32,
  },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 13, textDecorationLine: 'underline' },
});
