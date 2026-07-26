/**
 * Purropolis theme constants for React Native — typography, spacing,
 * radii and shadows translated from the web CSS tokens.
 */

/** Font families (loaded in app/_layout.tsx via @expo-google-fonts). */
export const fonts = {
  /** Poppins — display / headings / big numbers */
  displayMedium: 'Poppins_500Medium',
  displaySemiBold: 'Poppins_600SemiBold',
  displayBold: 'Poppins_700Bold',
  /** Nunito — body / UI text */
  body: 'Nunito_400Regular',
  bodySemiBold: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
  bodyExtraBold: 'Nunito_800ExtraBold',
  /** Space Mono — catalog IDs & data */
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const;

/** Type scale (px). */
export const fontSizes = {
  '3xs': 11,
  '2xs': 12,
  xs: 13,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 36,
  '4xl': 48,
} as const;

/** 4px spacing grid. */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 40,
  8: 48,
  9: 64,
} as const;

/** Corner radii — generous & friendly. */
export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  '2xl': 36,
  pill: 999,
} as const;

/** Soft warm-tinted shadows (Aegean navy). */
export const shadows = {
  xs: {
    shadowColor: '#1b2a38',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: '#1b2a38',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#1b2a38',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;

/**
 * Letter-spacing multipliers (em), translated 1:1 from the web
 * `--tracking-*` tokens. RN's `letterSpacing` is an absolute point value,
 * so multiply by a text's fontSize at the call site, e.g.
 * `fontSizes['2xs'] * tracking.wider`.
 */
export const tracking = {
  tight: -0.02,
  normal: 0,
  wide: 0.04,
  wider: 0.12,
} as const;

/**
 * Line-height multipliers, translated 1:1 from the web `--leading-*`
 * tokens. Multiply by a text's fontSize at the call site, e.g.
 * `fontSizes.md * lineHeights.tight`.
 */
export const lineHeights = {
  tight: 1.1,
  snug: 1.25,
  normal: 1.5,
  relaxed: 1.65,
} as const;

/** Border widths, translated 1:1 from the web `--border-width*` tokens. */
export const borderWidths = {
  thin: 1.5,
  thick: 2.5,
} as const;
