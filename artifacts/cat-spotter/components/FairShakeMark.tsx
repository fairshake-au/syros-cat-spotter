import React from 'react';
import Svg, { Rect } from 'react-native-svg';

/**
 * Fair Shake "Equal Stacks" mark, reversed for dark backgrounds.
 * Ported from `assets/mark-equal-stacks-white.svg` in the Purropolis design
 * project. Five muted blocks and one solid — the solid one is the point, so it
 * keeps full opacity while the rest sit at 60%.
 */
export function FairShakeMark({ size = 15 }: { size?: number }) {
  return (
    <Svg width={size} height={(size * 108) / 110} viewBox="0 0 110 108">
      <Rect x="14" y="18" width="38" height="20" rx="6" fill="#fff" fillOpacity={0.6} />
      <Rect x="14" y="44" width="38" height="20" rx="6" fill="#fff" fillOpacity={0.6} />
      <Rect x="14" y="70" width="38" height="20" rx="6" fill="#fff" fillOpacity={0.6} />
      <Rect x="58" y="18" width="38" height="20" rx="6" fill="#fff" fillOpacity={0.6} />
      <Rect x="58" y="44" width="38" height="20" rx="6" fill="#fff" fillOpacity={0.6} />
      <Rect x="58" y="70" width="38" height="20" rx="6" fill="#fff" />
    </Svg>
  );
}
