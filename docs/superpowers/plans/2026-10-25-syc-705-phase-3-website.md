# SYC-705 Phase 3: Website maps on MapLibre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The website's cats map and "where was the cat?" pin are drawn by MapLibre from our own Syros map file, with labels in the reader's language. Every behaviour they have today is kept.

**Architecture:**
- One small hook, `useMapLibre`, owns a MapLibre map inside a React Native Web view. It loads `maplibre-gl` and `pmtiles` lazily in an effect, builds the style from `@workspace/map-style`, and swaps label fields when the language changes.
- `AppMap.web.tsx` and `LocationPicker.web.tsx` keep their props, overlays, chips strip, zoom buttons and keyboard handling. Only the picture tiles and the pixel maths underneath are replaced.
- The Mercator maths moves to `lib/mercator.ts`. `lib/mapTiles.ts` is deleted.

**Tech Stack:** `maplibre-gl` 5.x and `pmtiles` 4.x (exact versions pinned, published more than a day ago), `@workspace/map-style`, Expo 54 web (Metro), Vitest with jsdom.

**Spec:** `docs/specs/map-labels-in-your-language.md` §5 Website (approved 24 Oct 2026). Parent plan: `docs/superpowers/plans/2026-10-24-syc-705-map-labels-maplibre.md` (Phase 3 outline). Inventory of today's code: `.superpowers/sdd/2026-10-24-syc-705-map-labels-maplibre/` (Explore report, 25 Oct).

