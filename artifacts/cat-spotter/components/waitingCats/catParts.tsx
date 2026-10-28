/**
 * SYC-772 (spec §3.1): the shapes the six topic drawings share, shape for
 * shape from docs/specs/assets/while-we-look/topic-*.svg. Each takes the
 * coat colour, as the drawn cat in components/coat/DrawnCat.tsx does.
 */
import React from 'react';
import { Circle, Ellipse, G, Path, Polygon, Rect } from 'react-native-svg';

export const OUTLINE = '#3b3934';
export const EAR_LEFT = '57,46 59,17 78,34';
export const EAR_RIGHT = '103,46 101,17 82,34';
export const EAR_CLIPPED = '103,46 102,27 93,24 82,34';
export const TAIL_D = 'M112 138 Q150 140 147 102 Q145 84 133 87 Q139 102 136 114 Q131 128 110 127 Z';

/** The 2-wide outline group the drawings wrap their coloured parts in. */
export function Outlined({ fill, id, children }: { fill: string; id?: string; children: React.ReactNode }) {
  return (
    <G stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round">
      <G id={id} fill={fill}>
        {children}
      </G>
    </G>
  );
}

export function Tail({ fill, d = TAIL_D }: { fill: string; d?: string }) {
  return <Path id="tail" d={d} fill={fill} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />;
}

export function Body({ fill }: { fill: string }) {
  return (
    <Outlined fill={fill} id="body">
      <Ellipse cx={80} cy={113} rx={40} ry={35} />
      <Rect x={60} y={118} width={14} height={32} rx={7} />
      <Rect x={86} y={118} width={14} height={32} rx={7} />
    </Outlined>
  );
}

/** The white chest and paws. */
export function Belly() {
  return (
    <G fill="#fbfaf6">
      <Ellipse cx={80} cy={100} rx={15} ry={22} />
      <Ellipse cx={67} cy={146} rx={9} ry={6} />
      <Ellipse cx={93} cy={146} rx={9} ry={6} />
    </G>
  );
}

export function Head({
  fill,
  leftEar = true,
  rightEar = EAR_RIGHT,
}: {
  fill: string;
  leftEar?: boolean;
  /** The right ear's points; the clipped tip is `EAR_CLIPPED`. */
  rightEar?: string;
}) {
  return (
    <Outlined fill={fill} id="head">
      {leftEar && <Polygon id="ear-left" points={EAR_LEFT} />}
      <Polygon id={rightEar === EAR_CLIPPED ? 'ear-clipped' : 'ear-right'} points={rightEar} />
      <Circle cx={80} cy={58} r={26} />
    </Outlined>
  );
}

export function Eyes({ rim = '#2b2b2b' }: { rim?: string }) {
  return (
    <G id="eyes">
      <Ellipse cx={70} cy={56} rx={4} ry={5} fill="#c8d65a" stroke={rim} strokeWidth={1} />
      <Ellipse cx={90} cy={56} rx={4} ry={5} fill="#c8d65a" stroke={rim} strokeWidth={1} />
      <Ellipse cx={70} cy={56} rx={1.4} ry={3.5} fill="#1d1d1d" />
      <Ellipse cx={90} cy={56} rx={1.4} ry={3.5} fill="#1d1d1d" />
    </G>
  );
}

export function Nose() {
  return <Polygon id="nose" points="76,66 84,66 80,71" fill="#d98a94" stroke="#2b2b2b" strokeWidth={1} />;
}

/** The whole cat, still, for the mother and kitten in topic 2. */
export function WholeCat({ fill, belly = false }: { fill: string; belly?: boolean }) {
  return (
    <>
      <Tail fill={fill} />
      <Body fill={fill} />
      {belly && <Belly />}
      <Head fill={fill} />
      <Eyes />
      <Nose />
    </>
  );
}
