import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { fonts, shadows, borderWidths } from '@/constants/theme';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  src?: string;
  /** Used for the alt/accessibility label and the initial fallback. */
  name: string;
  size?: AvatarSize;
  /** Aegean ring around the avatar. */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
}

const sizes: Record<AvatarSize, number> = { sm: 28, md: 40, lg: 56, xl: 80 };

export function Avatar({ src, name, size = 'md', ring, style }: AvatarProps) {
  const colors = useColors();
  const d = sizes[size];

  return (
    <View
      style={[
        styles.base,
        shadows.xs,
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          backgroundColor: palette.aegean200,
          borderWidth: ring ? borderWidths.thick : 0,
          borderColor: ring ? colors.primary : 'transparent',
        },
        style,
      ]}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          accessibilityLabel={name}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      ) : (
        <Text style={[styles.initial, { fontSize: d * 0.42, color: palette.aegean800 }]}>
          {name.trim().charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: fonts.displaySemiBold,
  },
});