**Branch:** `claude/syc-705-website-maps`, cut from `claude/google-maps-migration-8a087c` (PR #350) and stacked on it. It stays a draft until #350 merges and the first real map version is live at `tiles.catspotters.com`. Merge main in first: the flaky-tests session (SYC-597/711) edits `artifacts/cat-spotter/vitest.config.ts`.

## Global Constraints

- **Props don't change.** `AppMapProps` and `LocationPickerProps` stay exactly as they are (`components/AppMap.tsx:14-61`, `components/LocationPicker.tsx:8-14`). No caller changes except `cats.tsx` comment text.
- **Kept behaviours.** Each of these has a test today:
  - fit once per `fitKey`, with no refit on new data under the same key;
  - recentre when `latitude`/`longitude` props change, without changing zoom;
  - cells are pressable, have accessibility labels, and show their label only when at least `LABEL_MIN_PX` (40) wide;
  - "Show all" chip;
  - chips strip shown only when `markers.length > 0`;
  - zoom buttons are 44 px with translated labels, shown only when `interactive`;
  - the picker commits `onChange` once on release; tap recentres; keyboard arrows (`KEY_STEP` 32, Shift ×4) and `+`/`=`/`-`; `role="application"`; focusable; coordinate readout; it ignores the echo of its own `onChange`.
- **Zoom.** Today's zoom numbers stay the app's numbers: limits 12–19, `fitRegion`, `zoomForDelta`, `START_ZOOM` 17. They are converted only in `toMapLibreZoom(z) = z - 1` and `fromMapLibreZoom(z) = z + 1`.
- **Map language.** `MAP_LANG(language)`: `fr` and `en` get the English map; `el` gets Greek. A language change uses `labelFieldsFor` and `setLayoutProperty`, never `setStyle`.
- **Rotation and tilt.** The cats map rotates; the picker doesn't. Pitch is off on both. MapLibre's own keyboard handler is off on the picker, whose keys are ours.
- **The cat page map stays pannable and zoomable** (SYC-707). Its privacy comment stays.
- **Credit.** "© OpenStreetMap contributors" stays visible on both maps.
- **Map data address.** It comes only from `lib/mapSource.ts`. Nothing else in the app knows `tiles.catspotters.com`.
- **CI.** Draft PR, local tests, then `gh pr ready` once. Commit after every task.

## Review Focus

1. **Zoom off by one.** A fitted view must cover the same cells as today. Test: Task 3.1 "fitRegion zoom round-trips through MapLibre".
2. **Overlays drifting from the map.** Cells must sit on the right streets while dragging and after a zoom. Test: Task 3.4 "cell box follows map.project after move and zoom".
3. **No WebGL.** The page must stay usable. Tests: Task 3.4 "no WebGL shows message and keeps the strip"; Task 3.5 "no WebGL shows Use where I am now".
4. **A language change on an open map.** Labels must swap without a reload. Test: Task 3.3 "language change calls setLayoutProperty for every labelFieldsFor layer, never setStyle".
5. **`current.json` unreachable.** The map must still draw from the fallback version. Test: Task 3.2 "falls back when unreachable".

---

### Task 3.0 (only if Samuel says yes on SYC-720): quieter look

**Files:** `lib/map-style/src/adjusted.ts`, `lib/map-style/src/index.test.ts`.

- [ ] Write failing tests for:
  - minor roads not orange below zoom 14;
  - `paths` thinner below zoom 16;
  - `peak` from zoom 12;
  - the "Ano Syros" fix, a place label priority (`symbol-sort-key`) for `places_locality` above `pois`;
  - no duplicate beach/peak labels (filter the `pois` layer to exclude `beach` and `peak` kinds).
- [ ] Implement. Re-export the styles. Take before-and-after screenshots for Samuel at 390 px and desktop. Commit.

### Task 3.1: `lib/mercator.ts`

**Files:**
- Create `lib/mercator.ts`.
- Move the tests from `lib/__tests__/mapTiles.test.ts` (Mercator parts only) to `lib/__tests__/mercator.test.ts`.
- Update the import in `lib/cellShape.ts`.

**Interfaces:**
- Produces:
  - `MIN_ZOOM`, `MAX_ZOOM`, `TILE_SIZE`, `type LatLng`, `type Point`;
  - `clampZoom`, `toWorld`, `fromWorld`, `latLngAtOffset` (same signatures as today);
  - `toMapLibreZoom(z: number): number`, `fromMapLibreZoom(z: number): number`.

- [ ] Write the failing test "fitRegion zoom round-trips through MapLibre": for the Ermoupoli cells used in `cellShape.test.ts`, `fromMapLibreZoom(toMapLibreZoom(fit.zoom)) === fit.zoom`, and `toMapLibreZoom(17) === 16`.
- [ ] Move the functions. Keep `mapTiles.ts` re-exporting from `mercator.ts` until Task 3.6 deletes it.
- [ ] Run `pnpm --filter @workspace/cat-spotter test lib/__tests__/mercator.test.ts lib/__tests__/cellShape.test.ts`. Expected: PASS. Commit.
- **Mutation probe:** remove the `- 1`; the round-trip test must go red.

### Task 3.2: `lib/mapSource.ts`

**Files:**
- Create `lib/mapSource.ts` and `lib/__tests__/mapSource.test.ts`.
- Add `lib/mapSource.ts` to `ALLOW` in `lib/__tests__/noStrayApiCallers.test.ts`, with a reason comment.

**Interfaces:**
- Produces:
  - `MAP_HOST = 'https://tiles.catspotters.com'`;
  - `MAP_FALLBACK_VERSION = 1`;
  - `mapUrls(version: number): { pmtilesUrl: string; glyphsUrl: string; spriteUrl: string }`, with the same paths the build writes: `pmtiles://…/v{N}/syros.pmtiles`, `…/v{N}/fonts/{fontstack}/{range}.pbf`, `…/v{N}/sprites/light`;
  - `useMapVersion(): number`. It returns the fallback at once, then the fetched version. It fetches once per page load (module-level promise), with a 5 s timeout. Any error or a non-positive integer keeps the fallback.

- [ ] Write failing tests:
  - "reads current.json once per visit" (two hooks mounted, one fetch);
  - "falls back when unreachable" (fetch rejects, 404, or `{"version":"x"}` all give 1);
  - `mapUrls(3)` gives exact strings.
- [ ] Implement. Run the tests and `noStrayApiCallers`. Commit.

### Task 3.3: `useMapLibre` hook and the test double

**Files:**
- Create `components/map/useMapLibre.web.ts`.
- Create `components/map/__mocks__/maplibreFake.ts`: a fake `Map` that records calls and supports `on/off/once`, `project`, `unproject`, `getZoom`, `getCenter`, `jumpTo`, `easeTo`, `setLayoutProperty`, `setStyle`, `resize`, `remove`, and `dragRotate`/`touchZoomRotate`/`keyboard` with `disable()`. Its `project` uses `mercator.toWorld` at `fromMapLibreZoom(zoom)`, so overlay maths can be tested.
- Create `components/map/__tests__/useMapLibre.web.test.tsx` (jsdom).
- Add pinned `maplibre-gl` and `pmtiles` to `artifacts/cat-spotter/package.json`, plus `@workspace/map-style: workspace:*`.

**Interfaces:**
- Produces: `useMapLibre(opts: { center: LatLng; zoom: number /* app zoom */; interactive: boolean; rotate: boolean; keyboard: boolean }): { containerRef: RefObject<View>; map: MaplibreMap | null; failed: 'no-webgl' | null; zoom: number /* app zoom */; version: number }`.
  - It loads `maplibre-gl` and `pmtiles` with `await import()` inside `useEffect` (never at module top).
  - It registers the `pmtiles` protocol once.
  - It builds the style with `buildStyle({ lang: MAP_LANG(language), ...mapUrls(version) })`.
  - It sets `minZoom`/`maxZoom` from `toMapLibreZoom(MIN_ZOOM/MAX_ZOOM)` and `pitchWithRotate: false`.
  - It disables rotation and keyboard per the options.
  - It reports `failed: 'no-webgl'` when `maplibregl.supported?.()` is false or construction throws.
  - On language change: `labelFieldsFor(mapLang)` → `setLayoutProperty(layerId, 'text-field', textField)` for each entry.
  - On version change: `setStyle` (the one allowed use).
  - It removes the map on unmount.

- [ ] Write failing tests:
  - "creates the map with app zoom converted";
  - "language change calls setLayoutProperty for every labelFieldsFor layer, never setStyle" (Review Focus 4);
  - "no WebGL reports failed";
  - "removes the map on unmount";
  - "rotation and keyboard disabled when asked".
- [ ] Implement. Run. Commit.

### Task 3.4: `AppMap.web.tsx` on MapLibre

**Files:** modify `components/AppMap.web.tsx`; rewrite `components/__tests__/AppMapFit.web.test.tsx` against the fake.

- **Unchanged:** `zoomForDelta`, the fitting rules (once per `fitKey`, measured, non-empty areas), the props-change recentre, cells as DOM `Pressable` overlays, the chips strip, the zoom buttons and the credit.
- **New:**
  - Cell boxes come from `map.project` of the cell's corners (via `roundedCellPolygon` bounds). They're recomputed on the map's `move` and `zoom` events, throttled to animation frames.
  - The zoom buttons call `map.easeTo({ zoom: map.getZoom() ± 1 })`.
  - Fitting calls `map.jumpTo({ center, zoom: toMapLibreZoom(fit.zoom) })`.
  - `interactive === false` disables all MapLibre handlers.
  - With no WebGL, the map area shows `t('mapNoWebgl')` ("The map can't show in this browser."; en/el/fr added to `lib/i18n.ts`). The strip and "Show all" still work.
- `cellBoxPixels` is no longer used; Task 3.6 removes it.

- [ ] Rewrite the existing tests' expectations against the fake (zoom read from `jumpTo` calls instead of `img[src]`). All of today's asserted behaviours stay, and these are added:
  - "cell box follows map.project after move and zoom" (Review Focus 2);
  - "no WebGL shows message and keeps the strip" (Review Focus 3).
- [ ] Implement. Run `AppMapFit.web.test.tsx` and the `CataloguePage`/`CatPage*` tests that mock AppMap. Commit.

### Task 3.5: `LocationPicker.web.tsx` on MapLibre

**Files:** modify `components/LocationPicker.web.tsx`; update `components/__tests__/LocationPickerKeyboard.web.test.tsx` against the fake.

- **Kept:**
  - the fixed centre pin;
  - `onChange` once on `moveend` after a user gesture (not after our own `jumpTo` from props);
  - tap recentres (MapLibre `click` → `easeTo({center: e.lngLat})`, then commit);
  - our keyboard handler (MapLibre keyboard off): arrows `map.panBy` by `KEY_STEP` (Shift ×4), committing once per key press;
  - `+`/`=`/`-` zoom;
  - `role="application"`, focusable, labelled;
  - the coordinate readout;
  - rotation off;
  - `START_ZOOM` 17 → MapLibre 16.
- **No WebGL:** show `t('mapNoWebgl')` and a "Use where I am now" button. Reuse the existing i18n key the claim sheet uses, if present (find it); otherwise add `useWhereIAmNow` in en/el/fr. The button calls `navigator.geolocation.getCurrentPosition` → `onChange`.
- **Untouched:** `spot.tsx`, `ClaimCatSheet.tsx` and `ReportWizard.tsx`. The source-text tests match `<LocationPicker key={mapStartKey}`.

- [ ] Update the keyboard tests (same assertions, observed through the fake), then add:
  - "no WebGL shows Use where I am now" (Review Focus 3);
  - "props recentre does not call onChange".
- [ ] Implement. Run the picker tests and `spotMapStart`, `spotLocationAsk`, `spotWaitingCard`, `ClaimCatSheet`, `ReportWizard`. Commit.

### Task 3.6: Remove the picture code

**Files:**
- Delete `lib/mapTiles.ts` and `lib/__tests__/mapTiles.test.ts`. Their remaining Mercator tests moved in 3.1.
- Remove `cellBoxPixels` and its tests from `cellShape`.
- Update the `cats.tsx` comment that mentions openstreetmap.org tiles.
- Leave `lib/offlineTiles.ts` and `components/OsmTiles.tsx` alone. They're native, Phase 4.

- [ ] Run `git grep -n "tile.openstreetmap.org\|visibleTiles\|cellBoxPixels\|lib/mapTiles" -- artifacts/cat-spotter`. Expected: only native files and `offlineTiles`.
- [ ] Run the whole cat-spotter suite and typecheck. Commit.

### Task 3.7: Bundle size and preview (session model)

- [ ] `pnpm --filter @workspace/cat-spotter build:web`. Record the total JS size and brotli size against today's ~3.4 MB raw / ~0.7 MB brotli (SYC-133). Check whether `maplibre-gl` ended up in a separate chunk.
- [ ] If MapLibre is in the main bundle, report the added KB to Samuel before `gh pr ready` (spec §5).
- [ ] Run the web app locally against the live `tiles.catspotters.com` (after PR 1's first upload) or the local build. Check, at 390 px and desktop:
  - the cats map with real cats;
  - the cat page map, pannable;
  - the spot pin;
  - the report wizard pin;
  - English and Greek, switching language with a map open.
- [ ] Take screenshots into `docs/screenshots/syc-705/web/`.

## Model delegation

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| 3.0 style tweaks (if approved) | Sonnet | Style values with tests | Tests, plus screenshots shown to Samuel |
| 3.1 mercator | Sonnet | Moving pure functions | Tests, plus a mutation probe (drop the −1) |
| 3.2 mapSource | Sonnet | Small hook with clear rules | Tests; `noStrayApiCallers` |
| 3.3 useMapLibre and the fake | **Opus** | Lifecycle, lazy loading and language swap; the fake shapes every later test | Tests, plus an Opus task review |
| 3.4 AppMap.web | **Opus** | Overlays kept in step with a canvas; many kept behaviours | Rewritten tests, plus browser preview by the session model |
| 3.5 LocationPicker.web | **Opus** | Gesture, keyboard and commit semantics | Tests, plus a manual keyboard pass in the preview |
| 3.6 removal | Haiku | Mechanical deletion | Full suite, typecheck, `git grep` empty |
| 3.7 bundle and preview | Session model | Judgement and reporting | Probe: the real build and browser |
| Task reviews | Sonnet (3.0–3.2, 3.6), Opus (3.3–3.5) | Matched to risk | — |
| Final whole-branch review | Opus | Independent check | Findings folded in before ready |

Every agent prompt restates: commit after each item and write a checkpoint note.
