/**
 * SYC-505: passport-style "Spotted" stamp, laid over the photo on a cat card
 * the phone has spotted. Decoration only: the card's label carries the fact.
 * Same in light and dark mode.
 */
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { palette } from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';

const INK = palette.terra700;

export function SpottedStamp() {
  const { t } = useLanguage();
  return (
    <View
      testID="spotted-stamp"
      pointerEvents="none"
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={styles.stamp}
    >
      <View style={styles.innerRing} />
      <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}>
        <Ellipse cx={12} cy={16} rx={5} ry={4.2} fill={INK} />
        <Circle cx={5.8} cy={10.5} r={2.1} fill={INK} />
        <Circle cx={9.5} cy={6.4} r={2.2} fill={INK} />
        <Circle cx={14.5} cy={6.4} r={2.2} fill={INK} />
        <Circle cx={18.2} cy={10.5} r={2.1} fill={INK} />
      </Svg>
      <View style={styles.band}>
        <Text
          style={styles.bandText}
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
          {...(Platform.OS !== 'web'
            ? { adjustsFontSizeToFit: true, minimumFontScale: 0.75 }
            : {})}
        >
          {t('catSpottedStamp')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stamp: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: INK,
    backgroundColor: 'rgba(254,252,247,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    transform: [{ rotate: '-14deg' }],
  },
  innerRing: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: INK,
  },
  band: {
    backgroundColor: INK,
    borderRadius: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandText: {
    color: '#ffffff',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
  },
});
