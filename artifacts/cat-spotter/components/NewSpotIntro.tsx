import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

interface NewSpotIntroProps {
  /** The photo just taken or chosen. */
  photoUri: string;
  title: string;
  /** What this screen asks for: where the cat was seen. */
  hint: string;
  retakeLabel: string;
  /** Throw this photo away and go back to the camera. */
  onRetake: () => void;
  /** True while the sighting is being sent or saved: the photo is still in use. */
  disabled?: boolean;
}

/**
 * The top of the "New spot" screen: the photo, a line saying what the screen
 * is for, and a clear way to take the photo again (SYC-117, SYC-118).
 *
 * Retake is a real button, not a small text link. Testers on the 29 Sep call
 * did not find the old "＋ Add another photo" link, and read it as adding a
 * second photo when it replaced the first.
 */
export function NewSpotIntro({
  photoUri,
  title,
  hint,
  retakeLabel,
  onRetake,
  disabled = false,
}: NewSpotIntroProps) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Image
        source={{ uri: photoUri }}
        style={[styles.thumb, { borderColor: colors.border }]}
        contentFit="cover"
      />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text>
        <Pressable
          onPress={disabled ? undefined : onRetake}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          hitSlop={6}
          testID="retake-photo"
          style={({ pressed }) => [
            styles.retake,
            {
              borderColor: colors.primary,
              backgroundColor: colors.card,
              opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather name="camera" size={14} color={colors.primary} />
          <Text style={[styles.retakeLabel, { color: colors.primary }]}>
            {retakeLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  thumb: { width: 88, height: 88, borderRadius: radii.lg, borderWidth: 1 },
  text: { flex: 1, gap: spacing[1] },
  title: { fontSize: fontSizes.md, fontFamily: fonts.displayBold },
  hint: { fontSize: fontSizes.xs, fontFamily: fonts.body, lineHeight: fontSizes.xs * 1.45 },
  retake: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderWidth: 1.5,
    borderRadius: radii.pill,
  },
  retakeLabel: { fontSize: fontSizes.xs, fontFamily: fonts.displayBold },
});
