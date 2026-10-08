import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Decision 7 (Samuel, 6 Oct 2026): before getting old spots back on a phone
 * that already has a spotter, name the spotter being left and what happens to
 * its spots. Nothing is merged: they stay on the map under the old name.
 */
export function restoreWarningText(
  t: (key: string) => string,
  current: string,
  spots: number,
): string {
  const text =
    spots <= 0 ? t('restoreWarningNone') : spots === 1 ? t('restoreWarningOne') : t('restoreWarningMany');
  return text.replace(/\{current\}/g, current).replace('{n}', String(spots));
}

export function RestoreWarning({ current, spots }: { current: string; spots: number }) {
  const colors = useColors();
  const { t } = useLanguage();
  return (
    <View
      testID="restore-warning"
      accessibilityRole="alert"
      style={[styles.box, { backgroundColor: palette.sun100, borderColor: palette.sun700 }]}
    >
      <Text style={[styles.text, { color: colors.foreground }]}>{restoreWarningText(t, current, spots)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radii.md, padding: spacing[4] },
  text: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm, lineHeight: 21 },
});
