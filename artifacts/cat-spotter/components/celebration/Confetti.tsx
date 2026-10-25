import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, Platform, StyleSheet, View } from 'react-native';
import { palette } from '@/constants/colors';

const COLORS = [palette.sun500, palette.bougain500, palette.olive500, palette.terra500, palette.aegean300];
const PIECES = 28;

// Fixed, not random, so a celebration looks the same every render.
const pieces = Array.from({ length: PIECES }, (_, i) => ({
  left: ((i * 37) % 100) + 0.5,
  delay: (i % 7) * 110 + (i % 3) * 40,
  duration: 2200 + (i % 5) * 220,
  color: COLORS[i % COLORS.length],
  spin: i % 2 === 0 ? 540 : -540,
}));

function Piece({ piece, height }: { piece: (typeof pieces)[number]; height: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      delay: piece.delay,
      duration: piece.duration,
      easing: Easing.linear,
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [progress, piece]);
  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: `${piece.left}%`,
          backgroundColor: piece.color,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-20, height + 20] }) },
            { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.spin}deg`] }) },
          ],
        },
      ]}
    />
  );
}

/** One burst of falling confetti over the whole screen. Touches pass through. */
export function Confetti() {
  const height = Dimensions.get('window').height;
  return (
    <View testID="confetti" pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Piece key={i} piece={p} height={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', top: 0, width: 8, height: 14, borderRadius: 2 },
});
