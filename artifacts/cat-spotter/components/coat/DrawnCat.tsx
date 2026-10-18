import React from 'react';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Polygon, Rect } from 'react-native-svg';
import { useLanguage } from '@/context/LanguageContext';
import { COLOURS, PATTERNS, type Colour, type Pattern } from '@/lib/coat';
import { FILL, OUTLINE, UNKNOWN } from './palette';

/**
 * The drawn cat (coat-colours-and-pattern.md §3, SYC-398 PR D): one simple
 * sitting cat, a picture of a coat's answer, the same in every language. A
 * port of the team pages' drawing (api-server lib/teamPages/coatDrawing.ts,
 * PR B), shape for shape, so the app and the team see the same cat. Simple
 * shapes for Samuel's eye (Decision 5A).
 *
 * - the first colour (in display order, White last) fills the cat;
 * - each further colour is a patch;
 * - White fills the chest and paws;
 * - Stripes lays stripes over the coloured areas (White stays clear);
 * - Patches enlarges the patches, White among them.
 *
 * Only codes from the vocabulary are drawn; anything else is dropped.
 */
export interface DrawnCoat {
  colours: readonly string[] | null;
  pattern: string | null;
}

/** The coat's parts, kept to the vocabulary, colours in display order. */
function known(coat: DrawnCoat): { colours: Colour[]; pattern: Pattern | null } {
  const said = new Set(coat.colours ?? []);
  return {
    colours: COLOURS.filter((c) => said.has(c)),
    pattern: PATTERNS.find((p) => p === coat.pattern) ?? null,
  };
}

/**
 * What a screen reader hears: the colours, then the pattern (Plain said,
 * since the drawing can't say it any other way), each part "Not known" when
 * it isn't. Joined with " · " (Decision E1).
 */
export function drawnCatLabel(coat: DrawnCoat, t: (key: string) => string): string {
  const { colours, pattern } = known(coat);
  return [
    ...(colours.length ? colours.map((c) => t(`coat_${c}`)) : [t('coatNotKnown')]),
    pattern ? t(`pattern_${pattern}`) : t('coatNotKnown'),
  ].join(' · ');
}

/** Where the patches sit, in the order further colours take them. */
const SPOTS = [
  { cx: 62, cy: 104, r: 12 },
  { cx: 92, cy: 47, r: 9 },
  { cx: 101, cy: 121, r: 11 },
  { cx: 66, cy: 56, r: 7 },
  { cx: 107, cy: 98, r: 8 },
  { cx: 132, cy: 104, r: 6 },
];

/** The silhouette: tail, body, legs, head and ears. Filled, used as the clip, and drawn again as the outline. */
function Shapes() {
  return (
    <>
      <Path d="M112 138 Q150 140 147 102 Q145 84 133 87 Q139 102 136 114 Q131 128 110 127 Z" />
      <Ellipse cx="80" cy="113" rx="40" ry="35" />
      <Rect x="60" y="118" width="14" height="32" rx="7" />
      <Rect x="86" y="118" width="14" height="32" rx="7" />
      <Polygon points="57,46 59,17 78,34" />
      <Polygon points="103,46 101,17 82,34" />
      <Circle cx="80" cy="58" r="26" />
    </>
  );
}

const STRIPES =
  'M66 40 Q70 46 68 52 M80 34 L80 46 M94 40 Q90 46 92 52 ' +
  'M54 64 Q60 66 64 64 M106 64 Q100 66 96 64 ' +
  'M44 100 Q52 104 50 112 M42 116 Q50 120 50 128 ' +
  'M116 100 Q108 104 110 112 M118 116 Q110 120 110 128 ' +
  'M60 84 Q80 92 100 84 M58 132 L74 132 M86 132 L102 132 ' +
  'M140 92 L148 96 M137 106 L147 110 M128 124 L136 132';

export function DrawnCat({ coat, size = 160 }: { coat: DrawnCoat; size?: number }) {
  const { t } = useLanguage();
  const clipId = `dc-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const { colours, pattern } = known(coat);
  const nonWhite = colours.filter((c) => c !== 'white');
  const hasWhite = colours.includes('white');
  const base: Colour | null = nonWhite.length ? nonWhite[0]! : hasWhite ? 'white' : null;
  // Further colours take the spots in turn; with Patches, White joins them.
  const patchColours: Colour[] = [
    ...nonWhite.slice(1),
    ...(pattern === 'patches' && hasWhite && base !== 'white' ? (['white'] as const) : []),
  ];
  const grow = pattern === 'patches' ? 1.7 : 1;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      accessible
      accessibilityRole="image"
      accessibilityLabel={drawnCatLabel(coat, t)}
    >
      <Defs>
        <ClipPath id={clipId}>
          <Shapes />
        </ClipPath>
      </Defs>
      <G fill={base ? FILL[base] : UNKNOWN}>
        <Shapes />
      </G>
      <G clipPath={`url(#${clipId})`}>
        {patchColours.length
          ? SPOTS.map((s, i) => (
              <Circle
                key={i}
                cx={s.cx}
                cy={s.cy}
                r={Math.round(s.r * grow * 10) / 10}
                fill={FILL[patchColours[i % patchColours.length]!]}
              />
            ))
          : null}
        {pattern === 'stripes' ? (
          <Path
            d={STRIPES}
            fill="none"
            stroke={base === 'black' ? '#ffffff' : '#000000'}
            strokeOpacity={base === 'black' ? 0.3 : 0.34}
            strokeWidth={4}
            strokeLinecap="round"
          />
        ) : null}
        {hasWhite && base !== 'white' ? (
          <G fill={FILL.white}>
            <Ellipse cx="80" cy="100" rx="15" ry="22" />
            <Ellipse cx="67" cy="146" rx="9" ry="6" />
            <Ellipse cx="93" cy="146" rx="9" ry="6" />
          </G>
        ) : null}
      </G>
      <G fill="none" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" strokeDasharray={base ? undefined : '5 4'}>
        <Shapes />
      </G>
      <Ellipse cx="70" cy="56" rx="4" ry="5" fill="#c8d65a" stroke="#2b2b2b" strokeWidth={1} />
      <Ellipse cx="90" cy="56" rx="4" ry="5" fill="#c8d65a" stroke="#2b2b2b" strokeWidth={1} />
      <Ellipse cx="70" cy="56" rx="1.4" ry="3.5" fill="#1d1d1d" />
      <Ellipse cx="90" cy="56" rx="1.4" ry="3.5" fill="#1d1d1d" />
      <Polygon points="76,66 84,66 80,71" fill="#d98a94" stroke="#2b2b2b" strokeWidth={1} />
    </Svg>
  );
}
