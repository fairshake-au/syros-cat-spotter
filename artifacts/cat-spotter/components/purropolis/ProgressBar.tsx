import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

export type ProgressTone = 'aegean' | 'bougain' | 'sun' | 'olive';

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: ProgressTone;
  label?: string;
  /** SYC-772: leave out the `{value}/{max}` text (the label still shows). */
  hideValue?: boolean;
  /** SYC-772: spoken label and value text, replacing the plain label and value. */
  accessibilityText?: string;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value, max = 100, tone = 'aegean', label, hideValue, accessibilityText, style }: ProgressBarProps) {
  const colors = useColors();
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  const tones: Record<ProgressTone, string> = {
    aegean: colors.primary,
    bougain: colors.accent,
    sun: palette.sun600,
    olive: palette.olive600,
  };

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[styles.labelText, { color: colors.mutedForeground }]}>{label}</Text>
          {hideValue ? null : (
            <Text style={[styles.value, { color: colors.mutedForeground }]}>
              {value}/{max}
            </Text>
          )}
        </View>
      ) : null}
      <View
        accessibilityRole="progressbar"
        accessibilityValue={
          accessibilityText ? { min: 0, max, now: value, text: accessibilityText } : { min: 0, max, now: value }
        }
        accessibilityLabel={accessibilityText ?? label}
        // react-native-web ignores the accessibilityValue object, so web gets the text this way.
        aria-valuetext={accessibilityText}
        style={[styles.track, { backgroundColor: colors.muted }]}
      >
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tones[tone] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[1],
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  labelText: {
    fontSize: fontSizes['2xs'],
    fontFamily: fonts.bodyBold,
  },
  value: {
    fontFamily: fonts.mono,
    fontSize: fontSizes['2xs'],
  },
  track: {
    height: 10,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
