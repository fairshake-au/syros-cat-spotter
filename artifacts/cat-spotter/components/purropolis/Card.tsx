import React from 'react';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { radii, spacing, shadows, borderWidths } from '@/constants/theme';

export interface CardProps {
  /**
   * Elevate on interaction. The web component lifts on mouse hover; RN has
   * no hover, so this elevates on press instead. Only meaningful when
   * `onPress` is also given.
   */
  hover?: boolean;
  /** No shadow, border only. */
  flat?: boolean;
  /** Padding (px); defaults to spacing[5] (24). */
  padding?: number;
  onPress?: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ hover, flat, padding, onPress, children, style }: CardProps) {
  const colors = useColors();
  const basePadding = padding ?? spacing[5];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          {
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            borderWidth: borderWidths.thin,
            borderColor: flat ? colors.border : 'transparent',
            padding: basePadding,
          },
          flat ? undefined : hover && pressed ? shadows.md : shadows.sm,
          hover && pressed ? { transform: [{ translateY: -2 }] } : undefined,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radii.lg,
          borderWidth: borderWidths.thin,
          borderColor: flat ? colors.border : 'transparent',
          padding: basePadding,
        },
        flat ? undefined : shadows.sm,
        style,
      ]}
    >
      {children}
    </View>
  );
}
