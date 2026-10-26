// The dashboard's colours and typeface, as CSS variables (SYC-579). They are
// the app's own Purropolis palette (artifacts/cat-spotter/constants/colors.ts):
// Aegean blue on whitewash, Inter, and the same dark Aegean night. Every
// colour in a dashboard stylesheet is one of these variables, never a
// literal, so the light and dark themes stay in step.
//
// Two values differ from the app on purpose, for contrast on small text:
// links and outlined buttons use Aegean 700 (#135f92, 6:1 on the page)
// where the app uses 600, and filled buttons stay Aegean 600 in the dark
// theme too, so white text on them still passes AA (4.7:1).

/** The light theme: the default, and always used for print. */
export const LIGHT_TOKENS =
  "--page:#f4f2ec;--card:#fefcf7;--card-quiet:#f9f7f2;--sunk:#e9edf0;" +
  "--ink:#1b2a38;--ink-2:#2c3e4f;--muted:#5a6b7c;" +
  "--line:#d7dee4;--line-strong:#75838f;" +
  "--accent:#1c77c3;--accent-hover:#135f92;--accent-text:#135f92;--accent-strong:#0f4a72;--accent-soft:#e8f4fc;--on-accent:#fefcf7;" +
  "--danger:#a3401f;--danger-fill:#b8552f;--danger-soft:#fbe8de;" +
  "--warn-line:#d99413;--warn-soft:#fff5df;--warn-ink:#6b4a00;" +
  "--ok:#5f6f36;--ok-soft:#eef1e0;--ok-ink:#3f4a22;" +
  // Issues (SYC-579 decision 4): dark slate, so they never read as a button.
  "--issue:#2c3e4f;--issue-soft:#e9edf0;" +
  // A sighting trail on a map: maps are always light paper.
  "--trail:#1a56a6;" +
  "--mark-sterilised:#0f4a72;--mark-probably:#1c77c3;--mark-not_known:#2f92dc;--mark-not_sterilised:#b8552f;" +
  "color-scheme:light";

/** The dark theme: the app's night Aegean, used when the device asks for dark. */
export const DARK_TOKENS =
  "--page:#071e30;--card:#0a3350;--card-quiet:#0c2c45;--sunk:#0f4a72;" +
  "--ink:#fefcf7;--ink-2:#e9edf0;--muted:#b6c2cc;" +
  "--line:#1c5a85;--line-strong:#8c9caa;" +
  "--accent:#1c77c3;--accent-hover:#135f92;--accent-text:#7cc0ef;--accent-strong:#a3d1f2;--accent-soft:#0c3b5d;--on-accent:#fefcf7;" +
  "--danger:#f2a487;--danger-fill:#b8552f;--danger-soft:#3a1d10;" +
  "--warn-line:#ffc94d;--warn-soft:#33270c;--warn-ink:#ffe0a0;" +
  "--ok:#b5c47f;--ok-soft:#20290f;--ok-ink:#cbd6a8;" +
  "--issue:#5a6b7c;--issue-soft:#13283a;" +
  "--mark-sterilised:#e8f4fc;--mark-probably:#66b2e8;--mark-not_known:#2f92dc;--mark-not_sterilised:#ee9070;" +
  "color-scheme:dark";

/**
 * Things drawn with fixed colours stay on light paper in the dark theme:
 * the maps (their pictures are light), the report charts (drawn in ink on
 * white) and the coverage map. Their boxes take the light tokens back.
 */
export const PAPER_SELECTORS = [".chartbox", ".leaflet-container", ".map", ".mapwrap", ".catmap", ".planmap"];

export const FONT_STACK = '"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

/** Inter's three files, by script; `url` gives each one's served address (null: not available, fall back). */
export function fontFaces(url: (name: "inter-latin.woff2" | "inter-latin-ext.woff2" | "inter-greek.woff2") => string | null): string {
  const face = (name: "inter-latin.woff2" | "inter-latin-ext.woff2" | "inter-greek.woff2", range: string) => {
    const href = url(name);
    return href
      ? `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(${href}) format("woff2");unicode-range:${range}}`
      : "";
  };
  // The unicode ranges are Fontsource's own for these three files.
  return (
    face("inter-latin.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD") +
    face("inter-latin-ext.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF") +
    face("inter-greek.woff2", "U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF")
  );
}

/** The variables for every page: light by default, dark when asked, light paper for maps and charts, light on paper when printed. */
export const THEME_CSS =
  `:root{${LIGHT_TOKENS}}` +
  `@media screen and (prefers-color-scheme:dark){:root{${DARK_TOKENS}}${PAPER_SELECTORS.join(",")}{${LIGHT_TOKENS};color:var(--ink)}}`;
