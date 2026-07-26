import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { shadows } from '@/constants/theme';

export type IconButtonVariant = 'soft' | 'solid' | 'ghost' | 'accent';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Accessible label — required (icon-only control). */
  label: string;
  disabled?: boolean;
  onPress?: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const sizes: Record<IconButtonSize, number> = { sm: 32, md: 40, lg: 48 };

export function IconButton({
  variant = 'soft',
  size = 'md',
  label,
  disabled = false,
  onPress,
  children,
  style,
}: IconButtonProps) {
  const colors = useColors();
  const d = sizes[size];

  const variantStyle = (): { backgroundColor: string } => {
    switch (variant) {
      case 'soft':
        return { backgroundColor: colors.secondary };
      case 'solid':
        return { backgroundColor: colors.primary };
      case 'ghost':
        return { backgroundColor: 'transparent' };
      case 'accent':
        return { backgroundColor: colors.accent };
    }
  };
  const v = variantStyle();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        variant === 'ghost' ? undefined : shadows.xs,
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: v.backgroundColor,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          transform: pressed && !disabled ? [{ scale: 0.94 }] : [{ scale: 1 }],
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
