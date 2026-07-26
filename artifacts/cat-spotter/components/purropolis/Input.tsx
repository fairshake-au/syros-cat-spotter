import React, { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { fonts, fontSizes, radii, spacing, borderWidths } from '@/constants/theme';

export interface InputProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string;
  iconLeft?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Input({ label, helper, error, iconLeft, style, onFocus, onBlur, ...rest }: InputProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.card,
            borderColor,
            borderWidth: focused ? borderWidths.thick : borderWidths.thin,
          },
        ]}
      >
        {iconLeft ? <View style={styles.icon}>{iconLeft}</View> : null}
        <TextInput
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground }, style]}
          {...rest}
        />
      </View>
      {error || helper ? (
        <Text style={[styles.helper, { color: error ? colors.danger : colors.mutedForeground }]}>
          {error || helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[1],
  },
  label: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.bodyBold,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radii.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: fontSizes.sm,
    padding: 0,
  },
  helper: {
    fontSize: fontSizes['2xs'],
  },
});
