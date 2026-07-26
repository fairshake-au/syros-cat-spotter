import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, spacing, shadows } from '@/constants/theme';
import { palette } from '@/constants/colors';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  const colors = useColors();

  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      style={[styles.wrap, { opacity: disabled ? 0.5 : 1 }]}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: checked ? colors.primary : palette.stone400,
            justifyContent: checked ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <View style={[styles.knob, shadows.sm, { backgroundColor: palette.stone000 }]} />
      </View>
      {label ? <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  track: {
    width: 46,
    height: 28,
    borderRadius: radii.pill,
    padding: 3,
    flexDirection: 'row',
  },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
  },
});
