import React from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { COLOURS, type Colour } from '@/lib/coat';
import { FILL, OUTLINE } from './palette';

/**
 * A round swatch of one coat colour (coat-colours-and-pattern.md §1), or,
 * with `colour="all"`, the five colours as slices of one round: the *All*
 * chip. Decorative: the chip around it carries the word.
 */
export function ColourSwatch({ colour, size = 22 }: { colour: Colour | 'all'; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" accessible={false} importantForAccessibility="no-hide-descendants">
      {colour === 'all' ? (
        <G>
          {COLOURS.map((c, i) => (
            <Path key={c} d={slice(i, COLOURS.length)} fill={FILL[c]} />
          ))}
          <Circle cx="10" cy="10" r="8.5" fill="none" stroke={OUTLINE} strokeWidth="1.5" />
        </G>
      ) : (
        <Circle cx="10" cy="10" r="8.5" fill={FILL[colour]} stroke={OUTLINE} strokeWidth="1.5" />
      )}
    </Svg>
  );
}

/** One slice of a round of radius 8.5 at (10, 10). */
function slice(i: number, n: number): string {
  const at = (k: number) => {
    const a = (2 * Math.PI * k) / n - Math.PI / 2;
    return `${(10 + 8.5 * Math.cos(a)).toFixed(2)} ${(10 + 8.5 * Math.sin(a)).toFixed(2)}`;
  };
  return `M10 10 L${at(i)} A8.5 8.5 0 0 1 ${at(i + 1)} Z`;
}
