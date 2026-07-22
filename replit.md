# Syros Cat Spotter

## Overview
A mobile app (Expo) for tourists and residents of Syros, Greece to identify and catalog unique street cats. Users photograph cats; AI vision matching compares the photo against known cats and returns likelihood scores. Users confirm a match or name/register a new cat. Gamified with points (10 per confirmed sighting, 50 per new cat) and badges. Anonymous per-device identity (no accounts). Trilingual UI: English, Greek, French. Works offline: cats catalog is cached and sightings are queued, then matched on reconnect.

## Design system — Purropolis
- Sun-bleached Cycladic look: Aegean blue primary, whitewash/stone neutrals, bougainvillea/sun/terracotta/olive accents; Poppins (display) / Nunito (body) / Space Mono (IDs), Google Fonts with Greek subset. Wordmark set in type: 🐾 Purr·opolis ("opolis" in bougainvillea) — no logo binary.
- Web (Canvas): CSS tokens in `artifacts/mockup-sandbox/src/theme/purropolis/` (imported globally in `main.tsx`); the 12 components (Button, IconButton, Tag, Badge, Input, Switch, Card, CatCard, StatTile, ProgressBar, Avatar, TabBar) in `src/components/purropolis/`, demoed at `/preview/PurropolisShowcase`.
- Mobile: palette + semantic colors in `artifacts/cat-spotter/constants/colors.ts`; typography/spacing/radii/shadows in `constants/theme.ts`; fonts loaded via `@expo-google-fonts/{poppins,nunito,space-mono}` in `app/_layout.tsx`.

## Architecture
- `artifacts/cat-spotter` — Expo app (expo-router, 4 tabs: Map, Cats, Spot, Profile; plus `cat/[id]` and `review` screens).
  - `context/` — Language (i18n + AsyncStorage), Device (anonymous device id), Offline (NetInfo + queued sightings sync).
  - `components/AppMap.tsx` / `AppMap.web.tsx` — platform-split map: react-native-maps (pinned 1.18.0) on native, OpenStreetMap iframe fallback on web (react-native-maps does not bundle on web).
  - Offline map: `lib/offlineTiles.ts` pre-downloads OSM tiles for Syros (z11–15 island-wide, z16 Ermoupoli/Ano Syros, ~350 tiles) to FileSystem on first online launch; `components/OsmTiles.tsx` switches native maps to the local `file://` tile template once ready.
  - Location confirmation: submitting a sighting requires confirming the spot on a pan-to-pick map (`components/LocationPicker.tsx`, center-fixed pin; web fallback uses nudge arrows over an OSM iframe). Confirmed coords are used for both online submits and the offline queue.
  - Photos resized to 900px / JPEG 0.7 before upload (base64).
- `artifacts/api-server` — Express API. Routes: cats, photos (serves images from Postgres), sightings (AI matching + resolve), profiles/leaderboard. Badges computed server-side from stats (`lib/badges.ts`).
- AI matching: `artifacts/api-server/src/lib/matching.ts` — Replit AI Integrations OpenAI proxy, vision model `gpt-5.6-terra`, compares submitted photo against up to 10 nearest cats, returns JSON confidences.
- `lib/api-spec/openapi.yaml` — API contract; regen with `pnpm --filter @workspace/api-spec run codegen`.
- `lib/db` — Drizzle schema: photos (base64 in Postgres), cats, sightings, profiles.

## User preferences
- Goal is Apple + Android app-store publication; keep app.json static and store-ready (no EAS commands from agent; Replit Expo Launch is iOS-only).
