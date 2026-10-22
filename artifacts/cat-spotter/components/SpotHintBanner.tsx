import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { photoSource } from '@/lib/urls';
import { fonts, fontSizes, lineHeights, radii, spacing } from '@/constants/theme';

/**
 * "Spotting {name}" (SYC-574, design-review-fixes-oct22.md §2.2): a slim
 * banner above the camera while the Spot screen holds a hint, with the cat's
 * small photo and a ✕ ("Stop spotting {name}"). Theme tokens only, so it works
 * in dark mode; the name is never cut short, so a long Greek or French name
 * wraps onto a second line at 390px.
 */
export function SpotHintBanner({
  catName,
  photoUrl,
  onStop,
}: {
  catName: string;
  photoUrl: string | null;
  onStop: () => void;
}) {
  const colors = useColors();
  const { t } = useLanguage();
  const named = (key: string) => t(key).split('{name}').join(catName);
  return (
    <View
      testID="spot-hint-banner"
      style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Image
        source={photoSource(photoUrl)}
        style={[styles.photo, { backgroundColor: colors.muted }]}
        contentFit="cover"
        accessible={false}
      />
      <Text testID="spot-hint-text" style={[styles.text, { color: colors.foreground }]}>
        {named('spotHintBanner')}
      </Text>
      <Pressable
        testID="spot-hint-stop"
        onPress={onStop}
        accessibilityRole="button"
        accessibilityLabel={named('spotHintStop')}
        hitSlop={8}
        style={styles.stop}
      >
        <Feather name="x" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingLeft: spacing[2],
    paddingRight: spacing[1],
    borderRadius: radii.md,
    borderWidth: 1,
  },
  photo: { width: 36, height: 36, borderRadius: radii.sm },
  text: {
    flex: 1,
    flexShrink: 1,
    fontFamily: fonts.bodySemiBold,
    fontSize: fontSizes.sm,
    lineHeight: Math.round(fontSizes.sm * lineHeights.normal),
  },
  stop: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
