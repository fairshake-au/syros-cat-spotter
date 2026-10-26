import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { isTextChildren } from './textChildren';
import { fonts, fontSizes, radii, spacing, shadows } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the width of its container. */
  block?: boolean;
  disabled?: boolean;
  /** Working on it (SYC-508): pressing does nothing, and screen readers hear "busy". */
  busy?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  /**
   * Let a long text label wrap onto more lines instead of being cut short with
   * an ellipsis. Off by default, so every other button looks as it did.
   */
  wrapLabel?: boolean;
  /** The pressable itself, so a sheet can hand focus back to it on close (SYC-709). */
  pressableRef?: React.Ref<View>;
}

const sizeConfig: Record<ButtonSize, { fontSize: number; paddingVertical: number; paddingHorizontal: number; minHeight: number }> = {
  sm: { fontSize: fontSizes.xs, paddingVertical: spacing[1], paddingHorizontal: spacing[3], minHeight: 32 },
  md: { fontSize: fontSizes.sm, paddingVertical: spacing[2], paddingHorizontal: spacing[4], minHeight: 40 },
  lg: { fontSize: fontSizes.md, paddingVertical: spacing[3], paddingHorizontal: spacing[5], minHeight: 48 },
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  busy = false,
  iconLeft,
  iconRight,
  children,
  onPress,
  style,
  accessibilityLabel,
  testID,
  wrapLabel = false,
  pressableRef,
}: ButtonProps) {
  const colors = useColors();
  const sz = sizeConfig[size];

  const variantStyle = (): { backgroundColor: string; color: string; borderColor: string } => {
    switch (variant) {
      case 'primary':
        return { backgroundColor: colors.primary, color: colors.primaryForeground, borderColor: 'transparent' };
      case 'accent':
        return { backgroundColor: colors.accent, color: colors.accentForeground, borderColor: 'transparent' };
      case 'secondary':
        return { backgroundColor: colors.secondary, color: colors.secondaryForeground, borderColor: colors.border };
      case 'ghost':
        return { backgroundColor: 'transparent', color: colors.primary, borderColor: 'transparent' };
    }
  };
  const v = variantStyle();

  return (
    <Pressable
      ref={pressableRef}
      onPress={disabled || busy ? undefined : onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.base,
        variant === 'ghost' ? undefined : shadows.sm,
        {
          backgroundColor: v.backgroundColor,
          borderColor: v.borderColor,
          borderWidth: variant === 'secondary' ? 1.5 : 0,
          paddingVertical: sz.paddingVertical,
          paddingHorizontal: sz.paddingHorizontal,
          minHeight: sz.minHeight,
          width: block ? '100%' : undefined,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          transform: pressed && !disabled ? [{ scale: 0.98 }] : [{ scale: 1 }],
        },
        style,
      ]}
    >
      {iconLeft ? <View style={styles.icon}>{iconLeft}</View> : null}
      {isTextChildren(children) ? (
        <Text
          style={[
            styles.label,
            { fontSize: sz.fontSize, color: v.color },
            wrapLabel && styles.wrapLabel,
          ]}
          numberOfLines={wrapLabel ? undefined : 1}
        >
          {children}
        </Text>
      ) : (
        children
      )}
      {iconRight ? <View style={styles.icon}>{iconRight}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: radii.pill,
  },
  label: {
    fontFamily: fonts.displaySemiBold,
  },
  wrapLabel: { flexShrink: 1, textAlign: 'center' },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
