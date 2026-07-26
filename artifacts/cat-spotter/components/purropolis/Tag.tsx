import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { isTextChildren } from './textChildren';
import { palette } from '@/constants/colors';
import { fonts, fontSizes, radii, spacing, tracking } from '@/constants/theme';

export type TagTone = 'neutral' | 'aegean' | 'bougain' | 'sun' | 'terra' | 'olive';

export interface TagProps {
  tone?: TagTone;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Tag({ tone = 'neutral', children, style }: TagProps) {
  const colors = useColors();

  const tones: Record<TagTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.muted, fg: colors.foreground },
    aegean: { bg: palette.aegean100, fg: palette.aegean800 },
    bougain: { bg: palette.bougain100, fg: palette.bougain700 },
    sun: { bg: palette.sun100, fg: palette.sun700 },
    terra: { bg: palette.terra100, fg: palette.terra700 },
    olive: { bg: palette.olive100, fg: palette.olive700 },
  };
  const t = tones[tone];

  return (
    <View style={[styles.base, { backgroundColor: t.bg }, style]}>
      {isTextChildren(children) ? (
        <Text
          style={[
            styles.label,
            { color: t.fg, letterSpacing: fontSizes['2xs'] * tracking.wide },
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: 2,
    paddingHorizontal: spacing[2],
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
  },
});
