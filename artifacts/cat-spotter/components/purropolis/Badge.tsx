import React from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { isTextChildren } from './textChildren';
import { fonts, fontSizes, radii, spacing } from '@/constants/theme';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  tone?: BadgeTone;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ tone = 'info', children, style }: BadgeProps) {
  const colors = useColors();

  // Foreground and background must both be scheme-aware or both fixed. The
  // `*Soft` backgrounds flip to near-black in dark mode, so a fixed dark ramp
  // (olive-700, sun-700, aegean-700) as the label colour is unreadable there.
  // Pairing `--status-x` with `--status-x-soft` is also what the web DS does.
  const tones: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
    success: { bg: colors.successSoft, fg: colors.success, dot: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
    info: { bg: colors.infoSoft, fg: colors.info, dot: colors.info },
  };
  const t = tones[tone];

  return (
    <View style={[styles.base, { backgroundColor: t.bg }, style]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      {isTextChildren(children) ? (
        <Text style={[styles.label, { color: t.fg }]}>{children}</Text>
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
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: fontSizes['2xs'],
  },
});
