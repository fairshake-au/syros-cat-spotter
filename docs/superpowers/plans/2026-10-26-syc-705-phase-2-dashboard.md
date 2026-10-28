# SYC-705 Phase 2: Dashboard maps on MapLibre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every map on the Syros Cats dashboard (team and cat-guardian pages) is a draggable MapLibre map of our own Syros map file, labelled in the viewer's language. The server-drawn OpenStreetMap pictures, the button maps, Leaflet and the picture cache are gone.

**Architecture:**
- **The server keeps the map file.** It fetches each version's files once from `tiles.catspotters.com` and checks them against `manifest.json`. It keeps them in Postgres (`map_data_files`) with a copy in memory, and serves them from the dashboard's own address. The map file is always sent whole (`Accept-Ranges: none`).
- **One small shared browser script,** `map-core.js`, starts a map in any `<div class="map" data-map="…">`:
  - it loads the whole file (keeping it with the Cache API);
  - it hands the file to MapLibre through `pmtiles` `FileSource`;
  - it applies the style for the page's language.
- **Two page scripts sit on top of it.**
  - `dashboard-map.js` (rewritten) is the cats island map.
  - `dashboard-pin.js` draws every other map: markers on view maps, and the fixed centre pin that writes `lat`/`lng` into the page's form on place maps.
- **The no-script path stands on its own.** Every map page works without a script: a line saying so, the lists in words, and for placing, an area list or typed coordinates.

