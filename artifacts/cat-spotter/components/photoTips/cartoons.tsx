import React from 'react';
import Svg, { ClipPath, Defs, Ellipse, G, Path, Rect, Circle } from 'react-native-svg';

/**
 * The four photo-tip cartoons (SYC-415 spec §3.1), ported element by element
 * from docs/specs/assets/photo-tips/*.svg. They are drawn in code, not fetched,
 * so they work with no signal (spec §3.5). They contain no words; each carries
 * a spoken description from the caller (spec §3.4).
 */
interface CartoonProps {
  size: number;
  /** The spoken description. Callers pass t('cartoon…Label'). */
  label: string;
}

/** A clip-path id that is unique per copy (two can be on screen at once) and safe in url(#…). */
function useClipId(prefix: string): string {
  const raw = React.useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function GoodPhotoCartoon({ size, label }: CartoonProps) {
  const clipId = useClipId('good-frame');
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Defs>
        <ClipPath id={clipId}>
          <Rect x="10" y="10" width="280" height="280" rx="22" />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        <Rect x="10" y="10" width="280" height="280" fill="#f4f2ec" />
        <Rect x="10" y="215" width="280" height="75" fill="#d7dee4" />
        <Rect x="200" y="30" width="70" height="185" rx="35" fill="#a3d1f2" />
        <Circle cx="60" cy="55" r="18" fill="#ffe0a0" />
        {/* tail */}
        <Path
          d="M205 238 C 255 238, 262 200, 240 178"
          fill="none"
          stroke="#e07856"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* body */}
        <Ellipse cx="150" cy="200" rx="68" ry="52" fill="#e07856" />
        <Path
          d="M110 170 q8 18 0 36 M135 160 q8 22 0 46 M190 168 q-8 20 0 40"
          stroke="#b8552f"
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
        />
        {/* front legs */}
        <Rect x="118" y="215" width="22" height="42" rx="11" fill="#e07856" />
        <Rect x="160" y="215" width="22" height="42" rx="11" fill="#e07856" />
        <Ellipse cx="129" cy="256" rx="14" ry="7" fill="#fefcf7" />
        <Ellipse cx="171" cy="256" rx="14" ry="7" fill="#fefcf7" />
        {/* head */}
        <Path d="M102 92 L112 44 L140 78 Z" fill="#e07856" />
        <Path d="M198 92 L188 44 L160 78 Z" fill="#e07856" />
        <Path d="M110 84 L115 58 L130 76 Z" fill="#f6a9c8" />
        <Path d="M190 84 L185 58 L170 76 Z" fill="#f6a9c8" />
        <Circle cx="150" cy="112" r="52" fill="#e07856" />
        <Path
          d="M150 62 v16 M136 66 l4 14 M164 66 l-4 14"
          stroke="#b8552f"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <Ellipse cx="150" cy="132" rx="26" ry="18" fill="#fefcf7" />
        <Ellipse cx="130" cy="108" rx="9" ry="11" fill="#1b2a38" />
        <Ellipse cx="170" cy="108" rx="9" ry="11" fill="#1b2a38" />
        <Circle cx="133" cy="104" r="3" fill="#fefcf7" />
        <Circle cx="173" cy="104" r="3" fill="#fefcf7" />
        <Path d="M144 124 h12 l-6 7 z" fill="#d64185" />
        <Path
          d="M150 131 q-6 8 -12 4 M150 131 q6 8 12 4"
          stroke="#1b2a38"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M118 128 h-26 M118 135 l-24 6 M182 128 h26 M182 135 l24 6"
          stroke="#47596a"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </G>
      {/* viewfinder corners */}
      <Path
        d="M30 60 V30 H60 M240 30 H270 V60 M270 240 V270 H240 M60 270 H30 V240"
        fill="none"
        stroke="#fefcf7"
        strokeWidth="6"
        strokeLinecap="round"
        opacity={0.9}
      />
      <Rect x="10" y="10" width="280" height="280" rx="22" fill="none" stroke="#1b2a38" strokeWidth="4" />
      {/* tick badge */}
      <Circle cx="262" cy="262" r="30" fill="#5f6f36" stroke="#fefcf7" strokeWidth="5" />
      <Path
        d="M248 263 l10 10 l19 -21"
        fill="none"
        stroke="#fefcf7"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PoorPhotoCartoon({ size, label }: CartoonProps) {
  const clipId = useClipId('poor-frame');
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Defs>
        <ClipPath id={clipId}>
          <Rect x="10" y="10" width="280" height="280" rx="22" />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId})`}>
        <Rect x="10" y="10" width="280" height="280" fill="#f4f2ec" />
        <Rect x="10" y="215" width="280" height="75" fill="#d7dee4" />
        <Rect x="200" y="30" width="70" height="185" rx="35" fill="#a3d1f2" />
        <Circle cx="60" cy="55" r="18" fill="#ffe0a0" />
        {/* shadow over most of the frame */}
        <Path d="M10 10 H190 L120 290 H10 Z" fill="#1b2a38" opacity={0.35} />
        {/* tiny cat, back turned. The spec draws it blurred with an SVG filter;
            react-native-svg's filter support is partial, so it is faded instead,
            which still reads as a poor photo. */}
        <G opacity={0.55} transform="translate(60 205)">
          <Path
            d="M14 30 C -4 30, -6 14, 4 6"
            fill="none"
            stroke="#e07856"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <Ellipse cx="24" cy="28" rx="16" ry="13" fill="#e07856" />
          <Circle cx="24" cy="12" r="10" fill="#e07856" />
          <Path d="M16 7 L17 -3 L22 4 Z M32 7 L31 -3 L26 4 Z" fill="#e07856" />
        </G>
        {/* a stray thumb in the corner */}
        <Ellipse cx="282" cy="40" rx="34" ry="46" fill="#ee9070" opacity={0.85} />
      </G>
      <Rect x="10" y="10" width="280" height="280" rx="22" fill="none" stroke="#1b2a38" strokeWidth="4" />
      {/* cross badge */}
      <Circle cx="262" cy="262" r="30" fill="#b8552f" stroke="#fefcf7" strokeWidth="5" />
      <Path
        d="M250 250 l24 24 M274 250 l-24 24"
        stroke="#fefcf7"
        strokeWidth="7"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function FaceCartoon({ size, label }: CartoonProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Rect x="4" y="4" width="112" height="112" rx="16" fill="#e8f4fc" stroke="#1c77c3" strokeWidth="3" />
      <Path d="M28 50 L32 14 L54 38 Z M92 50 L88 14 L66 38 Z" fill="#e07856" />
      <Path d="M33 44 L35 24 L47 38 Z M87 44 L85 24 L73 38 Z" fill="#f6a9c8" />
      <Circle cx="60" cy="68" r="38" fill="#e07856" />
      <Path
        d="M60 30 v12 M50 33 l3 10 M70 33 l-3 10"
        stroke="#b8552f"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <Ellipse cx="60" cy="84" rx="19" ry="13" fill="#fefcf7" />
      <Ellipse cx="46" cy="66" rx="7" ry="8.5" fill="#1b2a38" />
      <Ellipse cx="74" cy="66" rx="7" ry="8.5" fill="#1b2a38" />
      <Circle cx="48" cy="63" r="2.2" fill="#fefcf7" />
      <Circle cx="76" cy="63" r="2.2" fill="#fefcf7" />
      <Path d="M55 78 h10 l-5 6 z" fill="#d64185" />
      <Path
        d="M60 84 q-5 6 -10 3 M60 84 q5 6 10 3"
        stroke="#1b2a38"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function BodyCartoon({ size, label }: CartoonProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Rect x="4" y="4" width="112" height="112" rx="16" fill="#e8f4fc" stroke="#1c77c3" strokeWidth="3" />
      <Path
        d="M22 66 C 8 60, 8 40, 18 34"
        fill="none"
        stroke="#e07856"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <Ellipse cx="54" cy="68" rx="34" ry="17" fill="#e07856" />
      <Path
        d="M40 54 q4 10 0 22 M54 52 q4 12 0 26 M68 54 q-4 10 0 22"
        stroke="#b8552f"
        strokeWidth="4.5"
        fill="none"
        strokeLinecap="round"
      />
      <Rect x="28" y="74" width="10" height="24" rx="5" fill="#e07856" />
      <Rect x="42" y="76" width="10" height="22" rx="5" fill="#e07856" />
      <Rect x="62" y="76" width="10" height="22" rx="5" fill="#e07856" />
      <Rect x="74" y="74" width="10" height="24" rx="5" fill="#e07856" />
      <Path d="M82 44 L84 26 L94 38 Z M104 46 L106 28 L96 38 Z" fill="#e07856" />
      <Circle cx="94" cy="52" r="15" fill="#e07856" />
      <Circle cx="90" cy="50" r="2.6" fill="#1b2a38" />
      <Circle cx="100" cy="50" r="2.6" fill="#1b2a38" />
      <Path d="M93 57 h4 l-2 2.5 z" fill="#d64185" />
      <Path
        d="M14 104 H106"
        stroke="#1c77c3"
        strokeWidth="2.5"
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
    </Svg>
  );
}
