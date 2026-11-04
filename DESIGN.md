---
name: Cat Spotters
description: Photo-first street-cat register for Syros, recorded as built on 4 Nov 2026 (baseline for SYC-811).
colors:
  aegean-950: "#071e30"
  aegean-900: "#0a3350"
  aegean-800: "#0f4a72"
  aegean-700: "#135f92"
  aegean-600: "#1c77c3"
  aegean-500: "#2f92dc"
  aegean-450: "#7f9cb6"
  aegean-400: "#66b2e8"
  aegean-350: "#7cc0ef"
  aegean-300: "#a3d1f2"
  aegean-200: "#cfe7f9"
  aegean-100: "#e8f4fc"
  stone-900-ink: "#1b2a38"
  stone-800: "#2c3e4f"
  stone-700: "#47596a"
  stone-600-muted: "#5a6b7c"
  stone-550-control-outline: "#75838f"
  stone-500: "#8c9caa"
  stone-400: "#b6c2cc"
  stone-300-hairline: "#d7dee4"
  stone-200-sunk: "#e9edf0"
  stone-100-whitewash: "#f4f2ec"
  stone-000-paper: "#fefcf7"
  bougainvillea-700: "#b02f66"
  bougainvillea-600: "#d64185"
  bougainvillea-500-accent: "#e8558a"
  bougainvillea-300: "#f6a9c8"
  bougainvillea-100: "#fce4ee"
  sun-800: "#6b4a00"
  sun-700: "#d99413"
  sun-600: "#f5b023"
  sun-500: "#ffc94d"
  sun-300: "#ffe0a0"
  sun-100: "#fff5df"
  terracotta-800: "#a3401f"
  terracotta-700: "#b8552f"
  terracotta-600: "#e07856"
  terracotta-500: "#ee9070"
  terracotta-300: "#f6c2ac"
  terracotta-100: "#fbe8de"
  olive-700: "#5f6f36"
  olive-600: "#7f9349"
  olive-500: "#9fb168"
  olive-300: "#cbd6a8"
  olive-100: "#eef1e0"
  dark-danger-text: "#f2a487"
  dark-success-soft: "#20290f"
  dark-warning-soft: "#33270c"
  dark-danger-soft: "#3a1d10"
  dark-info-soft: "#0c3b5d"
typography:
  display:
    fontFamily: "Inter_700Bold"
    fontSize: "42px"
    lineHeight: 1.1
  headline:
    fontFamily: "Inter_700Bold"
    fontSize: "28px"
    lineHeight: 1.1
  title:
    fontFamily: "Inter_600SemiBold"
    fontSize: "16px"
  body:
    fontFamily: "Inter_400Regular"
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: "Inter_700Bold"
    fontSize: "12px"
    letterSpacing: "0.04em"
  mono:
    fontFamily: "SpaceMono_400Regular"
    fontSize: "12px"
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  2xl: "36px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "40px"
  8: "48px"
  9: "64px"
components:
  button-primary:
    backgroundColor: "{colors.aegean-600}"
    textColor: "{colors.stone-000-paper}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
    height: "40px"
  button-accent:
    backgroundColor: "{colors.bougainvillea-500-accent}"
    textColor: "{colors.stone-000-paper}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.aegean-100}"
    textColor: "{colors.aegean-800}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-ghost:
    textColor: "{colors.aegean-700}"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.stone-000-paper}"
    textColor: "{colors.stone-900-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  cat-card:
    backgroundColor: "{colors.stone-000-paper}"
    textColor: "{colors.stone-900-ink}"
    rounded: "{rounded.md}"
    padding: "10px"
  chip:
    backgroundColor: "{colors.stone-000-paper}"
    textColor: "{colors.stone-900-ink}"
    rounded: "{rounded.pill}"
    padding: "8px 15px"
  chip-active:
    backgroundColor: "{colors.aegean-600}"
    textColor: "{colors.stone-000-paper}"
  input:
    backgroundColor: "{colors.stone-000-paper}"
    textColor: "{colors.stone-900-ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  tag-aegean:
    backgroundColor: "{colors.aegean-100}"
    textColor: "{colors.aegean-800}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  hero:
    backgroundColor: "{colors.aegean-600}"
    textColor: "{colors.stone-000-paper}"
    padding: "16px"
---

