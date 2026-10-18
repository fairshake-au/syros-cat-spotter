import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { fonts } from '@/constants/theme';

/**
 * "Report an issue" about a cat (SYC-44 PR 6.1; report-an-issue.md §3.1).
 * Sits below "This cat needs help" on the cat page and is never bigger than
 * it: the same quiet text link, a lighter icon. PR 6.2 mounts it with the
 * reason sheet as `onPress`.
 */
export function ReportIssueLink({ onPress, style }: { onPress: () => void; style?: object }) {
  const colors = useColors();
  const { t } = useLanguage();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={8}
      style={[styles.link, style]}
      testID="report-issue-link"
    >
      <Feather name="flag" size={13} color={colors.mutedForeground} />
      <Text style={[styles.text, { color: colors.mutedForeground }]}>{t('reportIssue')}</Text>
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
  // Never bigger than NeedsHelpLink's 13pt semi-bold (spec §3).
  text: { fontFamily: fonts.body, fontSize: 13, textDecorationLine: 'underline' },
});
