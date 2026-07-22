/**
 * Syros Cat Spotter — Purropolis design system.
 * Sun-bleached Cycladic palette: Aegean blue + whitewash walls, with
 * bougainvillea, sun, terracotta and olive accents.
 * Mirrors the CSS tokens in the Canvas app (theme/purropolis/tokens/colors.css).
 */

/** Raw Purropolis palette (base ramps). */
export const palette = {
  aegean950: '#071e30', // deep night Aegean (dark-mode page)
  aegean900: '#0a3350',
  aegean800: '#0f4a72',
  aegean700: '#135f92',
  aegean600: '#1c77c3', // primary
  aegean500: '#2f92dc',
  aegean400: '#66b2e8',
  aegean300: '#a3d1f2',
  aegean200: '#cfe7f9',
  aegean100: '#e8f4fc',

  stone900: '#1b2a38', // ink
  stone800: '#2c3e4f',
  stone700: '#47596a',
  stone600: '#667889',
  stone500: '#8c9caa',
  stone400: '#b6c2cc',
  stone300: '#d7dee4',
  stone200: '#e9edf0',
  stone100: '#f4f2ec', // warm whitewash
  stone000: '#fefcf7', // paper white

  bougain700: '#b02f66',
  bougain600: '#d64185',
  bougain500: '#e8558a',
  bougain300: '#f6a9c8',
  bougain100: '#fce4ee',

  sun700: '#d99413',
  sun600: '#f5b023',
  sun500: '#ffc94d',
  sun300: '#ffe0a0',
  sun100: '#fff5df',

  terra700: '#b8552f',
  terra600: '#e07856',
  terra500: '#ee9070',
  terra300: '#f6c2ac',
  terra100: '#fbe8de',

  olive700: '#5f6f36',
  olive600: '#7f9349',
  olive500: '#9fb168',
  olive300: '#cbd6a8',
  olive100: '#eef1e0',
} as const;

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: palette.stone900,
    tint: palette.aegean600,

    // Core surfaces
    background: palette.stone100, // surface-page
    foreground: palette.stone900, // text-strong

    // Cards / elevated surfaces
    card: palette.stone000, // surface-card
    cardForeground: palette.stone900,

    // Primary action color (buttons, links, active states)
    primary: palette.aegean600,
    primaryForeground: palette.stone000, // text-on-primary

    // Secondary / less-emphasis interactive surfaces
    secondary: palette.aegean100, // color-primary-soft
    secondaryForeground: palette.aegean800,

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: palette.stone200, // surface-sunk
    mutedForeground: palette.stone600, // text-muted

    // Accent highlights (badges, selected items, focus rings)
    accent: palette.bougain500,
    accentForeground: palette.stone000,

    // Highlight (marigold sun)
    highlight: palette.sun500,

    // Destructive actions (delete, error states)
    destructive: palette.terra700, // status-danger
    destructiveForeground: palette.stone000,

    // Status colors
    success: palette.olive600,
    successSoft: palette.olive100,
    warning: palette.sun600,
    warningSoft: palette.sun100,
    danger: palette.terra700,
    dangerSoft: palette.terra100,
    info: palette.aegean500,
    infoSoft: palette.aegean100,

    // Borders and input outlines
    border: palette.stone300, // border-soft
    input: palette.stone300,
  },

  dark: {
    // Legacy aliases (kept for backward compatibility)
    text: palette.stone000,
    tint: palette.aegean500,

    // Core surfaces — deep Aegean night navy with whitewash text
    background: palette.aegean950, // surface-page
    foreground: palette.stone000, // text-strong

    // Cards / elevated surfaces
    card: palette.aegean900, // surface-card
    cardForeground: palette.stone000,

    // Primary action color (brighter aegean for contrast on navy)
    primary: palette.aegean500,
    primaryForeground: palette.stone000, // text-on-primary

    // Secondary / less-emphasis interactive surfaces
    secondary: palette.aegean800, // color-primary-soft (dark)
    secondaryForeground: palette.aegean200,

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: palette.aegean800, // surface-sunk (dark)
    mutedForeground: palette.stone400, // text-muted (dark)

    // Accent highlights (badges, selected items, focus rings)
    accent: palette.bougain500,
    accentForeground: palette.stone000,

    // Highlight (marigold sun)
    highlight: palette.sun500,

    // Destructive actions (lighter terra for contrast on navy)
    destructive: palette.terra600, // status-danger (dark)
    destructiveForeground: palette.stone000,

    // Status colors (soft tints become deep night washes)
    success: palette.olive500,
    successSoft: '#20290f',
    warning: palette.sun500,
    warningSoft: '#33270c',
    danger: palette.terra600,
    dangerSoft: '#3a1d10',
    info: palette.aegean400,
    infoSoft: '#0c3b5d',

    // Borders and input outlines
    border: palette.aegean800, // border-soft (dark)
    input: palette.aegean800,
  },

  radius: 14, // --radius-md
};

export default colors;
