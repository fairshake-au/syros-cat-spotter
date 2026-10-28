/** SYC-772 (spec §3.1): the walking cat on the progress bar. Port of progress-walking-cat.svg; faces right. */
import React from 'react';
import { Circle, Ellipse, G, Path, Polygon, Rect } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
import { HiddenPicture, Layer, LayerGroup } from './Layer';
import { MOTIONS } from './keyframes';
import { loopStyle, pivotOrigin, type ViewBox } from './motion';

export const WALKING_VIEWBOX: ViewBox = { x: 0, y: -3, w: 48, h: 35 };
export const WALKING_CAT_ASPECT = 48 / 35;

const FUR = '#8d929a';
const OUTLINE = '#3b3934';

/** The group the drawing wraps its parts in: 1.2 outline, grey fill. */
function CatGroup({ children }: { children: React.ReactNode }) {
  return (
    <G stroke={OUTLINE} strokeWidth={1.2} strokeLinejoin="round" fill={FUR}>
      {children}
    </G>
  );
}

export function WalkingCat({ height = 24 }: { height?: number }) {
  const reduced = useReducedMotion();
  const width = height * WALKING_CAT_ASPECT;
  const k = height / WALKING_VIEWBOX.h;
  const box = { width, height, viewBox: WALKING_VIEWBOX };
  const loop = (name: keyof typeof MOTIONS) =>
    loopStyle(MOTIONS[name].keyframes(k), MOTIONS[name].periodMs, { reduced });
  const legs = (name: 'legsA' | 'legsB') => [
    { transformOrigin: pivotOrigin(24, 24, WALKING_VIEWBOX) },
    loop(name),
  ];
  return (
    <HiddenPicture width={width} height={height} testID="walking-cat">
      {/* cat: bobs, translateY 0..-1; the legs and the body ride on it */}
      <LayerGroup name="cat" style={loop('walkBob')}>
        {/* legs-a, legs-b: skewX -14..14deg about 24,24, in opposite phase; behind the body */}
        <Layer {...box} name="legs-a" style={legs('legsA')}>
          <CatGroup>
            <Rect x={12} y={20} width={4} height={9} rx={2} />
            <Rect x={30} y={20} width={4} height={9} rx={2} />
          </CatGroup>
        </Layer>
        <Layer {...box} name="legs-b" style={legs('legsB')}>
          <CatGroup>
            <Rect x={16} y={20} width={4} height={9} rx={2} />
            <Rect x={34} y={20} width={4} height={9} rx={2} />
          </CatGroup>
        </Layer>
        <Layer {...box}>
          <CatGroup>
            <Path id="tail" d="M10 16 Q2 12 4 4" fill="none" strokeWidth={3} strokeLinecap="round" stroke={FUR} />
            <Ellipse cx={24} cy={17} rx={15} ry={7} />
            <Polygon points="36,7 37,0 41,5" />
            <Polygon points="42,6 45,0 46,8" />
            <Circle cx={40} cy={11} r={7} />
            <Circle id="eye" cx={42} cy={10} r={1.2} fill="#1d1d1d" stroke="none" />
          </CatGroup>
        </Layer>
      </LayerGroup>
    </HiddenPicture>
  );
}
