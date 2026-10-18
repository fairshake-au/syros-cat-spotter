import React from 'react';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import type { Pattern } from '@/lib/coat';
import { FILL, OUTLINE, UNKNOWN } from './palette';

export type PatternTileKind = Pattern | 'cant_tell' | 'all';

/**
 * A small square of fur showing one pattern (coat-colours-and-pattern.md §1):
 * Plain, Stripes, Patches, "?" for Can't tell, or the three side by side for
 * the *All* chip. Decorative: the chip around it carries the word.
 */
export function PatternTile({ pattern, size = 22 }: { pattern: PatternTileKind; size?: number }) {
  // Unique per copy (several tiles share a screen), and safe in url(#…).
  const clipId = `pt-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" accessible={false} importantForAccessibility="no-hide-descendants">
      <Defs>
        <ClipPath id={clipId}>
          <Rect x="1" y="1" width="18" height="18" rx="4" />
        </ClipPath>
      </Defs>
      {pattern === 'plain' ? <Rect x="1" y="1" width="18" height="18" rx="4" fill={FILL.ginger} /> : null}
      {pattern === 'stripes' ? (
        <G>
          <Rect x="1" y="1" width="18" height="18" rx="4" fill={FILL.ginger} />
          <Path d="M5 2 Q7 10 5 18 M10 2 Q12 10 10 18 M15 2 Q17 10 15 18" stroke="#9a531c" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </G>
      ) : null}
      {pattern === 'patches' ? (
        <G>
          <Rect x="1" y="1" width="18" height="18" rx="4" fill={FILL.white} />
          <Path d="M1 5 Q1 1 5 1 L11 1 Q12 6 7 8 Q3 9 1 8 Z" fill={FILL.black} />
          <Path d="M19 11 L19 15 Q19 19 15 19 L9 19 Q8 14 13 12 Q16 10 19 11 Z" fill={FILL.ginger} />
          <Circle cx="15" cy="5" r="2.6" fill={FILL.ginger} />
          <Circle cx="5" cy="15" r="2.4" fill={FILL.black} />
        </G>
      ) : null}
      {pattern === 'cant_tell' ? (
        <G>
          <Rect x="1" y="1" width="18" height="18" rx="4" fill={UNKNOWN} />
          <Path d="M7 7.5 Q7 4.5 10 4.5 Q13 4.5 13 7.2 Q13 9 10.8 10 Q10 10.5 10 12" stroke={OUTLINE} strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <Circle cx="10" cy="15" r="1.2" fill={OUTLINE} />
        </G>
      ) : null}
      {pattern === 'all' ? (
        <G clipPath={`url(#${clipId})`}>
          <Rect x="1" y="1" width="6" height="18" fill={FILL.ginger} />
          <Rect x="7" y="1" width="6" height="18" fill={FILL.ginger} />
          <Path d="M8.5 2 Q10 6 8.5 10 Q7 14 8.5 18 M11.5 2 Q13 6 11.5 10 Q10 14 11.5 18" stroke="#9a531c" strokeWidth="1.6" fill="none" />
          <Rect x="13" y="1" width="6" height="18" fill={FILL.white} />
          <Circle cx="16" cy="6" r="2.4" fill={FILL.black} />
          <Circle cx="16" cy="14" r="2.4" fill={FILL.ginger} />
        </G>
      ) : null}
      <Rect x="1" y="1" width="18" height="18" rx="4" fill="none" stroke={OUTLINE} strokeWidth="1.5" />
    </Svg>
  );
}