# Design System: Cat Spotters

## Overview

**Creative North Star: "The Sun-Bleached Cycladic Postcard"**

This file records the incumbent look of Cat Spotters as it is built on 4 Nov 2026. It is the baseline for SYC-811, written before any design direction is chosen. It describes what the code does, not what anyone intends. It is not a redesign and proposes nothing.

The North Star comes from the header comment in `artifacts/cat-spotter/constants/colors.ts` ("Sun-bleached Cycladic palette: Aegean blue + whitewash walls, with bougainvillea, sun, terracotta and olive accents"). The 3 Nov 2026 critique found the look generic: a blue header, a pink pill, rounded cards, emoji and puns. The words, by contrast, are made for Syros. This file records the generic parts as they stand, so a later direction can be judged against them.

There are two surfaces that share one palette and typeface but differ on purpose. The **spotter app** (Expo, `artifacts/cat-spotter`) is playful and rounded: pill buttons, 20px cards, soft shadows, a big blue hero, emoji. The **team dashboard** (server-rendered HTML, `artifacts/api-server/src/lib/teamPages`) is plainer and denser: 10px corners, 1px hairline borders, no shadows on cards, 44px tap targets, no hero.

**Key Characteristics:**
- Aegean blue (#1c77c3) as the one brand colour, on a warm whitewash page (#f4f2ec) with paper-white cards (#fefcf7).
- One typeface family, Inter, for every language; Space Mono only for catalogue IDs, dates and numbers.
- Generous radii in the app (10 to 28px, pills for every control), tighter in the dashboard.
- Bougainvillea pink (#e8558a) is the accent: the Button `accent` variant, notification dots, tab badges, the offline banner.
- Dark mode is a deep Aegean night (#071e30), not grey.

## Colors

A cool Aegean blue and warm stone-white base, with four warm accents (bougainvillea, sun, terracotta, olive) used mostly as soft tints and status colours. The full ramp is `palette` in `constants/colors.ts`. The dashboard re-states the same values as CSS variables in `tokens.ts`.

### Primary
- **Aegean 600** (#1c77c3): fills behind white text (buttons, selected chips, the Home hero, the dashboard's `--accent`). White on it measures 4.58:1.
- **Aegean 700** (#135f92): the light-mode `primary`, used for text, icons, links and outlines (6.1:1 on the page; SYC-766).
- **Aegean 350** (#7cc0ef): dark-mode `primary` text and icons (6.6:1 on cards).
- **Aegean 100 / 800** (#e8f4fc / #0f4a72): soft fill and its ink (`secondary`, info, the aegean Tag and StatTile).
- **Aegean 950 / 900** (#071e30 / #0a3350): dark-mode page and card.

### Secondary
- **Bougainvillea 500** (#e8558a): `accent`. The pink pill (Button `accent`), notification dot, tab badge, offline banner, review-success icon, map pin colour. Always drawn with `stone-000` text on it, which measures 3.36:1 (see Named Rules).
- **Bougainvillea 100 / 700** (#fce4ee / #b02f66): the bougain Tag and StatTile pair.

### Tertiary
- **Sun 500** (#ffc94d): `highlight`; the Home progress fill. **Sun 100 / 800** (#fff5df / #6b4a00) are the warning soft fill and its ink; sun 600 (#f5b023) is the warning dot.
- **Terracotta 800 / 700** (#a3401f / #b8552f): danger text and danger fill. **Terracotta 100** (#fbe8de) is the soft fill. The dashboard's "not sterilised" mark is terracotta 700.
- **Olive 700 / 100** (#5f6f36 / #eef1e0): success text and soft fill.

### Neutral
- **Whitewash** (#f4f2ec, stone 100): the page background. **Paper** (#fefcf7, stone 000): cards and text on fills.
- **Ink** (#1b2a38, stone 900): body and headings; also the shadow colour.
- **Muted** (#5a6b7c, stone 600): small secondary text (4.9:1 on the page; SYC-509).
- **Control outline** (#75838f, stone 550): outlines of things you tap or type in (SYC-766). **Hairline** (#d7dee4, stone 300): decorative borders. **Sunk** (#e9edf0, stone 200): recessed surfaces.
- Dark mode text and surfaces: stone 000 on aegean 950, muted stone 400 (#b6c2cc), borders aegean 800, control outline aegean 450 (#7f9cb6). Dark status text uses #f2a487 for danger and olive 300 for success; the soft fills (#20290f, #33270c, #3a1d10, #0c3b5d) are literals in `colors.ts` with no palette name.

### Dashboard variables (`tokens.ts`)
The dashboard maps the same palette to `--page --card --card-quiet (#f9f7f2) --sunk --ink --ink-2 --muted --line --line-strong --accent --accent-hover --accent-text --accent-strong --accent-soft --on-accent --danger --danger-fill --danger-soft --warn-line --warn-soft --warn-ink --ok --ok-soft --ok-ink --issue --issue-soft --trail --mark-*`. Values that exist only on the dashboard: `--card-quiet` #f9f7f2, `--ok-ink` #3f4a22, `--issue` #2c3e4f (dark slate so issues never read as a button), `--trail` #1a56a6 (map sighting trail). Maps, charts and the coverage map stay on light paper in dark mode (`PAPER_SELECTORS`).

### Named Rules
**The Whitewash Rule.** The page is warm stone (#f4f2ec) and cards are paper (#fefcf7); pure white is not a surface. White text on fills is `stone-000`, with a few literal `#fff` exceptions in the Home hero.
**The Two Blues Rule.** Fills use Aegean 600; text, icons and outlines use Aegean 700 (light) or Aegean 350 (dark). The split exists for contrast (SYC-766, SYC-702) and the dashboard repeats it.
**The Colour-Plus-Word Rule.** On the dashboard the four sterilisation marks (sterilised #0f4a72, probably #1c77c3 with white hatching, not known #d7dee4 with #75838f edge, not sterilised #b8552f) are always a shape and a word, never colour alone (`marks.ts`).

## Typography

**Display Font:** Inter (Inter_700Bold, Inter_600SemiBold, Inter_500Medium), system fallbacks on the dashboard.
**Body Font:** Inter (Inter_400Regular, SemiBold, Bold, ExtraBold).
**Label/Mono Font:** Space Mono (400, 700) for catalogue IDs, dates and numbers only, never translated copy.

**Character:** One family at several weights. Inter was chosen because it covers Greek, Latin and Latin Extended (French accents) in a single face; Poppins and Nunito had no Greek subset, so Greek rendered in a fallback serif (SYC-7). The dashboard serves Inter as three self-hosted woff2 files split by script (latin, latin-ext, greek) with `font-display:swap`, stack `"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`.

### Hierarchy
- **Display** (Bold 700, 42px / 46px line, white): the Home hero's "known cats spotted" figure. Scale tokens go up to 48px (`4xl`).
- **Headline** (Bold 700, 28px, line-height 1.1): StatTile values (`2xl`). Dashboard `h1` is 22px, `h2` 18px, `h3` 16px.
- **Title** (SemiBold 600, 16px; 20px Bold for the hero greeting name): button labels use SemiBold at 13/14/16px by size.
- **Body** (Regular 400, 14 to 16px, 1.5 line-height): app body text; the dashboard body is 16px/1.45.
- **Label** (Bold 700, 11 to 12px): Tags, badges, field labels (13px), eyebrow section headings (11px, letter-spacing 1.4px, uppercased in code with `displayUpperCase` so Greek drops its accents, SYC-143).

Scale (`fontSizes`): 11, 12, 13, 14, 16, 18, 22, 28, 36, 48. Tracking multipliers: tight -0.02, normal 0, wide 0.04, wider 0.12. Line-height multipliers: 1.1, 1.25, 1.5, 1.65. The spec for the dashboard (12.1) forbids text below 12px.

### Named Rules
**The One Family Rule.** Every language, every weight, one family: Inter. Space Mono is the only exception and never carries words.

## Layout

**App.** A single scrolling column on a phone: a full-bleed blue hero, then a row of three StatTiles, then sections with 16px side padding and a two-column cat grid (items 48% wide, 12px gap). Spacing is a 4px grid (4, 8, 12, 16, 24, 32, 40, 48, 64). Bottom padding clears a five-tab bar (Home, Catalogue, Spot, Help, Profile); the tab bar is 84px tall on web, blurred on iOS, solid page colour on Android and web. On iOS 26 the tabs use the native liquid-glass tab bar instead.

**Dashboard.** `main` is centred, max 1120px wide, with 12px side padding; reading columns are 736px. A one-row top menu (53px) on desktop; on a phone (under 600px) it collapses to the page name plus a "Menu" fold. Breakpoints in the stylesheet: 600px (menu), 700px and 720px (two-column facts and merge views), 1000px (three-area cat page). Tap targets are 44px minimum throughout.

**Touch.** App chips and the Home "see all" link pad to a 44pt tap area without changing visual size (SYC-644, SYC-509). Button heights are 32, 40 and 48px; the 32 and 40px sizes are below 44.

## Elevation & Depth

Hybrid. The app uses soft, ink-tinted shadows plus a 1.5px transparent border on cards; the dashboard is flat with hairline borders and uses shadow only for overflow cues and menus.

### Shadow Vocabulary
- **xs** (`#1b2a38`, opacity 0.06, radius 2, offset 0/1): defined, tiny.
- **sm** (`#1b2a38`, 0.08, radius 6, offset 0/2, elevation 2): every non-ghost Button and every Card at rest; neutral StatTile.
- **md** (`#1b2a38`, 0.10, radius 16, offset 0/6, elevation 5): a pressable Card while pressed with `hover`; the card also lifts 2px.
- **Dashboard menu** (`box-shadow:0 6px 20px rgba(0,0,0,.12)`): the row menu. The sticky Sign out has `-8px 0 8px -6px rgba(27,42,56,.22)`.

### Named Rules
**The Soft Ink Shadow Rule.** App shadows are tinted with ink #1b2a38, never pure black; the dashboard's menu shadow is a pure-black literal, a small drift.

## Shapes

Round and friendly in the app: `radii` xs 6, sm 10, md 14 (default, also `colors.radius`), lg 20 (Card, StatTile), xl 28, 2xl 36, pill 999. Every Button, Chip, Tag and Badge is a full pill. The Home hero has 30px bottom corners (a literal, not in the scale). CatCard uses `colors.radius` (14) with a 1px border and `overflow:hidden`. Inputs are 14px with a 1.5px outline that thickens to 2.5px on focus.

The dashboard uses 10px for nearly every card, input and button, 6px for photos and thumbnails, 14px for the cat-page header card, 999px for tags and filter pills. Status is carried by a 6px left border or top border on report, statement and issues blocks.

Border widths: `thin` 1.5px, `thick` 2.5px. Sterilisation marks are circles, a half-filled circle, a ring and a slashed ring; feeding sites on maps are squares, never circles (spec 12.4).

## Components

### Buttons
- **Shape:** full pill (999px) in the app; 10px radius on the dashboard.
- **Primary:** Aegean 600 fill, stone-000 label, SemiBold, sm shadow. Sizes sm/md/lg: 13/14/16px text, min height 32/40/48.
- **Accent:** bougainvillea 500 fill, stone-000 label. Used for the Home first-spot call to action and the Help screen.
- **Secondary:** Aegean 100 fill, Aegean 800 label, 1.5px hairline border. **Ghost:** transparent, Aegean 700 label, no shadow.
- **States:** pressed is 0.85 opacity and 0.98 scale; disabled is 0.5 opacity; busy blocks presses and announces "busy".
- **Dashboard:** `button.primary` is Aegean 600 fill with 1px border, 44px min height, 10px radius; outlined variants use a card fill with Aegean 800 text. Focus is a 3px `--accent` outline with 2px offset.

### Chips
- Filter pill, ~35px tall, 8px by 15px padding. Inactive is card fill with a control-outline border; active is Aegean 600 fill with white text and a primary-coloured border.

### Cards / Containers
- **Card:** paper fill, 20px radius, 1.5px border (transparent unless `flat`), 24px padding, sm shadow.
- **CatCard:** paper fill, 14px radius, 1px hairline border, square photo, 10px info padding, 15px bold name, 12px muted meta rows with Feather icons. A "has home" badge sits top-right on the photo in Aegean 600; a spotted stamp overlays spotted cats.
- **StatTile:** 20px radius, 16px padding, 120px min width, 28px bold value, 12px bold label, toned fills from `toneColors` (aegean, bougain, sun, terra, olive).
- **Dashboard:** `.catrow`, sightings and mergecols use card fill, 1px `--line` border, 10px radius.

### Inputs / Fields
- Card fill, 14px radius, 1.5px control-outline border, 14px text, bold 13px label above. Focus: primary-coloured 2.5px border. Error: danger-coloured border and helper text. Dashboard fields: 1px `--line-strong`, 10px radius, 16px text, 44px min height.

### Navigation
- App: five bottom tabs with Feather icons (SF Symbols on iOS), active tint `primary`, inactive muted, a bougainvillea badge for reviews waiting.
- Dashboard: text links in a thin top bar, current page bold with a 3px Aegean underline; phone gets a "Menu" fold.

### Hero (signature)
- The Home screen's blue band: Aegean 600 fill, 30px bottom corners, a 130px paw emoji at 12% opacity, an avatar with ring, the greeting and name with a wave emoji, a translucent white streak chip, a 42px figure, and a 12px progress track (white at 24%) with a sun 500 fill. This is the "blue header" the critique named.

### Other
- **Tag / Badge:** pill, 12px bold. Tag takes a tone; Badge has a 7px status dot and uses scheme-aware soft fills.
- **Avatar** 28/40/56/80px, Aegean 200 fill, optional 2.5px primary ring. **IconButton** 32/44/48px. **Switch** 46px wide, Aegean 600 when on, control outline when off. **ProgressBar** muted track with toned fill.

## Do's and Don'ts

### Do:
- **Do** use Aegean 600 for fills and Aegean 700 (light) or Aegean 350 (dark) for text and outlines.
- **Do** keep small text at 4.5:1 or better and control outlines at 3:1 or better (SYC-509, SYC-766).
- **Do** keep tap areas at 44px, using padding rather than `hitSlop` (web ignores it).
- **Do** pair every sterilisation mark and status colour with a word or shape.
- **Do** use "spotter", "cat guardian" and "clipped tip"; text in Greek, English and French must fit.
- **Do** respect WCAG 2.2 AA (PRODUCT.md).

### Don't:
- **Don't** put Greek text in a Latin-only face; Inter was chosen to cover it (SYC-7).
- **Don't** colour feeding sites as circles or teal on dashboard maps.
- **Don't** use `textTransform` for capitals; use `displayUpperCase` so Greek loses its accents.
- **Don't** trust the incumbent's own decoration as a rule: emoji, the pink pill and 20px cards are what is built, not a recorded requirement.

## Drift and known issues (as of 4 Nov 2026)

- **White on bougainvillea measures 3.36:1.** `accent` #e8558a with `accentForeground` stone-000 (#fefcf7) is below the 4.5:1 AA floor for normal text; it is the fill of the Button `accent` variant (16px SemiBold label on the Home call to action), tab badges (11px text) and the offline banner (text colour there not checked). Computed here, not previously recorded in code.
- **"Purropolis" is the retired name** and still appears in 46 non-test source files (comments in `constants/colors.ts`, `constants/theme.ts`, every screen under `app/(tabs)/`, and the dashboard's `tokens.ts`). The component folder is still `components/purropolis/`.
- **Spec 12.1 and 12.2 of `docs/specs/team-dashboard-redesign.md` still describe a teal palette** (#0b5c6b links, #f6f4ef page, #1d1d1b ink, marks #0a4d59 / #2f7884 / #6a949b / amber #a6540a). The dashboard shipped in Aegean (SYC-579, SYC-783); `tokens.ts` and `marks.ts` are the truth.
- **Literal colours outside the tokens:** Home hero uses `#fff` and `rgba(255,255,255,0.18/0.24)`; 30px hero radius and 15px/9px/11px literal font sizes; `SpottedStamp` uses its own ink and `rgba(254,252,247,0.55)`; dark-mode status softs are unnamed literals; drawn illustrations (`photoTips/cartoons.tsx`, `waitingCats`, `coat`, onboarding) carry many hex values by design. The dashboard has a pure-black menu shadow literal.
- **Deliberate app/dashboard differences** (`tokens.ts` header): links and outlined buttons use Aegean 700 (#135f92, 6:1) where the app's older notes used 600; filled buttons stay Aegean 600 in dark mode on both. The dashboard also adds quiet-card, issue and trail colours the app does not have.
- **Motion:** the app uses a 0.98 press scale and 2px card lift; the dashboard has almost none (one 0.2s opacity transition) and no `prefers-reduced-motion` rule.
