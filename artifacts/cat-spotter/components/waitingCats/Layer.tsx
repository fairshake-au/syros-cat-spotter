/**
 * SYC-772 (spec §3.4): one layer of a picture. An `Animated.View` fills the
 * picture and holds an `Svg` with the drawing's full viewBox, so a part sits
 * exactly where it sits in the file. A moving part gets its own layer with a
 * `transformOrigin` pivot and a CSS-animation style; still parts share
 * layers, written in drawing order.
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg from 'react-native-svg';
import type { ViewBox } from './motion';

export const SQUARE_VIEWBOX: ViewBox = { x: 0, y: 0, w: 160, h: 160 };

export function Layer({
  width,
  height,
  viewBox,
  style,
  name,
  children,
}: {
  width: number;
  height: number;
  viewBox: ViewBox;
  style?: StyleProp<ViewStyle>;
  /** The moving part's id in the drawing; also the test id. */
  name?: string;
  children?: React.ReactNode;
}) {
  return (
    <Animated.View pointerEvents="none" testID={name ? `layer-${name}` : undefined} style={[StyleSheet.absoluteFill, style]}>
      <Svg width={width} height={height} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}

/** A moving group of layers (the walking cat's bob carries its legs and body). */
export function LayerGroup({
  style,
  name,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <Animated.View pointerEvents="none" testID={name ? `layer-${name}` : undefined} style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}

/** The outer box of every picture: decoration, so screen readers skip all of it. */
export function HiddenPicture({
  width,
  height,
  testID,
  style,
  children,
}: {
  width: number;
  height: number;
  testID: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View
      testID={testID}
      aria-hidden
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ width, height }, style]}
    >
      {children}
    </View>
  );
}

/** A topic picture: the square drawing on a small light rounded plate (spec §3.4, dark mode). */
export const PLATE_COLOUR = '#fbfaf6';

export function TopicPicture({
  size,
  testID,
  children,
}: {
  size: number;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <HiddenPicture
      width={size}
      height={size}
      testID={testID}
      style={{ backgroundColor: PLATE_COLOUR, borderRadius: size * 0.18 }}
    >
      {children}
    </HiddenPicture>
  );
}
