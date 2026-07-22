/**
 * Syros Cat Spotter — Aegean palette.
 * Deep Aegean blue + Cycladic white + warm terracotta accents.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#1C2733',
    tint: '#1B6CA8',

    // Core surfaces
    background: '#FDFBF7',
    foreground: '#1C2733',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#1C2733',

    // Primary action color (buttons, links, active states)
    primary: '#1B6CA8',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#EAF2F8',
    secondaryForeground: '#1B4965',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#F0EDE6',
    mutedForeground: '#6B7684',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#E0704A',
    accentForeground: '#FFFFFF',

    // Destructive actions (delete, error states)
    destructive: '#D64545',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#E5E0D5',
    input: '#E5E0D5',
  },

  radius: 14,
};

export default colors;
