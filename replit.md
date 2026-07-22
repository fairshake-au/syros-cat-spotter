# Syros Cat Spotter

## Overview
A mobile app (Expo) for tourists and residents of Syros, Greece to identify and catalog unique street cats. Users photograph cats; AI vision matching compares the photo against known cats and returns likelihood scores. Users confirm a match or name/register a new cat. Gamified with points (10 per confirmed sighting, 50 per new cat) and badges. Anonymous per-device identity (no accounts). Trilingual UI: English, Greek, French. Works offline: cats catalog is cached and sightings are queued, then matched on reconnect.

## Architecture
- `artifacts/cat-spotter` — Expo app (expo-router, 4 tabs: Map, Cats, Spot, Profile; plus `cat/[id]` and `review` screens).
  - `context/` — Language (i18n + AsyncStorage), Device (anonymous device id), Offline (NetInfo + queued sightings sync).
  - `components/AppMap.tsx` / `AppMap.web.tsx` — platform-split map: react-native-maps (pinned 1.18.0) on native, OpenStreetMap iframe fallback on web (react-native-maps does not bundle on web).
  - Photos resized to 900px / JPEG 0.7 before upload (base64).
- `artifacts/api-server` — Express API. Routes: cats, photos (serves images from Postgres), sightings (AI matching + resolve), profiles/leaderboard. Badges computed server-side from stats (`lib/badges.ts`).
- AI matching: `artifacts/api-server/src/lib/matching.ts` — Replit AI Integrations OpenAI proxy, vision model `gpt-5.6-terra`, compares submitted photo against up to 10 nearest cats, returns JSON confidences.
- `lib/api-spec/openapi.yaml` — API contract; regen with `pnpm --filter @workspace/api-spec run codegen`.
- `lib/db` — Drizzle schema: photos (base64 in Postgres), cats, sightings, profiles.

## User preferences
- Goal is Apple + Android app-store publication; keep app.json static and store-ready (no EAS commands from agent; Replit Expo Launch is iOS-only).