**Tech Stack:**
- `maplibre-gl` **6.15.0** and `pmtiles` 4.3.2, the same pins as the website (#366 moved the website off 5.6.2, which Replit's package firewall refuses: GHSA-jrc7-96c5-q579). They're vendored as dashboard assets, as Leaflet was. v6 ships ES modules only (no CSP build); see Task 2b.4.
- `@workspace/map-style` (`buildStyle`, `MAP_LANG`).
- Express, Drizzle and Postgres; Vitest with jsdom; and a local Playwright browser check (Chromium and WebKit).

**Spec:** `docs/specs/map-labels-in-your-language.md` §6 Dashboard (approved 24 Oct 2026). Parent plan: `docs/superpowers/plans/2026-10-24-syc-705-map-labels-maplibre.md` (Phase 2 outline). Inventory of today's code: the 26 Oct Explore report summarised under "What exists today" below.

**PRs and branches**

| PR | Branch | Content | After merge |
|---|---|---|---|
| 2a | `claude/syc-705-dashboard-maps-17c6b8` (this worktree) | Migrations 0051 + 0052 (both additive) and this plan | Claude applies both to production (heads-up first). No republish needed. |
| 2b | `claude/syc-705-dashboard-maps-2b`, cut from 2a | Everything else: map data, assets, every map page, removal | Samuel pulls main in Replit and republishes. Claude checks `/api/healthz` shows the commit. |
| 2c | `claude/syc-705-dashboard-maps-2c` | Migration 0053 drops `map_tile_cache` | Only after 2b is live. Claude applies it to production. |

2b stays a draft until 2a is merged **and** its migrations are in production. Merge main into each branch before starting it.

## What exists today (short)

- `lib/teamPages/map.ts` `renderMap(opts)` draws every map except the cats map. It is used by:
  - the Feeding sites list;
  - the site page;
  - the add and move pickers and the confirm "nudge" map (`siteFormPages.ts` `renderPicker`, `smallMap`);
  - colony and area centre pickers (`centrePages.ts`, `routes/centrePick.ts` `readCentrePick`);
  - the colony plan map (`colonyPages.ts`);
  - the cat page's sightings map (`catPages.ts` `sightingsMap`);
  - `/team/map`.
- It also draws the zoom, pan and "Go to" buttons, which post to the `…/map` move routes.
- Taps are read by `mapForms.ts` `readTap`. `teamSites.ts` `readPick` accepts a tap or typed `lat`/`lng`.
- The cats map (`/api/team/cats?view=map`, `catMapPage.ts`) uses Leaflet and `assets/dashboard-map.js`, with map squares fetched by token. It has a `<noscript>` button map that posts to `POST /api/team/cats/map`.
- Picture routes live in `routes/teamMap.ts`. Tokens are in `lib/mapTiles/tileToken.ts`, and the cache in `tileCache.ts` (table `map_tile_cache`). Rate limits are `mapTileLimiter`, `mapSquareLimiter` and `mapSquareTokensLimiter`.
- Who may see what:
  - Picture routes allow anyone who sees some colony (`requireSeeing`), because cat guardians' Feeding sites and site pages have maps.
  - `/team/map`, the cats map and the squares are team-only (`view_exact_location`).
- CSP: `refuse.ts` `TEAM_CSP_WITH_SCRIPTS` = `test/wideCsp.ts` `WIDE_CSP`. Only `GET /api/team/cats` and `GET /api/team/cats/find` may carry it (`WIDE_CSP_ROUTES`), and only `src/routes/teamCats.ts` may ask (`WIDE_CSP_FILES`).
- The live host serves `current.json` → `{"version": 2}`. `v2/manifest.json` lists every file with `bytes` and `sha256`:
  - `syros.pmtiles` is 1,473,392 bytes;
  - `fonts-app/{Noto Sans Regular|Medium|Italic}/{0-255,256-511,768-1023,7936-8191,8192-8447,9472-9727}.pbf` (18 files);
  - `sprites/light{,@2x}.{json,png}`.

## Global Constraints

- **No position in any address.** Map files are requested by version and file name only. Pins post `lat`/`lng` in the form body. No link, form action, redirect or script fetch carries a coordinate.
- **Whole file only.** `syros.pmtiles` is always answered `200` with the full body and `Accept-Ranges: none`, whatever `Range` header arrives. The browser never asks a map company or `tiles.catspotters.com` for anything; only our server does.
- **Who may load map data:** anyone `requireSeeing()` lets in, the same as the old picture route (cat guardians have maps on their site pages). Signed out gets 401 with the strict header.
- **Zoom numbers.** The dashboard keeps today's zoom numbers (12–19, `START_ZOOM` 12, `SITE_ZOOM` 17, `CENTRE_ZOOM` 16, `AREA_ZOOM` 14). MapLibre's zoom is today's minus 1, converted only in `map-core.js` `toMapLibreZoom`.
- **Map language.** `MAP_LANG(viewer lang)`: `el` gets the Greek map; `en` and `fr` get the English one. The viewer lang is `pageViewer(res).lang ?? "en"`. The team is English today (`pageLangFor`).
- **Credit.** "© OpenStreetMap contributors", linked to `https://www.openstreetmap.org/copyright`, under every map, in the page HTML (MapLibre's own attribution control is off).
- **No `data:` images.** MapLibre's built-in controls use `data:` icons, which the wide header blocks. The dashboard draws its own zoom, compass and attribution, so the CSP strings stay byte-for-byte as today.
- **Browser scripts** are plain ES2019, have no build step, and never build HTML from strings (`textContent` and `createElement` only), as `dashboard-map.js` today.
- **Copy.** The no-map line is exactly "The map needs a newer browser with JavaScript on." (key `map.needsJs`). New keys go in `strings/en.ts`, `el.ts` and `fr.ts`; the parity test must pass.
- **Terminology:** "cat guardian", never "colony carer".
- **Migrations.**
  - 0051 and 0052 reach production before the 2b republish; 0053 comes after it.
  - Rollback-block notes use `-- --`.
  - Run `pnpm --filter @workspace/db test runner` before pushing.
  - Never edit an applied migration.
- **Tests locally** need `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`, a local Postgres `DATABASE_URL`, and `ESBUILD_BINARY_PATH` (memory: local-vitest-esbuild).
- **A new file naming `welfare_reports`** joins the `welfareKindGuard` ALLOWLIST. None is expected here.
- **Test cat names** use letters only, never hex or `Date.now()`.
- **PRs.**
  - Draft first. Run the affected tests locally, then the full api-server suite, then `gh pr ready` once. A skipped check is not a pass.
  - Never `gh pr merge --auto`. Merges and republishes are Samuel's call.
- **Commits and notes.** Commit after every task. Update the checkpoint note `docs/superpowers/plans/syc-705-checkpoint.md` (Phase 2 section: done, next) after every task. The SDD ledger is at `.superpowers/sdd/2026-10-26-syc-705-phase-2-dashboard/`.

## Review Focus

1. **A `Range` request for the map file.** It must still get the whole file, or the request says which part of the island is on screen. Test: Task 2b.3 "ignores Range header, sends 200 whole file with Accept-Ranges: none".
2. **The map can't start** (no WebGL, script blocked, map data 503, old browser). The page must still be usable: the fallback is visible and the place form can still be sent by area or typed coordinates. Tests:
   - Task 2b.5 "map failure shows needsJs and keeps the fallback";
   - Task 2b.7 "place page without script offers area list and typed coordinates".
3. **A pin dragged out to sea or off Syros.** It must be refused with the "outside" note, never saved. Test: Task 2b.7 "pin outside Syros is refused" (`readPick`). The map's bounds stop it in the browser too.
4. **A tab left open across a new map version or the republish.** A page asking for an older version still on the host must get it. A request for a version that doesn't exist gets 404, not a fetch loop. Test: Task 2b.2 "serves an older version on request; refuses a version above current".
5. **The map data host is down after a server restart.** The dashboard map must still load from Postgres. Test: Task 2b.2 "serves from Postgres when tiles host is down".

---

## PR 2a

### Task 2a.1: Migrations 0051 and 0052

**Files:**
- Modify: `lib/db/src/schema/colonies.ts` (`feedingSitesTable`: add `positionApproximate: boolean("position_approximate").notNull().default(false)`).
- Create: `lib/db/src/schema/mapData.ts`, exported from `lib/db/src/schema/index.ts`.
- Generate: `lib/db/migrations/0051_feeding_site_position_approximate.sql`, `0052_map_data_files.sql`, with their `meta` snapshots and journal entries.
- Test: `lib/db/src/schema/mapData.test.ts` (or the package's existing schema test file, if one covers columns).

**Interfaces:**
- Produces:
  - `feedingSitesTable.positionApproximate: boolean`;
  - `mapDataFilesTable`, with:
    - `version integer not null`;
    - `path text not null`;
    - `bytes bytea not null`;
    - `sha256 text not null`;
    - `size integer not null`;
    - `fetched_at timestamptz not null default now()`;
    - primary key `(version, path)`;
    - checks `size = octet_length(bytes)`, `version > 0` and `sha256 ~ '^[0-9a-f]{64}$'`.

- [ ] **Step 1:** Write failing tests: "feeding_sites.position_approximate exists, not null, default false"; "map_data_files refuses a size that isn't the byte length".
- [ ] **Step 2:** Run `pnpm --filter @workspace/db test` and expect FAIL.
- [ ] **Step 3:** Edit the schema, then `pnpm --filter @workspace/db run generate --name feeding_site_position_approximate`, then `generate --name map_data_files`. Add rollback blocks. 0051:
  ```
  -- rollback-begin
  -- -- SYC-705: added column; old code ignores it, so no app rollback is needed first.
  -- ALTER TABLE "feeding_sites" DROP COLUMN "position_approximate";
  -- rollback-end
  ```
  0052 follows the same shape with `-- DROP TABLE "map_data_files";`.
- [ ] **Step 4:** Run `pnpm --filter @workspace/db test` (runner and migrate:check included). Expect PASS.
- [ ] **Step 5:** Commit. Open the draft PR 2a. Run the tests, `gh pr ready`, and wait for green. **Samuel merges.** Then Claude applies the migrations to production (snapshot, `verify-history`, `migrate`, as in memory migrate-before-republish), with a one-line heads-up first.

---

## PR 2b

### Task 2b.1: The island box in its own file

**Files:**
- Create: `artifacts/api-server/src/lib/island.ts`.
- Modify: every importer of `ISLAND_BOX`, `inIsland` or `Position` from `lib/mapTiles/geometry`. That means `teamSiteWrites.ts`, `sightingSpot.ts` and the route and page files; the inventory lists them.
- Modify: the cats map "Go to" list and `teamPages` area buttons, which now read `currentAreas()` from `lib/areas/namedAreas.ts` in place of `lib/mapTiles/areas.ts` `AREAS`.
- Update the drift check in `lib/areas/namedAreas.test.ts` and the comment in `seedAreas.ts`.
- Test: move the island-box cases from `geometry.test.ts` to `src/lib/island.test.ts`.

**Interfaces:**
- Produces:
  - `ISLAND_BOX` (same values);
  - `inIsland(p: Position): boolean` (same behaviour);
  - `interface Position { lat: number; lng: number }`;
  - `ISLAND_CENTRE: Position = { lat: 37.445, lng: 24.93 }`.

- [ ] Move the moved tests and check they pass against `island.ts`. `geometry.ts` re-exports from `island.ts` until Task 2b.8 deletes it.
- [ ] Run `pnpm --filter @workspace/api-server typecheck` and the moved tests. Commit.

### Task 2b.2: Map data store

**Files:**
- Create: `src/lib/mapData/store.ts`, `src/lib/mapData/store.test.ts`.

**Interfaces:**
- Consumes: `mapDataFilesTable` (2a.1).
- Produces:
  - `MAP_HOST = "https://tiles.catspotters.com"`;
  - `MAP_FALLBACK_VERSION = 2`;
  - `FONT_STACKS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]` and `FONT_RANGES = ["0-255","256-511","768-1023","7936-8191","8192-8447","9472-9727"]`;
  - `SPRITE_FILES = ["light.json","light.png","light@2x.json","light@2x.png"]`;
  - `mapFilePath(kind, …)`: the host path, i.e. `syros.pmtiles`, `fonts-app/<stack>/<range>.pbf` or `sprites/<file>`. Anything outside these lists is `null`.
  - `currentMapVersion(src?: MapSource): Promise<number>`. It reads `current.json` at most once an hour (memory) and uses a 5 s timeout. On failure or a non-positive integer it uses the newest version in `map_data_files`, else `MAP_FALLBACK_VERSION`.
  - `getMapFile(version: number, path: string, src?: MapSource): Promise<Buffer | null>`:
    - it checks memory, then Postgres, then `MAP_HOST/v{version}/{path}`;
    - a fetched file must match `manifest.json`'s `bytes` and `sha256` (the manifest is fetched once per version and kept in memory), or it is dropped and `null` returned;
    - a stored file is written to Postgres and memory;
    - concurrent asks for the same file share one fetch;
    - `null` for an unknown path, a version above `currentMapVersion()`, or any failure.
  - `type MapSource = { fetch?: typeof fetch; now?: () => number }`.
- Memory holds only the current version's files. After the first file of a new version is stored, rows of versions older than current − 1 are deleted.

- [ ] Write failing tests with a stub `fetch` and the test DB:
  - "fetches once, then serves from memory";
  - "serves from Postgres when tiles host is down" (Review Focus 5: store, clear memory, fetch rejects → bytes returned);
  - "drops a file whose sha256 doesn't match the manifest";
  - "serves an older version on request; refuses a version above current" (Review Focus 4);
  - "unknown path is null without any fetch";
  - "two concurrent asks make one fetch";
  - "current.json unreachable falls back to newest stored version, then 2";
  - "keeps only current and previous versions".
- [ ] Implement. Run `vitest run src/lib/mapData`. Commit.
- **Mutation probe (reviewer):** skip the sha256 check; "drops a file whose sha256…" must go red.

### Task 2b.3: Map data routes

**Files:**
- Create: `src/routes/teamMapData.ts` (mounted in `routes/index.ts`) and `src/routes/team.mapData.test.ts`.
- Modify: `src/middlewares/rateLimit.ts` (`mapDataLimiter`) and `src/lib/limits.ts` (bucket constants).
- Update the route tables in `team.walk.test.ts` and `team.headers.test.ts`.

**Interfaces:**
- Consumes: `getMapFile`, `currentMapVersion`, `mapFilePath` (2b.2); `buildStyle`, `MAP_LANG` from `@workspace/map-style` (add `"@workspace/map-style": "workspace:*"` to api-server dependencies, and check `pnpm --filter @workspace/api-server build` bundles it).
- Produces (all `requireSeeing()`, `setTeamHeaders(res)` first, then `mapDataLimiter`):
  - `GET /api/team/map-data/current` → `{ version }`, `no-store`.
  - `GET /api/team/map-data/v:version/syros.pmtiles`:
    - `200`, `Content-Type: application/vnd.pmtiles`, `Accept-Ranges: none`, `Cache-Control: private, max-age=31536000, immutable`;
    - the whole body, always.
  - `GET /api/team/map-data/v:version/fonts/:stack/:range.pbf` → `application/x-protobuf`, same cache header.
  - `GET /api/team/map-data/v:version/sprites/:file` → `application/json` or `image/png`.
  - `GET /api/team/map-data/v:version/style-:lang.json` (`lang` ∈ `en|el`):
    - `buildStyle({ lang, pmtilesUrl: "pmtiles://syros-v{N}.pmtiles", glyphsUrl: "/api/team/map-data/v{N}/fonts/{fontstack}/{range}.pbf", spriteUrl: "/api/team/map-data/v{N}/sprites/light" })`;
    - the paths are relative, and `map-core.js` makes them absolute.
  - Errors:
    - `:version` not a positive integer, or an unknown file → 404 JSON, `no-store`;
    - a store miss → 503 JSON, `no-store`, with a warn log naming the version and path only.
- `mapDataLimiter`: `sharedLimiter` bucket `"map_data"`, 600 per 10 minutes per person (`key: person:<id>`). A cold page load is about 25 requests, and the browser keeps everything for a year.

- [ ] Write failing tests:
  - "ignores Range header, sends 200 whole file with Accept-Ranges: none" (Review Focus 1). Send `Range: bytes=0-99`; expect 200, the full `Content-Length`, no `Content-Range`, and `Accept-Ranges: none`.
  - "refuses signed-out with 401 and STRICT_CSP".
  - "a cat guardian may load map data".
  - "style has relative glyph and sprite paths for this version and Greek labels for el".
  - "unknown font range is 404 without a fetch".
  - "never logs a byte range" (capture the request log; no `Range` or `bytes=` appears).
  - "601st request in 10 minutes is 429".
- [ ] Implement. Run the new test, `team.walk`, `team.headers`. Commit.
- **Mutation probe (reviewer):** let Express send ranges (drop `Accept-Ranges: none` and use `res.sendFile`-style range handling); Review Focus 1's test must go red.

### Task 2b.4: MapLibre assets replace Leaflet

**Files:**
- Modify:
  - `artifacts/api-server/package.json`: remove `leaflet`; add devDependencies `maplibre-gl@6.15.0` and `pmtiles@4.3.2`.
  - `scripts/buildAssets.mjs` and `src/lib/teamAssets.ts`: `VENDOR` and `ASSET_NAMES`.
  - `src/routes/team.assets.test.ts` and `src/lib/teamAssets.fallback.test.ts`.
- Modify: the asset route (find where `GET /api/team/assets/:file` lives). The worker file gets the wide header, so its own fetches are allowed. Add that route's file to `WIDE_CSP_FILES`, with a reason line.

**Interfaces:**
- Produces vendored names:
  - `maplibre-gl.mjs` ← `maplibre-gl/dist/maplibre-gl.mjs` (an ES module; it has no imports of its own);
  - `maplibre-gl-worker.mjs` ← `maplibre-gl/dist/maplibre-gl-worker.mjs` (MapLibre starts it with `new Worker(url, { type: "module" })` for a same-origin URL, so no `blob:` and no CSP change);
  - `maplibre-gl.css` ← `maplibre-gl/dist/maplibre-gl.css`;
  - `pmtiles.js` ← `pmtiles/dist/pmtiles.js` (classic IIFE, global `pmtiles`).
- `.mjs` joins `ASSET_EXTENSIONS` (in both files), served as `text/javascript`.
- After `pnpm install`, confirm each source path exists with `ls`.

- [ ] Update the tests:
  - "vendored files are the pinned maplibre-gl 6.15.0 and pmtiles 4.3.2" (replaces the Leaflet test);
  - "the worker is served with WIDE_CSP; every other asset as before".
- [ ] Run `node scripts/buildAssets.mjs assets /tmp/x` (in the scratchpad) and the asset tests. Commit.

### Task 2b.5: `map-core.js` and the new `renderMap` (view maps)

**Files:**
- Create: `assets/map-core.js`, `assets/dashboard-pin.js`.
- Rewrite: `src/lib/teamPages/map.ts`.
- Modify: `src/lib/teamPages/layout.ts` (map CSS: drop `.mapband`, `.b179`, `.mappage` whole-pixel rules; add `.map` sizing and the pin), and the `strings` files.
- Create: `src/lib/teamPages/__fixtures__/maplibreFake.ts`. It is a recording fake of `maplibregl.Map` (`on/off/once`, `project`, `unproject`, `getCenter`, `getZoom`, `jumpTo`, `easeTo`, `fitBounds`, `setLayoutProperty`, `resize`, `remove`, `dragRotate`/`touchZoomRotate.disableRotation`), `Marker`, `addProtocol`, `setWorkerUrl` and `supported`, plus a fake `pmtiles` (`Protocol`, `PMTiles`, `FileSource`).
- Create tests: `src/lib/teamPages/mapCore.test.ts` (jsdom runs `map-core.js` and `dashboard-pin.js` with the fakes) and `src/lib/teamPages/map.render.test.ts`.

**Interfaces:**
- `renderMap(opts: MapOptions): string`, where:
  ```ts
  interface MapOptions {
    mode: "view" | "place";
    centre?: Position; zoom?: number;     // app zoom (12–19)
    fit?: readonly Position[];            // fit these (max zoom 17) when given
    markers?: MapMarker[];                // MapMarker as today (label, href, look, cluster, n, text)
    lang?: string;                        // viewer lang → MAP_LANG
    formId?: string;                      // place mode: the form whose lat/lng inputs the pin writes
  }
  ```
  - It outputs one `<div class="map" id="map" data-map="<escaped JSON>">`, holding `{ mode, lang: "en"|"el", centre: [lat,lng], zoom, fit, markers, formId }`.
  - Inside it, `<p class="mapnojs">` with `t("map.needsJs")`, shown until the script starts the map.
  - Then the credit line.
  - Keep `mergeSameSpot`. `fitView`, `resolveView`, `BANDS` and the token code go.
  - Marker `href`s must still pass `isOpaqueAddress`.
- `map-core.js` is a classic script. It loads MapLibre with a dynamic `import(<maplibre-gl.mjs asset URL>)`; the hashed asset URLs (library, worker) come from `data-` attributes on the map-core `<script>` tag, written by the page from `assetUrl()`. It exposes `window.CatMap = { start(el, opts) → Promise<map>, toMapLibreZoom(z), fromMapLibreZoom(z) }`. `start`:
  - checks `fetch`, `caches` (optional), `pmtiles` and that the dynamic import succeeds (v6 has no `supported()`: without WebGL2 the `Map` constructor throws `GPUInitializationError`, which counts as "can't start");
  - fetches `/api/team/map-data/current`;
  - opens Cache API `"syros-map"`, deletes entries for other versions, and fetches the whole `/api/team/map-data/v{N}/syros.pmtiles` (falling back to a plain `fetch` if `caches` is missing);
  - wraps it in `new File([blob], "syros-v{N}.pmtiles")` → `protocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(file)))`;
  - fetches `style-{lang}.json` and makes `glyphs`/`sprite` absolute with `location.origin`;
  - calls `maplibregl.setWorkerUrl(<worker asset URL from the script tag's data attribute>)` before the first `Map`;
  - creates the map with: `attributionControl: false`, `pitchWithRotate: false`, `maxPitch: 0`, `maxBounds` = island box padded by 0.03°, `minZoom` 11, `maxZoom` 18;
  - adds its own controls (`+`, `−`, compass that turns north up), as `<button>`s with translated `aria-label`s from `data-words`;
  - on success removes `.mapnojs` and adds `.maplive` to the page's `.mapfallback` blocks (the CSS hides them);
  - on any failure leaves the page as it was and puts `t("map.needsJs")` in the map box.
- `dashboard-pin.js`, view mode: one `maplibregl.Marker` per marker, using today's CSS classes (`pin site-public|site-private|site-retired|sighting|seen`, `catpin…`). A marker with `href` is an `<a>`; the label goes in by `textContent` in a `.sr` span. It fits `fit` (padding 24) or jumps to `centre`/`zoom`.
- New strings: `map.needsJs`, `map.attrib` ("© OpenStreetMap contributors"), `map.compass` ("Turn north up"); `map.zoomIn` and `map.zoomOut` are kept. Remove `map.north|west|east|south`, `map.alt`, `map.altPlace`, and `map.aria` if nothing uses them.

- [ ] Write failing tests:
  - render: "renders data-map JSON with lang el for a Greek viewer, en for fr"; "no position in any href/action/src" (existing `isOpaqueAddress` scan); "credit line links to the OSM copyright page".
  - script:
    - "fetches only fixed map-data addresses with the version, never a Range header";
    - "uses the Cache API copy on a second start, no second file fetch";
    - "app zoom 17 becomes MapLibre 16";
    - "map failure shows needsJs and keeps the fallback" (Review Focus 2: `Map` constructor throws; dynamic import rejects; file 503; style 503);
    - "markers are links with text labels, no innerHTML";
    - "rotation off when asked".
- [ ] Implement. Switch these view maps over:
  - the site page (`sitePages.ts`, centre = site, zoom 17);
  - the Feeding sites list (fit all shown sites; drop the `?view=` token and `POST /team/sites/map`);
  - the colony plan map (`colonyPages.ts`, fit);
  - the cat page sightings map (`catPages.ts`, fit; keep the "N not on this map" count by checking against the fitted bounds' box in the server, or drop the count if it's always 0 with fitting — say which in the commit).
- [ ] Each page that now has a map:
  - loads `maplibre-gl.css`, `pmtiles.js`, `map-core.js` (with the library and worker URLs in data attributes) and `dashboard-pin.js` through `layout.ts`'s `scripts`/`styles` options;
  - calls `setTeamHeaders(res, { scripts: true })`;
  - is added to `WIDE_CSP_ROUTES`, and its file to `WIDE_CSP_FILES`, each with a reason line.
- [ ] Run `map.render`, `mapCore`, `team.sites`, `team.colonies`, `catPages.*`, `team.headers`, `team.scriptTags`, `refuse.source`. Commit.

### Task 2b.6: The cats island map on MapLibre

**Files:**
- Rewrite: `assets/dashboard-map.js`.
- Modify: `src/lib/teamPages/catMapPage.ts` and `src/routes/teamCats.ts` (remove `POST /api/team/cats/map` and the `<noscript>` button map).
- Rewrite tests against the fake: `dashboardMap.fit|loading|merge|photoLink|script.test.ts`, `sterilisedNotKnown.test.ts`, `positions.source.test.ts`, `team.catMap.test.ts`, `team.scriptTags.test.ts`.

**Interfaces:**
- Consumes: `CatMap.start` (2b.5); `POST /api/team/cats/positions` (unchanged).
- Kept behaviours, each with today's test carried over:
  - fit to cats once on the first answer, only with no focus and no user move (SYC-573);
  - `mergeClose` grouping at 44 px using `map.project`;
  - tapping a group zooms in;
  - the cat card and group sheet (Escape closes);
  - the feeding sites layer (off by default);
  - the focused cat's numbered trail;
  - filters applied with no page load (`history.replaceState`, form fields only);
  - the photo link;
  - the "Go to" area buttons (now from `currentAreas()`, `data-area` keys, zoom 15);
  - the loading line;
  - no HTML from strings.
- Removed: the token squares, the island outline drawn when pictures fail, and `fallBack()` re-reading `<noscript>`.
- No script, or the map can't start: the page shows `t("map.needsJs")` and a link "Show these cats as a grid", which keeps the filter form's fields as the link's query (the same fields the grid uses today; no positions).

- [ ] Rewrite the tests (same assertions, observed through the fake), then add:
  - "the script fetches only /api/team/cats/positions and map-data addresses" (replaces the two-route test);
  - "map can't start: grid link shown with the current filters".
- [ ] Implement. Run the listed tests. Commit.

### Task 2b.7: Placing on the map (drag the map under the pin), and the no-map path

**Files:**
- Modify:
  - `src/routes/teamSites.ts` (`readPick`, the pick and move routes, `map-at-sighting`, `from-sighting`);
  - `src/lib/teamPages/siteFormPages.ts` (`renderPicker`, `smallMap`, confirm pages);
  - `src/lib/teamPages/sitePages.ts` (the "position approximate" note);
  - `src/lib/teamSiteWrites.ts` (`addSite`, `moveSite` take `positionApproximate`);
  - `src/routes/centrePick.ts`, `src/lib/teamPages/centrePages.ts`, `src/routes/teamColonies.ts`, `src/routes/teamAreas.ts`;
  - `assets/dashboard-pin.js` (place mode);
  - the strings files.
- Tests: `team.siteWrites`, `team.sites`, `team.entryPoints`, `team.colonies`, `team.areas`, `team.guardianView`, `team.guardianLanguage`, `team.guardianActions`, `mapCore.test.ts`.

**Interfaces:**
- `readPick(body: Record<string, unknown>, lang?: string, opts?: { allowArea?: boolean }): Picked`, where:
  ```ts
  type Picked =
    | { ok: true; spot: Position; approximate: boolean }
    | { ok: false; status: 400; note: string; fields: string[] };
  ```
  - `area` present and `allowArea` (default true): the area's centre from `areaByKey` in `lib/areas/namedAreas.ts`, with `approximate: true`. An unknown key → `t("sproblem.area")`.
  - Otherwise typed or pin `lat`/`lng` (today's `TypedForm`), with `approximate: false`. Outside Syros → `sproblem.outside`.
  - The tap branch goes.
- `readCentrePick` passes `allowArea: true` for colony centres and `false` for area add and move.
- Place pages (`renderPicker`):
  - One form, `id="pickform"`, posts to the pick route. It holds `renderMap({ mode: "place", formId: "pickform", centre, zoom })`, hidden `lat`/`lng` inputs written by the pin on every `moveend`, and a submit "Use this spot" (`map.useSpot`). Before the map has started the button is `hidden`; the script reveals it.
  - Below that, a `<div class="mapfallback">`, visible unless the map started:
    - a form with `<select name="area">` (`currentAreas()`) and "Use this area's centre" (`pick.useArea`), sites and colony centres only;
    - the existing typed-coordinates fold, open by default here.
- Confirm pages (add, move, colony and area centre):
  - The details form now holds the small place map (`formId` = the details form). Dragging the map updates its hidden `lat`/`lng`, so typed details are never lost (closes SYC-355).
  - The nudge `<input type="image">` and `nudge=1` go.
  - The spot is also given in words (`place(...)`), so the page is complete with no script.
- Approximate positions:
  - The add and move save forms carry hidden `approximate=1` only when the pick was by area. `AddForm`/`MoveForm` read `approximate: z.literal("1").optional()`.
  - `addSite`/`moveSite` write `position_approximate`. A move by pin or typed position clears it.
  - The site page shows `t("site.approximate")` ("Position approximate: placed by choosing an area. Move it on the map when you can.") when it's set.
- Headers. These answers render a map and get `setTeamHeaders(res, { scripts: true })`, each added to `WIDE_CSP_ROUTES` with a reason line:
  - `GET /api/team/sites/new`, `GET /api/team/sites/:id/move`, `POST /api/team/sites/pick`, `POST /api/team/sites/:id/move/pick`, `POST /api/team/sites/from-sighting`, `POST /api/team/sites/map-at-sighting`;
  - `GET /api/team/colonies/:id/centre`, `POST /api/team/colonies/:id/centre/pick`;
  - `POST /api/team/areas/new`, `POST /api/team/areas/new/pick`, `GET /api/team/areas/:key/centre`, `POST /api/team/areas/:key/centre/pick`.
  - This is a change from the spec's "pages reached after a form is posted carry the strict header" (Samuel chose this, 26 Oct 2026). Refusals and 400 re-renders stay strict, and so show the no-map path.
- Removed routes (each also removed from `team.walk.test.ts`): `POST /api/team/sites/map`, `/sites/new/map`, `/sites/:id/move/map`, `/colonies/:id/centre/map`, `/areas/new/map`, `/areas/:key/centre/map`.
- `map-at-sighting` renders the Feeding sites page with `centre` = the sighting, zoom 17, and the sighting marker. It stays a POST, with nothing in the address.

- [ ] Write failing tests:
  - "area pick sets position_approximate";
  - "typed coordinates clear it";
  - "map pin clears it" (posting `lat`/`lng` from the confirm form after an area pick);
  - "pin outside Syros is refused" (Review Focus 3);
  - "unknown area key is refused";
  - "area list is not offered on the area add and move pickers";
  - "place page without script offers area list and typed coordinates" (Review Focus 2);
  - "confirm page keeps typed details when the spot changes" (one form);
  - "no position in any address" (existing K13 scans, kept);
  - in `mapCore.test.ts`, "pin writes lat/lng to the form on moveend, rounded to 6 decimals; Use this spot revealed only after start".
- [ ] Implement. Run the listed route tests, `refuse.source`, `team.headers`, `team.walk`. Commit.

### Task 2b.8: Remove the picture code

**Files:**
- Delete:
  - `src/routes/teamMap.ts` (keep `GET /api/team/map` as a 303 to `/api/team/cats?view=map`, moved into `teamCats.ts`);
  - `src/lib/mapTiles/` (all of it, tests included);
  - `team.map.test.ts` and `team.mapSquares.test.ts`.
  - Strip the map-token exemptions from `src/test/opaqueAddress.ts` and its test.
- Modify:
  - `routes/index.ts`;
  - `rateLimit.ts` (remove `mapTileLimiter`, `mapSquareLimiter`, `mapSquareTokensLimiter`, and their bucket constants in `limits.ts`);
  - `app.logRedaction.test.ts` (use a hand-written token string; **keep** `logger.ts` `MAP_TILE_IN_PATH` and its tests, because tabs open across the republish may still ask for old picture addresses);
  - `guardianView.source.test.ts` (drop `teamMap.ts`);
  - `team.walk.test.ts`;
  - `team.headers.test.ts`;
  - `team.firstColony.test.ts`, `team.noteLeak.test.ts` (they fetch `/api/team/map`; expect the 303);
  - `layout.test.ts` and `catTabs.test.ts` (`.mapband` CSS).
- Leave alone: `lib/db` `mapTileCacheTable` and `map_tile_cache` (that's PR 2c). `tileCache.ts` is the only reader of the table, so after this task the code no longer reads it.

- [ ] Run `git grep -nE "mapTiles/|tileToken|tileCache|mintTileToken|readTap|applyMove|map-squares|map-square/|map-tiles|leaflet|Leaflet|BANDS|mapband" -- artifacts/api-server`. Expected hits: only `logger.ts`'s redaction pattern and its tests.
- [ ] Run `pnpm --filter @workspace/api-server typecheck` and the **full** api-server suite. Commit.

### Task 2b.9: Browser check, preview, PR (session model)

**Files:**
- Create: `docs/screenshots/syc-705/dashboard/check.mjs` and `README.md`, modelled on `docs/screenshots/syc-396-pr-1-5/check.mjs` (`PLAYWRIGHT_CORE` env, not a dependency).

- [ ] Build the server (`pnpm --filter @workspace/api-server build`). Run it on a scratch DB seeded with cats, sites and a sighting, with `PRELAUNCH_GATE=off`. Follow memory dashboard-preview-cookie-host: plant the cookie on `/api/healthz`, and abort every non-localhost browser request before the first navigation. **The server itself** fetches from `tiles.catspotters.com`; that's fine and expected.
- [ ] In headless Chromium (software GL, `--use-angle=swiftshader`) and WebKit, at 390 px and 1280 px:
  - the cats map draws (the canvas has non-blank pixels), with cats, a card on tap and the trail;
  - the site page map draws;
  - add a site by dragging the map, then save; the saved position is the pin's;
  - add a site by area with JavaScript off, then save; the site page says "Position approximate";
  - the colony centre picker draws;
  - "Show on our map" from a sighting draws;
  - no console errors and no CSP violations;
  - every request's URL is checked against `POSITION_IN_URL`, and no request goes to any host but localhost;
  - the map file request has no `Range` and its answer is 200.
  - WebKit standing in for Safari is recorded as such. Samuel's real-iPhone check stays on SYC-287.
- [ ] Screenshots go in `docs/screenshots/syc-705/dashboard/`. Take Greek labels by setting a test cat guardian's language to `el`.
- [ ] Measure `maplibre-gl.js` raw and gzip size, and check whether the asset route compresses. Note it in the PR.
- [ ] Final whole-branch adversarial review (Opus, own worktree). Fold in the findings. Open draft PR 2b. Run the full suite, then `gh pr ready`, and wait for a real green run.

---

## PR 2c

### Task 2c.1: Drop `map_tile_cache` (only after 2b is live)

**Files:**
- Delete `lib/db/src/schema/mapTiles.ts` and its export in `schema/index.ts`.
- Generate `lib/db/migrations/0053_drop_map_tile_cache.sql`. Its rollback block recreates the table exactly as `0022_map_tile_cache.sql` did, every line `-- `-commented, with notes as `-- --`.
- Modify: `lib/db/src/photoRemoval/catalogue.test.ts` (remove `"map_tile_cache.bytes"`).

- [ ] Check `/api/healthz` on the live site shows 2b's merge commit (memory confirm-live-build-before-smoke). Only then start.
- [ ] Generate, add the rollback, then run `pnpm --filter @workspace/db test`, including the runner. Then `git grep -n "map_tile_cache\|mapTileCacheTable" -- ':!lib/db/migrations' ':!docs'`. Expected: nothing.
- [ ] Draft PR, tests, then ready. After Samuel merges, Claude applies 0053 to production (heads-up first) and closes SYC-732 with a note.

---

## Decision for Samuel: **decided 26 Oct 2026, option A** ("Yes, show the map")

**Map pages reached by sending a form.** "Show on our map" from a sighting, and the "Check the spot" step when adding or moving a site, are pages the dashboard shows after a form is sent. The form route keeps the position out of the address. The spec says such pages get the strict no-script header, which means no map there.

- **A. Let those pages run our map script too (recommended).**
  - What changes: a team member sees a draggable map on "Show on our map" and can fine-tune the pin on "Check the spot" without losing what they typed (this also fixes SYC-355).
  - Risk: the same as the Cats map and every other map page. Only our own scripts, from our own server, can run. Each such page is named in a list a test checks.
- **B. Keep them strict.**
  - What changes: "Show on our map" shows the place in words with no map. "Check the spot" has no map; to change the spot you go back to the start.
  - Risk: none to security, but the two flows get clumsier, and SYC-355 stays open.

## Linear

- On merge of 2b:
  - SYC-585 (and SYC-342, folded into it) and SYC-355 are fixed;
  - SYC-456 is moot (sites are drawn as squares by our own CSS markers);
  - SYC-287 is retargeted to "check drag-to-place on a real iPhone and Android".
- On merge of 2c: SYC-732 is closed (the table is gone). Note that `map_data_files` holds about 3 MB of map data as bytea, with only two versions kept.
- Deferred items found in review go to SYC as new tickets. Progress is commented on SYC-705 after each PR.

## Model delegation

The session runs on Opus 5.5. Each Agent call names its tier, and each prompt restates: "commit after each item and update the checkpoint note".

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| 2a.1 migrations | Sonnet | Routine, known rules | `lib/db` tests (runner, migrate:check). The session model reads the rollback blocks |
| 2b.1 island move | Haiku | Mechanical import moves | Typecheck, moved tests, `git grep` for old imports |
| 2b.2 map data store | Sonnet | Clear interface and tests | Tests, plus the sha256 mutation probe |
| 2b.3 map data routes | Sonnet | Clear interface; privacy rule pinned by test | Tests, plus the Range mutation probe. A Sonnet adversarial reviewer aimed at "can any request reveal the viewed area?" |
| 2b.4 assets | Sonnet | Vendoring and test updates | Asset tests and the build script. The session model owns the worker-header decision |
| 2b.5 map-core, renderMap, view maps | **Opus** | Browser code under a strict CSP; its fake shapes every later test; privacy rules | jsdom tests, Opus task review, browser check (2b.9) |
| 2b.6 cats map rewrite | **Opus** | 988 lines of interaction logic to carry over with its tests | Carried-over tests, Opus task review, browser check |
| 2b.7 placing and no-map path | **Opus** | Many flows (sites, colonies, areas, cat guardians) with permission and privacy rules | Route tests, Opus task review, browser check with JavaScript on and off |
| 2b.8 removal | Sonnet | Wide but mechanical | Full suite, typecheck, the `git grep` |
| 2b.9 browser check and preview | Session model | Judgement, real browsers, outside-request guard | Probe: the real build in Chromium and WebKit |
| 2c.1 drop migration | Sonnet | Routine | `lib/db` tests; the session model checks the live commit first |
| Task reviews | Sonnet (2a, 2b.1–2b.4, 2b.8, 2c), Opus (2b.5–2b.7) | Matched to risk | — |
| Final 2b review | Opus adversarial, its own worktree | Independent check of work the session built | Findings folded in before ready |

Opus is used only where browser behaviour, many flows, or a privacy property meets a subtle interaction. Nothing needs Fable.

## Self-review notes

- **Spec §6 coverage:**
  - engine and assets: 2b.4;
  - `dashboard-map.js`: 2b.6;
  - pin: 2b.7;
  - every flow: 2b.5 (view) and 2b.7 (place);
  - POST body: Global Constraints and 2b.7;
  - map file route, Postgres copy, Accept-Ranges and rate limit: 2b.2 and 2b.3;
  - CSP: 2b.4, 2b.5 and 2b.7;
  - removals: 2b.6 and 2b.8;
  - kept `ISLAND_BOX`/`inIsland`/`readPick`: 2b.1 and 2b.7;
  - no-map path and `position_approximate`: 2a.1 and 2b.7;
  - tests: Playwright in 2b.9;
  - drop table after republish: 2c.1.
- **Deliberate changes from the spec or outline:**
  - **Both additive migrations go in 2a,** so 2b needs no migration of its own before republish.
  - **The cats map's no-script path is a link to the grid,** not a grid drawn inside the map page.
  - **POST-reached map pages get the wide header** (Samuel chose A, 26 Oct 2026).
  - **`/team/map` becomes a redirect** to the cats map.
  - **The worker gets the wide header,** not "no header", so it is never unrestricted.
  - **The "Go to" list and the fallback area list read the team's named areas** (`currentAreas()`). The 7 hard-coded `AREAS` are retired.
- **Safari:** WebKit in Playwright plus Samuel's real iPhone (SYC-287). Neither is claimed as a full Safari proof.
