import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { useColors } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
import { shadows } from '@/constants/theme';

/**
 * SYC-781: the Spot tab's raised camera. It is the tab's icon, so the tab keeps
 * its label, role, badge and full-height tap area. Liquid Glass bars can't draw it.
 */
export function RaisedSpotIcon({ isDark }: { isDark: boolean }) {
  const colors = useColors();
  return (
    <View
      testID="spot-tab-raised"
      style={[
        styles.raised,
        { backgroundColor: colors.accent },
        // The pink is 2.8:1 on the dark bar, so dark mode rings it in white.
        isDark
          ? { borderColor: palette.stone000, borderWidth: 2 }
          : { borderColor: colors.background, borderWidth: 3 },
      ]}
    >
      {Platform.OS === 'ios' ? (
        <SymbolView name="camera.fill" tintColor={colors.accentForeground} size={26} />
      ) : (
        <Feather name="camera" size={24} color={colors.accentForeground} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  raised: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
});
