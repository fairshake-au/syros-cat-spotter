import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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

/**
 * The pill is about 35px tall. The Pressable around it adds 5px above and
 * below, so the tap area reaches 44pt while the chip looks the same (SYC-644).
 * Real padding, not `hitSlop`, which the web build ignores. The negative margin
 * gives the space back, so nothing around the chip moves. A parent that
 * scrolls or clips needs 5px of room on each side, or it cuts the tap area.
 */
export const CHIP_TAP_PAD = 5;

export function Chip({ label, active = false, disabled = false, onPress, style }: ChipProps) {
  const colors = useColors();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      style={[styles.tapArea, style]}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: active ? colors.primary : colors.card,
              borderColor: active ? 'transparent' : colors.border,
              opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
            },
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
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tapArea: {
    paddingVertical: CHIP_TAP_PAD,
    marginVertical: -CHIP_TAP_PAD,
    alignSelf: 'flex-start',
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: radii.pill,
    borderWidth: borderWidths.thin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.displaySemiBold,
    fontSize: fontSizes.xs,
  },
});
