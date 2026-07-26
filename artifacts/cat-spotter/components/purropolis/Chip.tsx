import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, borderWidths } from '@/constants/theme';

/**
 * Filter pill used by the Cat-alog screen's category row. No web
 * counterpart in mockup-sandbox/purropolis — this is native-only, built
 * to match the design: active = solid primary bg + white text, inactive =
 * surface-card bg + 1.5px border-strong border.
 */
export interface ChipProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Chip({ label, active = false, disabled = false, onPress, style }: ChipProps) {
  const colors = useColors();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: active ? colors.primary : colors.card,
          borderColor: active ? 'transparent' : colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: active ? colors.primaryForeground : colors.foreground },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: radii.pill,
    borderWidth: borderWidths.thin,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.xs,
  },
});
