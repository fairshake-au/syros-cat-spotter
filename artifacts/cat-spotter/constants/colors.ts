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
  // SYC-766: control outlines in dark mode (3.6:1 on cards, 4.7:1 on the page).
  aegean450: '#6a8aa6',
  aegean400: '#66b2e8',
  aegean300: '#a3d1f2',
  aegean200: '#cfe7f9',
  aegean100: '#e8f4fc',

  stone900: '#1b2a38', // ink
  stone800: '#2c3e4f',
  stone700: '#47596a',
  // SYC-509: was #667889 (4.07:1 on the page). #5a6b7c is 4.9:1 on the page,
  // 5.35:1 on cards and 4.66:1 on the sunk surface, so small muted text passes AA.
  stone600: '#5a6b7c',
  // SYC-766: a darker grey for control outlines (3.8:1 on cards, 3.5:1 on
  // the page), above the 3:1 floor for borders. Hairlines keep stone300.
  stone550: '#75838f',
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

  // SYC-766: text on sun100 (7.4:1). sun700 on sun100 is only 2.4:1.
  sun800: '#6b4a00',
  sun700: '#d99413',
  sun600: '#f5b023',
  sun500: '#ffc94d',
  sun300: '#ffe0a0',
  sun100: '#fff5df',

  // SYC-766: text on terra100 and the page (5.4:1 / 5.7:1), as the dashboard uses.
  terra800: '#a3401f',
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
    tint: palette.aegean700,

    // Core surfaces
    background: palette.stone100, // surface-page
    foreground: palette.stone900, // text-strong

    // Cards / elevated surfaces
    card: palette.stone000, // surface-card
    cardForeground: palette.stone900,

    // Primary colour for text, icons and outlines (links, active states).
    // SYC-766: aegean600 was 4.2:1 on the page; aegean700 is 6.1:1.
    primary: palette.aegean700,
    // Primary as a fill behind primaryForeground (buttons, selected chips).
    primaryFill: palette.aegean600, // 4.6:1 with white
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

    // Destructive actions (delete, error states). `destructive` is for text
    // and icons; `destructiveFill` sits behind destructiveForeground.
    // SYC-766: terra700 was 4.3:1 as text on the page; terra800 is 5.7:1.
    destructive: palette.terra800, // status-danger
    destructiveFill: palette.terra700, // 4.7:1 with white
    destructiveForeground: palette.stone000,

    // Status colors
    // SYC-766: success, danger and info are dark enough to be text on their
    // soft fills and on the page. Warning stays bright for dots and fills,
    // so its words use warningText.
    success: palette.olive700,
    successSoft: palette.olive100,
    warning: palette.sun600,
    warningText: palette.sun800,
    warningSoft: palette.sun100,
    danger: palette.terra800,
    dangerSoft: palette.terra100,
    info: palette.aegean700,
    infoSoft: palette.aegean100,

    // Borders and input outlines. `border` is for decorative hairlines;
    // `controlBorder` outlines things you can type in or tap (SYC-766).
    border: palette.stone300, // border-soft
    controlBorder: palette.stone550,
    input: palette.stone300,
  },

  dark: {
    // Legacy aliases (kept for backward compatibility)
    text: palette.stone000,
    tint: palette.aegean400,

    // Core surfaces — deep Aegean night navy with whitewash text
    background: palette.aegean950, // surface-page
    foreground: palette.stone000, // text-strong

    // Cards / elevated surfaces
    card: palette.aegean900, // surface-card
    cardForeground: palette.stone000,

    // Primary colour for text, icons and outlines (brighter aegean for navy).
    // SYC-766: aegean500 was 3.9:1 on cards; aegean400 is 5.7:1.
    primary: palette.aegean400,
    // Fills stay on aegean600 in dark mode too, as the dashboard does:
    // white on aegean500 was 3.3:1 (SYC-702).
    primaryFill: palette.aegean600,
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

    // Destructive actions (lighter terra for contrast on navy).
    // SYC-766: terra600 was 4.4:1 as text on cards and 2.9:1 under white;
    // text uses #f2a487 (6.5:1 on cards) and fills use terra700, as the dashboard does.
    destructive: '#f2a487', // status-danger (dark)
    destructiveFill: palette.terra700,
    destructiveForeground: palette.stone000,

    // Status colors (soft tints become deep night washes)
    success: palette.olive500,
    successSoft: '#20290f',
    warning: palette.sun500,
    warningText: palette.sun500,
    warningSoft: '#33270c',
    danger: '#f2a487',
    dangerSoft: '#3a1d10',
    info: palette.aegean400,
    infoSoft: '#0c3b5d',

    // Borders and input outlines
    border: palette.aegean800, // border-soft (dark)
    controlBorder: palette.aegean450,
    input: palette.aegean800,
  },

  radius: 14, // --radius-md
};

export default colors;

/**
 * Toned Tag and StatTile colours. These tints are the same in both schemes
 * (as the web DS's --*-100 ramps are), so their ink is fixed too.
 * SYC-766: sun and terra use the darker 800 inks so small labels pass 4.5:1.
 */
export const toneColors = {
  aegean: { bg: palette.aegean100, fg: palette.aegean800 },
  bougain: { bg: palette.bougain100, fg: palette.bougain700 },
  sun: { bg: palette.sun100, fg: palette.sun800 },
  terra: { bg: palette.terra100, fg: palette.terra800 },
  olive: { bg: palette.olive100, fg: palette.olive700 },
} as const;
