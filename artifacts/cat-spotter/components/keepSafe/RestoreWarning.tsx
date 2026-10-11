import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Decision 7 (Samuel, 6 Oct 2026): before getting old spots back on a phone
 * that already has a spotter, name the spotter being left. SYC-266 (Samuel,
 * 10 Oct 2026, wording approved as written): then ask what should happen to
 * it. Its spots stay on the map either way; nothing is merged.
 */
export function restoreWarningText(t: (key: string) => string, current: string): string {
  return t('restoreWarningNone').replace(/\{current\}/g, current);
}

export type CurrentSpotterChoice = 'delete' | 'keep';

/** The line under each choice, by how many spots the spotter being left has. */
export function restoreChoiceText(
  t: (key: string) => string,
  choice: CurrentSpotterChoice,
  current: string,
  spots: number,
): string {
  const base = choice === 'delete' ? 'restoreDeleteCurrent' : 'restoreKeepCurrent';
  const key = spots <= 0 ? `${base}None` : spots === 1 ? `${base}One` : `${base}Many`;
  return t(key).replace(/\{current\}/g, current).replace('{n}', String(spots));
}

export function RestoreWarning({
  current,
  spots,
  choice,
  onChoose,
}: {
  current: string;
  spots: number;
  /**
   * Neither is chosen until the person picks one. Without `onChoose` only the
   * warning shows (the "Get your spots back" email screen: the choice comes
   * on the restore page, where the move happens).
   */
  choice?: CurrentSpotterChoice | null;
  onChoose?: (choice: CurrentSpotterChoice) => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const option = (value: CurrentSpotterChoice) => {
    const selected = choice === value;
    const label = t(value === 'delete' ? 'restoreDeleteCurrent' : 'restoreKeepCurrent').replace(
      /\{current\}/g,
      current,
    );
    return (
      <Pressable
        key={value}
        testID={`restore-choice-${value}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        aria-checked={selected}
        accessibilityLabel={label}
        onPress={() => onChoose?.(value)}
        style={[
          styles.option,
          {
            borderColor: selected ? colors.primary : colors.border,
            borderWidth: selected ? 2 : 1,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Text style={[styles.optionTitle, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.optionText, { color: colors.mutedForeground }]}>
          {restoreChoiceText(t, value, current, spots)}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.wrap}>
      <View
        testID="restore-warning"
        accessibilityRole="alert"
        style={[styles.box, { backgroundColor: palette.sun100, borderColor: palette.sun700 }]}
      >
        <Text style={[styles.text, { color: colors.foreground }]}>{restoreWarningText(t, current)}</Text>
      </View>
      {onChoose ? (
        <>
          <Text style={[styles.question, { color: colors.foreground }]}>
            {t('restoreWhatAboutCurrent').replace(/\{current\}/g, current)}
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {option('delete')}
            {option('keep')}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[3] },
  box: { borderWidth: 1, borderRadius: radii.md, padding: spacing[4] },
  text: { fontFamily: fonts.bodyBold, fontSize: fontSizes.sm, lineHeight: 21 },
  question: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md, lineHeight: 23 },
  options: { gap: spacing[3] },
  option: { borderRadius: radii.md, padding: spacing[4], gap: spacing[1] },
  optionTitle: { fontFamily: fonts.bodyBold, fontSize: fontSizes.md, lineHeight: 22 },
  optionText: { fontFamily: fonts.body, fontSize: fontSizes.sm, lineHeight: 21 },
});
