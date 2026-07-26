import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing, shadows, tracking, lineHeights } from '@/constants/theme';

export type StatTileTone = 'aegean' | 'bougain' | 'sun' | 'terra' | 'olive' | 'neutral';

export interface StatTileProps {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  tone?: StatTileTone;
  style?: StyleProp<ViewStyle>;
}

export function StatTile({ value, label, icon, tone = 'neutral', style }: StatTileProps) {
  const colors = useColors();

  const tones: Record<StatTileTone, { bg: string; fg: string }> = {
    aegean: { bg: palette.aegean100, fg: palette.aegean800 },
    bougain: { bg: palette.bougain100, fg: palette.bougain700 },
    sun: { bg: palette.sun100, fg: palette.sun700 },
    terra: { bg: palette.terra100, fg: palette.terra700 },
    olive: { bg: palette.olive100, fg: palette.olive700 },
    neutral: { bg: colors.card, fg: colors.foreground },
  };
  const t = tones[tone];

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: t.bg },
        tone === 'neutral' ? shadows.sm : undefined,
        style,
      ]}
    >
      {icon ? <View>{icon}</View> : null}
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text
          style={[
            styles.value,
            { color: t.fg, lineHeight: fontSizes['2xl'] * lineHeights.tight },
          ]}
        >
          {value}
        </Text>
      ) : (
        value
      )}
      {/* Toned tiles keep a fixed light background in both schemes (matching the
          web DS, whose --*-100 ramps are scheme-invariant), so the label must be
          derived from the tone too. Using the scheme-aware muted colour here
          puts pale grey text on a pale tile in dark mode. */}
      <Text
        style={[
          styles.label,
          {
            color: tone === 'neutral' ? colors.mutedForeground : t.fg,
            opacity: tone === 'neutral' ? 1 : 0.75,
            letterSpacing: fontSizes['2xs'] * tracking.wider,
          },
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[1],
    minWidth: 120,
  },
  value: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes['2xl'],
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
  },
});
