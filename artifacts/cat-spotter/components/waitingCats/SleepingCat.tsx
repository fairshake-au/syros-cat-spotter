/** SYC-772 (spec §3.1): the sleeping cat at the end of a full bar. Port of progress-sleeping-cat.svg. */
import React from 'react';
import { Circle, Ellipse, G, Path, Polygon } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
import { HiddenPicture, Layer } from './Layer';
import { MOTIONS } from './keyframes';
import { loopStyle, pivotOrigin, type ViewBox } from './motion';

export const SLEEPING_VIEWBOX: ViewBox = { x: 0, y: 0, w: 48, h: 32 };
export const SLEEPING_CAT_ASPECT = 48 / 32;

const FUR = '#8d929a';
const OUTLINE = '#3b3934';

export function SleepingCat({ height = 24 }: { height?: number }) {
  const reduced = useReducedMotion();
  const width = height * SLEEPING_CAT_ASPECT;
  const k = height / SLEEPING_VIEWBOX.h;
  const box = { width, height, viewBox: SLEEPING_VIEWBOX };
  const loop = (name: keyof typeof MOTIONS) =>
    loopStyle(MOTIONS[name].keyframes(k), MOTIONS[name].periodMs, { reduced });
  return (
    <HiddenPicture width={width} height={height} testID="sleeping-cat">
      {/* sleeper: breathes, scaleY 1..1.05 about 24,28 */}
      <Layer
        {...box}
        name="sleeper"
        style={[{ transformOrigin: pivotOrigin(24, 28, SLEEPING_VIEWBOX) }, loop('breathe')]}
      >
        <G stroke={OUTLINE} strokeWidth={1.2} strokeLinejoin="round" fill={FUR}>
          <Ellipse cx={24} cy={22} rx={17} ry={8} />
          <Path d="M8 24 Q6 30 18 30 Q32 30 38 26" fill="none" strokeWidth={4} strokeLinecap="round" stroke={FUR} />
          <Polygon points="31,13 33,7 36,13" />
          <Polygon points="36,13 40,8 40,15" />
          <Circle cx={35} cy={18} r={6} />
        </G>
      </Layer>
      <Layer {...box}>
        <Path d="M32 18 Q33.5 19.5 35 18 M36.5 18 Q38 19.5 39.5 18" stroke={OUTLINE} strokeWidth={1} fill="none" />
      </Layer>
      {/* z: drifts up and fades */}
      <Layer {...box} name="z" style={loop('zDrift')}>
        <Path
          id="z"
          d="M39 3 L44 3 L39 8 L44 8"
          fill="none"
          stroke="#1c77c3"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Layer>
    </HiddenPicture>
  );
}
