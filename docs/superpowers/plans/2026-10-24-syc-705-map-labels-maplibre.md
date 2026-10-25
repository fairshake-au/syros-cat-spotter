# Map labels in your language (MapLibre): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Cat Spotters map (phone app, website, team dashboard) is drawn by MapLibre from one self-hosted Syros map file. Each map uses the adjusted style and shows place names in the reader's language.

**Architecture:**
- A GitHub Action builds `syros.pmtiles` from OpenStreetMap data, adding Latin-letter names where only Greek exists, and uploads it to `tiles.catspotters.com` (Cloudflare R2) with its fonts and symbols.
- One shared style package (`lib/map-style`) produces the adjusted style for English and Greek.
- The phone app uses `@maplibre/maplibre-react-native` with an offline copy of the file. The website uses `maplibre-gl` with the `pmtiles` library. The dashboard uses MapLibre's strict-security build, fed the whole file from its own address.
- Every map picture and the button maps are removed.

**Tech Stack:**
- Map data: pyosmium, Protomaps basemaps (Planetiler) and PMTiles.
- Map engines: MapLibre GL JS, `@maplibre/maplibre-react-native` v11.5.
- Hosting: Cloudflare R2.
- App and server: Expo 54 / React Native 0.81 and Express (existing), Vitest (existing).

**Spec:** `docs/specs/map-labels-in-your-language.md` (approved 24 Oct 2026). The adjusted style Samuel approved is `docs/specs/source/map-labels-style-prototype.html`. Ticket: SYC-705.

## How this plan is shaped

There are five phases, each one or more PRs, in the spec's rollout order.

- **Phases 0 and 1 are fully detailed below.**
- **Phases 2–4 are given as task lists:** files, interfaces and the tests that prove each task. Each is expanded into its own detailed plan once Phase 0 has reported, because the real-phone results can change how the phone app is built (spec §4, "Fallback"). Each detailed plan comes back to Samuel for a quick sign-off before that phase starts.

| Phase | PR(s) | What ships | Samuel's step |
|---|---|---|---|
| 0 | none (throwaway branch) | A proof on a real iPhone and a real Android | Run the dev build on his phones, or lend a device |
| 1 | PR 1 | The map file, the style package, `tiles.catspotters.com`, the daily check | none |
| 2 | PRs 2a–2c | Dashboard on MapLibre; drop `map_tile_cache` last | Pull main in Replit and republish (twice) |
| 3 | PR 3 | Website on MapLibre | Pull main and republish |
| 4 | PR 4 | Phone apps on MapLibre | Store builds |

## Global Constraints

- **Language.** Labels follow the app's language. `en` and `fr` get the English map; `el` gets Greek (spec Decision A).
- **English labels.** Towns and villages show two lines, English then Greek. Streets, beaches, churches and landmarks show one line: `coalesce(name:en, name)` (spec §What we're building; review v3 B3).
- **Added names.** They go only where a Greek `name` exists and `name:en` doesn't, and never replace a real `name:en`. They follow ELOT 743, the road-sign system. They are never uploaded to OpenStreetMap.
- **The box.** `SYROS_RECT` = `{ minLat: 37.36, maxLat: 37.53, minLon: 24.85, maxLon: 25.01 }`, padded by 0.03° on every side.
- **Zoom.** The app keeps today's zoom numbers (limits 12–19). MapLibre's zoom is today's minus 1, converted in one place only (`toMapLibreZoom` / `fromMapLibreZoom`).
- **Credit.** "© OpenStreetMap contributors" appears on every map.
- **No position in any address.** Dashboard pins POST their coordinates in the body. The dashboard never requests the map file in pieces.
- **Draft PRs.** Every PR opens as a draft (`gh pr create --draft`). Run the affected tests locally, then `gh pr ready` once. A skipped check is not a pass.
- **Migrations.** The added `position_approximate` column reaches production before republish. Dropping `map_tile_cache` comes after the republish. Rollback-block notes use `-- --`, and `lib/db` `runner.test` is run before pushing.
- **Cat page map.** It stays pannable and zoomable (SYC-707, merged as #337).
- **Offline wording.** Never claim the app "all works with no signal".
- **Commits.** Commit after every task. Write a checkpoint note (`docs/superpowers/plans/syc-705-checkpoint.md`: what's done, what's next) at the end of each phase.

## Review Focus

These are failure modes the spec implies but no ordinary test covers. Each one has a test in the task named.

1. **A Greek-only street on the English map** must show one line in Latin letters, not two lines and not Greek. Tests: Task 1.2 `test_adds_name_en_only_when_missing` (the name exists) and Task 1.3 "English streets and landmarks are one line" (it shows on one line).
2. **A half-downloaded offline file** must never be used: a phone that loses signal mid-download keeps the old map. Test: Phase 4 `offlineMap.test.ts` "interrupted download keeps previous version".
3. **The dashboard asking for part of the map file.** It must always send the whole file, or the request reveals the area being looked at. Test: Phase 2 `teamMapData.test.ts` "ignores Range header, sends 200 whole file with Accept-Ranges: none".
4. **Zoom off by one.** A fitted view must show the same area before and after the switch. Test: Phase 3/4 `mercator.test.ts` "fitRegion → MapLibre zoom round-trips".
5. **A new map version mid-session.** The website and phone keep the version they have until the new one is complete. Nothing mixes versions. Test: Phase 4 "switches only after verified download"; Phase 3 "reads current.json once per visit".

---

## Phase 0: Prove MapLibre on real phones (throwaway, not merged)

Runs on branch `claude/syc-705-phone-proof`, cut from this branch. Nothing here is merged. The deliverable is a short report on SYC-705.

### Task 0.1: A Syros file and style good enough for the proof

**Files:**
- Create: `spike/README.md` (results go here)
- Create: `spike/syros.pmtiles` (not committed; listed in `.gitignore`)
- Create: `spike/style-en.json`, `spike/style-el.json` (exported from the prototype's `adjusted()` function)

- [ ] **Step 1:** Cut Syros out of the Protomaps daily build with `pmtiles extract https://build.protomaps.com/20261022.pmtiles spike/syros.pmtiles --bbox=24.82,37.33,25.04,37.56`. Expected: a file of a few MB. Record its size in `spike/README.md`.
- [ ] **Step 2:** In the browser, export the prototype's `adjusted('en')` and `adjusted('el')` as JSON into the two style files. Point their source at a placeholder `{PMTILES_URL}`, `glyphs` at `{GLYPHS_URL}` and `sprite` at `{SPRITE_URL}`.
- [ ] **Step 3:** Download the glyph ranges the app needs from `protomaps/basemaps-assets` (pinned commit) for "Noto Sans Regular", "Noto Sans Medium" and "Noto Sans Italic". The ranges are `0-255`, `256-511`, `768-1023`, `7936-8191`, `8192-8447` and `9472-9727`, plus the `light` sprites. Put them in `spike/assets/`.
- [ ] **Step 4:** Commit (without the `.pmtiles`).

### Task 0.2: Development build with MapLibre

**Files:**
- Modify: `artifacts/cat-spotter/package.json` (add `@maplibre/maplibre-react-native@11.5.0` and `expo-dev-client`)
- Modify: `artifacts/cat-spotter/app.json` (add the `@maplibre/maplibre-react-native` plugin)
- Create: `artifacts/cat-spotter/app/spike-map.tsx` (one screen)

- [ ] **Step 1:** The screen copies `syros.pmtiles` and the assets from a download URL into `FileSystem.documentDirectory + 'map/'`. It shows a MapLibre `MapView` using the English style, with `PMTILES_URL = 'pmtiles://file://' + path`. It has an EN/EL toggle that changes only the label layers' `text-field`.
- [ ] **Step 2:** `eas build --profile development --platform all`. Expected: two installable builds.

### Task 0.3: The checks, on a real iPhone and a real Android

- [ ] **Step 1:** With signal on, open the spike screen and let it download. Then switch on flight mode, force-quit and reopen.
- [ ] **Step 2:** Check each item on both phones and screenshot each one into `spike/README.md`:
  - the map shows Ermoupoli at street level, offline;
  - two-line town names (Ermoupoli / Ερμούπολη);
  - ▲ Βούλιας 263 m;
  - † churches at close zoom;
  - beach names in italics;
  - the colours match the prototype;
  - EN↔EL switches with no flash;
  - fonts load from `file://` paths that contain spaces (issue #647).
- [ ] **Step 3:** Post the results on SYC-705, including any failure. If the `file://` file can't be read on either phone, stop and bring the fallback (spec §4: a Worker serving map pieces into MapLibre's offline storage) to Samuel before Phase 4 is planned.

---

## Phase 1: The map file, the style and `tiles.catspotters.com` (PR 1)

### Task 1.1: Latin-letter names (ELOT 743)

**Files:**
- Create: `scripts/map-data/elot743.py`
- Test: `scripts/map-data/test_elot743.py`

**Interfaces:**
- Produces: `transliterate(greek: str) -> str`

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from elot743 import transliterate

@pytest.mark.parametrize("greek,latin", [
    ("Οδός Ερμού", "Odos Ermou"),
    ("Ερμούπολη", "Ermoupoli"),
    ("Άνω Σύρος", "Ano Syros"),
    ("Άγιος Νικόλαος", "Agios Nikolaos"),
    ("Γαλησσάς", "Galissas"),
    ("Χρούσσα", "Chroussa"),
    ("Θεοτόκου", "Theotokou"),
    ("Ψαρή", "Psari"),
    ("Ευαγγελίστρια", "Evangelistria"),   # ευ before a voiced sound -> ev; γγ -> ng
    ("Ευκλείδου", "Efkleidou"),           # ευ before a voiceless sound -> ef
    ("Μπάτσι", "Batsi"),                  # μπ at the start of a word -> b
    ("Λαμπάδα", "Lampada"),               # μπ in the middle of a word -> mp
    ("ΚΙΝΙ", "KINI"),                     # all capitals stay all capitals
    ("Οδός 25ης Μαρτίου", "Odos 25is Martiou"),  # digits pass through
])
def test_transliterate(greek, latin):
    assert transliterate(greek) == latin

def test_latin_passes_through():
    assert transliterate("Apollon Theatre") == "Apollon Theatre"
```

- [ ] **Step 2:** Run `python -m pytest scripts/map-data/test_elot743.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `transliterate` from the ELOT 743 table:
  - Apply the two-letter rules first: αι, ει, οι, ου, αυ/ευ/ηυ (v or f by what follows), γγ, γκ, γξ, γχ, μπ (b at the start of a word, otherwise mp), ντ.
  - Then single letters.
  - Strip accents and diaeresis first, but let a diaeresis split a two-letter pair.
  - Keep the input's case pattern.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 1.2: Add names to the Syros extract

**Files:**
- Create: `scripts/map-data/add_names.py`
- Test: `scripts/map-data/test_add_names.py` (uses a 5-feature `.osm` fixture in `scripts/map-data/fixtures/syros-sample.osm`)

**Interfaces:**
- Consumes: `transliterate` (Task 1.1)
- Produces: CLI `python add_names.py IN.osm.pbf OUT.osm.pbf names-added.csv`. The CSV columns are `osm_type,osm_id,kind,name,name_en_added`.

- [ ] **Step 1: Write the failing tests**

```python
def test_adds_name_en_only_when_missing(tmp_path):
    out, csv = run_add_names(FIXTURE, tmp_path)
    tags = read_tags(out)
    assert tags[("way", 101)]["name:en"] == "Odos Ermou"    # Greek-only street gets one
    assert tags[("node", 1)]["name:en"] == "Ermoupoli"      # existing English name kept as-is
    assert "name:en" not in tags[("way", 102)]              # no name at all: nothing added
    assert tags[("way", 103)]["name:en"] == "Main Street"   # already Latin: copied, not transliterated
    assert rows(csv) == [("way", "101", "highway", "Οδός Ερμού", "Odos Ermou")]
```

- [ ] **Step 2:** Run `python -m pytest scripts/map-data -q`. Expected: FAIL.
- [ ] **Step 3:** Implement with `osmium.SimpleHandler` and `osmium.SimpleWriter` (pyosmium, pinned in `scripts/map-data/requirements.txt`). Copy a Latin `name` to `name:en`; transliterate a Greek `name`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 1.3: The shared style package

**Files:**
- Create: `lib/map-style/package.json` (`@workspace/map-style`), `lib/map-style/src/index.ts`, `lib/map-style/src/adjusted.ts`
- Create: `lib/map-style/scripts/export.mjs` (writes `dist/style-en.json` and `dist/style-el.json` for the dashboard and the pipeline test)
- Test: `lib/map-style/src/index.test.ts`

**Interfaces:**
- Produces:
  - `buildStyle(opts: { lang: 'en' | 'el'; pmtilesUrl: string; glyphsUrl: string; spriteUrl: string }): StyleSpecification`
  - `labelFieldsFor(lang: 'en' | 'el'): Array<{ layerId: string; textField: ExpressionSpecification }>`, used for the instant language switch
  - `MAP_LANG(appLang: 'en' | 'el' | 'fr'): 'en' | 'el'`

- [ ] **Step 1: Write the failing tests**

```ts
it('maps app languages to map languages', () => {
  expect(MAP_LANG('fr')).toBe('en'); expect(MAP_LANG('el')).toBe('el'); expect(MAP_LANG('en')).toBe('en');
});
it('uses the adjusted colours', () => {
  const s = buildStyle({ lang: 'en', pmtilesUrl: 'pmtiles://x', glyphsUrl: 'g/{fontstack}/{range}.pbf', spriteUrl: 's' });
  expect(paint(s, 'earth')['fill-color']).toBe('#f2efe9');
  expect(paint(s, 'water')['fill-color']).toBe('#aad3df');
});
it('adds churches, hill tops and beach names before pois', () => {
  const ids = buildStyle(EN).layers.map((l) => l.id);
  expect(ids.indexOf('church')).toBeLessThan(ids.indexOf('pois'));
  expect(ids).toEqual(expect.arrayContaining(['church', 'peak', 'beach_name', 'paths']));
});
it('English streets and landmarks are one line; towns are two', () => {
  expect(JSON.stringify(textField(buildStyle(EN), 'roads_labels_minor'))).not.toContain('\\n');
  expect(JSON.stringify(textField(buildStyle(EN), 'pois'))).not.toContain('\\n');
  expect(JSON.stringify(textField(buildStyle(EN), 'places_locality'))).toContain('\\n');
});
it('labelFieldsFor swaps only label layers', () => {
  const ids = labelFieldsFor('el').map((f) => f.layerId);
  expect(ids).toContain('roads_labels_minor'); expect(ids).not.toContain('earth');
});
it('has no tilt and turns no labels with the map', () => {
  /* text-pitch-alignment / text-rotation-alignment = 'viewport' on symbol layers */
});
```

- [ ] **Step 2:** Run `pnpm --filter @workspace/map-style test`. Expected: FAIL.
- [ ] **Step 3:** Implement `buildStyle` by porting the prototype's `adjusted()`:
  - Build on `@protomaps/basemaps@5.7.2` with `namedFlavor('light')` and the prototype's colour overrides.
  - Add the `church`, `peak` and `beach_name` layers, plus a new `paths` layer (footpaths and tracks as a red dotted line, `#fa8072`, dash `[1, 2]`, from zoom 14).
  - Override `text-field` on road, POI and beach layers to `["coalesce", ["get", "name:en"], ["get", "name"]]` for `en` and `["coalesce", ["get", "name:el"], ["get", "name"]]` for `el`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `node lib/map-style/scripts/export.mjs`. Expected: two JSON files.
- [ ] **Step 5:** Commit.

### Task 1.4: The build pipeline and the GitHub Action

**Files:**
- Create: `scripts/map-data/build.sh`
- Create: `scripts/map-data/manifest.py`
- Create: `.github/workflows/map-data.yml` (`workflow_dispatch` only)
- Test: `scripts/map-data/test_manifest.py`

**Interfaces:**
- Produces, under `out/v{N}/`:
  - `syros.pmtiles`
  - `fonts/{fontstack}/{range}.pbf` (all ranges, for the web and the dashboard)
  - `fonts-app/…` (the six app ranges from Task 0.1)
  - `sprites/light{,@2x}.{json,png}`
  - `style-en.json`, `style-el.json`
  - `names-added.csv`
  - `manifest.json`
- Produces: `out/current.json` = `{"version": N}`.
- The manifest has these keys: `version`, `built_at`, `osm_extract_date`, `tools` (geofabrik URL, osmium, pyosmium, protomaps-basemaps jar, natural-earth and water-polygon versions, basemaps-assets commit, `@protomaps/basemaps`), `files` (each with `bytes` and `sha256`), and `names_added`.

- [ ] **Step 1:** Write a failing test: `test_manifest_lists_every_file_with_sha256` builds a manifest over a temp dir and asserts each file's `sha256` and `bytes`, and that `version` is an int.
- [ ] **Step 2:** Run it. Expected: FAIL. Implement `manifest.py`. Expected: PASS.
- [ ] **Step 3:** `build.sh` steps, each with a pinned version:
  1. Download `greece-latest.osm.pbf` from Geofabrik and record its date.
  2. `osmium extract --bbox 24.82,37.33,25.04,37.56` to get `syros.osm.pbf`.
  3. `add_names.py`.
  4. `java -jar protomaps-basemap-<pinned>.jar --osm_path=syros-named.osm.pbf --bounds=24.82,37.33,25.04,37.56 --output=syros.pmtiles`. Confirm the exact flag names from that release's README and record them in the script.
  5. Copy the fonts and sprites from the pinned basemaps-assets commit.
  6. `node lib/map-style/scripts/export.mjs`.
  7. `manifest.py`.
- [ ] **Step 4:** The Action runs on `ubuntu-24.04` with Java 21, Python 3.12 and Node 22. Its steps:
  - run `build.sh`;
  - run `pytest scripts/map-data`;
  - stop if `syros.pmtiles` is under 500 KB or over 50 MB (a sanity bound);
  - upload `out/v{N}` to R2 with `aws s3 cp --recursive --endpoint-url $R2_ENDPOINT`, then `current.json` last;
  - choose `N` as the current `current.json` version + 1.
  
  Secrets used: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_ENDPOINT`, referenced by name only.
- [ ] **Step 5:** Run `build.sh` locally once (the upload is skipped when `DRY_RUN=1`). Record in the PR the real file size and the count of names added (replacing the spec's estimates).
- [ ] **Step 6:** Update `NOTICE`: the map is made by Cat Spotters from OpenStreetMap data, and the file is offered under ODbL. Also credit Natural Earth (public domain), Protomaps basemaps (BSD), MapLibre (BSD) and the Noto fonts (OFL). Commit.

### Task 1.5: `tiles.catspotters.com` (Cloudflare, done by Claude)

Done with the stored token at `~/.cloudflare/api-token` through `scripts/cf.py` (cloudflare-ops skill). Give Samuel a one-line heads-up before creating anything.

- [ ] **Step 1:** Probe first: check whether the token can create R2 buckets and R2 access keys. If it can't, say so plainly and point Samuel to `~/.cloudflare/store-api-token.sh` with the missing permission named. Don't dictate dashboard steps.
- [ ] **Step 2:** Create bucket `cat-spotters-map`, then connect the custom domain `tiles.catspotters.com`.
- [ ] **Step 3:** Set CORS:
  - origins: `https://catspotters.com`, `https://www.catspotters.com`, `https://apptest.catspotters.com`, `http://localhost:8081`, `http://localhost:19006`, `https://*.replit.dev`;
  - methods: GET and HEAD;
  - allowed headers: Range and If-Match;
  - exposed headers: ETag, Content-Range and Content-Length.
- [ ] **Step 4:** Add a Cache Rule: hostname `tiles.catspotters.com` and path starting `/v` → eligible for cache, edge TTL 1 year. Then a second rule: `/current.json` → edge TTL 5 minutes.
- [ ] **Step 5:** Create the R2 access key, then set the three GitHub secrets with `gh secret set` from a newline-free file (the `token-via-file-rollout` memory). Never echo the values.
- [ ] **Step 6:** Run the Action. Then probe:
  - `curl -sI https://tiles.catspotters.com/current.json` → 200;
  - `curl -s -H 'Range: bytes=0-126' -o /dev/null -w '%{http_code}' …/v1/syros.pmtiles` → 206;
  - the same request with `-H 'Origin: https://catspotters.com'` returns `access-control-allow-origin`;
  - run the ranged request twice and check `cf-cache-status`. Record whether a cold ranged request fills the cache (the spec marked this unchecked).
- [ ] **Step 7:** Open the prototype page pointed at `https://tiles.catspotters.com/v1/syros.pmtiles` with the v1 style. Screenshot Ermoupoli, Ano Syros, Kini, Galissas and the whole island in English and Greek, at 390 px and desktop width. Put the screenshots in `docs/screenshots/syc-705/` and in the PR.

### Task 1.6: Daily check

**Files:**
- Create: `.github/workflows/map-data-check.yml` (cron `17 5 * * *` plus `workflow_dispatch`)

- [ ] **Step 1:** The check:
  - fetches `current.json`;
  - makes a ranged GET of the first 127 bytes of `v{N}/syros.pmtiles`, expecting 206 and the magic `PMTiles` in the bytes;
  - GETs one font range per font stack.
  
  If anything fails, the job fails. GitHub emails Samuel on a scheduled-workflow failure. **This replaces the spec's "raises a Linear ticket"**, which would need a new Linear API key secret. That spec change is flagged to Samuel in the PR description.
- [ ] **Step 2:** Run it with `workflow_dispatch`. Expected: green.
- [ ] **Step 3:** Commit. Open PR 1 as a draft and run `pytest` and the `map-style` tests locally. Then `gh pr ready`. Write the checkpoint note.

---

## Phase 2: Dashboard on MapLibre (PRs 2a–2c), outline

To be expanded into a detailed plan after Phase 0 and approved by Samuel. Tasks:

- **2a.1 Migration `0044_feeding_site_position_approximate.sql`.** Adds `position_approximate boolean not null default false` to `feeding_sites`, and adds it to the `feedingSitesTable` schema. Tests: `lib/db` runner.test, and a schema test that the column exists. **Ship 2a alone; the migration goes to production before Samuel republishes.**
- **2b.1 Map-data route.** Create `routes/teamMapData.ts` with:
  - `GET /api/team/map-data/:version/syros.pmtiles`, plus `…/fonts/:stack/:range.pbf` and `…/sprites/:file`;
  - signed-in team only, with its own `sharedLimiter` limit.
  
  The file is stored in Postgres as one row of a new `map_data_files` table (migration 0045, in 2b), with a memory copy; it's refetched from `tiles.catspotters.com` when the version changes. Tests (`teamMapData.test.ts`):
  - "ignores Range header, sends 200 whole file with Accept-Ranges: none" (Review Focus 3);
  - "refuses signed-out" with 401 and STRICT_CSP;
  - "serves from Postgres when tiles host is down";
  - "never logs a byte range".
- **2b.2 Assets.** Replace `leaflet.js` and `leaflet.css` with `maplibre-gl-csp.js`, `maplibre-gl-csp-worker.js` and `maplibre-gl.css` in `teamAssets.ts` `ASSET_NAMES` and `scripts/buildAssets.mjs`. Add `map-style-en.json` and `map-style-el.json` from `@workspace/map-style`. The worker is served without `setTeamHeaders`. Test: existing `teamAssets` tests updated.
- **2b.3 `assets/dashboard-map.js` on MapLibre.** Cats, groups when zoomed out, a card on tap, and a cat's trail. It fetches the whole file, keeps it in the Cache API, and uses `new pmtiles.PMTiles(new FileSource(blob))`. Tests: page-data tests replace the Leaflet stub tests. There's also a local-only `pnpm --filter api-server smoke:map` that runs Playwright (devDependency) in headless Chromium with software graphics, asserts the canvas draws, and is run before `gh pr ready`.
- **2b.4 Drag-the-pin script `assets/dashboard-pin.js`.** It POSTs `lat`/`lng` in the body (spec §10.4) to the existing `readPick` handlers. Flows moved to it:
  - sites add and move;
  - the site page;
  - `map-at-sighting`;
  - the colonies map steps;
  - area add and centre;
  - the cat page map, which stays pannable and zoomable (SYC-707).
  
  Tests: each route's POST handler test is kept; positions never appear in the `Location` header or links (an existing test pattern).
- **2b.5 CSP.** Every map page is added to `WIDE_CSP_ROUTES` and `WIDE_CSP_FILES`, with a reason line for each. Prove the worker loads under `WIDE_CSP` with no `worker-src`, in Chromium (smoke) and Safari (manual, recorded in the PR). Only if Safari fails, add `worker-src 'self'` and update `refuse.ts` and `test/wideCsp.ts`.
- **2b.6 No-map path.** The `<noscript>` and no-WebGL message is "The map needs a newer browser with JavaScript on." (en/el/fr strings). The area list sets the area's centre and `position_approximate = true`; typed coordinates set it to `false`. Tests:
  - "area pick sets position_approximate";
  - "typed coordinates clear it";
  - "map pin clears it".
- **2b.7 Removal.** Delete `tileToken.ts`, `tileCache.ts`, the joining code in `mapForms.ts`, `routes/teamMap.ts` picture routes, `POST /api/team/cats/map` and Leaflet. Move `ISLAND_BOX` and `inIsland` to `lib/island.ts`; their users are `sightingSpot.ts`, `teamSiteWrites.ts` and `areas.ts`. Update or remove the ~12 tests. Run the full api-server suite before `gh pr ready` (memory: `welfare-kind-guard-allowlist`).
- **2c.1 Migration that drops `map_tile_cache`.** It ships only after Samuel has republished 2b. It also updates `photoRemoval/catalogue.test.ts:36` and the schema export.

## Phase 3: Website on MapLibre (PR 3), outline

- **3.1 `lib/mercator.ts`.** Move `toWorld`, `fromWorld`, `MIN_ZOOM`, `MAX_ZOOM`, `clampZoom` and `latLngAtOffset` out of `lib/mapTiles.ts`. Add `toMapLibreZoom(z) = z - 1` and `fromMapLibreZoom(z) = z + 1`. Update the imports in `cellShape.ts`. Test (`mercator.test.ts`): existing tests moved, plus "fitRegion → MapLibre zoom round-trips" (Review Focus 4).
- **3.2 `lib/mapSource.ts`.**
  - `useMapVersion(): number | null`: fetches `https://tiles.catspotters.com/current.json` once per visit, with a fallback version built in.
  - `mapUrls(version): { pmtilesUrl; glyphsUrl; spriteUrl }`.
  
  Tests: "reads current.json once per visit"; "falls back when unreachable".
- **3.3 `AppMap.web.tsx` on `maplibre-gl` and `pmtiles`.** It keeps the cat chip strip, cat markers, zoom buttons, rounded squares and the credit. Rotation is on and pitch is off. Language switching uses `labelFieldsFor`. Tests: existing render tests, with a mocked `maplibre-gl`, still pass. The cat page map stays interactive.
- **3.4 `LocationPicker.web.tsx` on MapLibre.** Rotation is off. When WebGL is missing, only "Use where I am now" is shown. Test: "no WebGL shows Use where I am now".
- **3.5 Delete `lib/mapTiles.ts` and its test.** Update `noStrayApiCallers.test.ts` and the comment in `cats.tsx`.
- **3.6 Bundle size.** Check whether Expo web can load MapLibre only on map screens (`React.lazy` plus dynamic `import()`). Measure the export either way and report the KB to Samuel before `gh pr ready`.
- **3.7 Preview.** Check the map renders with data at 390 px and desktop width before the PR opens (standing rule).

## Phase 4: Phone apps on MapLibre (PR 4), outline

Its shape depends on Phase 0. This outline assumes the proof passed.

- **4.1 Swap the dependency.** Remove `react-native-maps` and add `@maplibre/maplibre-react-native@11.5.0` plus its `app.json` plugin and `expo-dev-client`. `app.config.js` drops `GOOGLE_MAPS_ANDROID_API_KEY` and its check. Decide in the detailed plan whether the Expo Go server (`server/serve.js`, `scripts/build.js`) is retired or kept for the website.
- **4.2 `lib/offlineMap.ts`** replaces `lib/offlineTiles.ts`.
  - It downloads into `documentDirectory/map/`: a temporary name, checks size and sha256 from `manifest.json`, then renames to `syros-v{N}.pmtiles`.
  - It stores only file names.
  - It deletes the old `tiles/` folder and `cat-spotter/offline-tiles-ready-v1` after success.
  - `useOfflineMap(): { version: number | null; localPmtilesPath: string | null; downloading: boolean; progress: number }`.
  
  Tests (`offlineMap.test.ts`):
  - "interrupted download keeps previous version" (Review Focus 2);
  - "checksum mismatch discards";
  - "switches only after verified download" (Review Focus 5);
  - "old OSM tiles removed only after success".
- **4.3 `AppMap.tsx` on MapLibre.** The rounded squares become a GeoJSON fill and line source, with "N cats" labels. There are no cat markers on native, as today. Taps come through `onPress`. Pitch is off. The location dot uses `UserLocation`. Language switching uses `labelFieldsFor`. Before the local file is ready, it uses `pmtiles://https://…`; after, `pmtiles://file://…`. The cat page map stays interactive (SYC-707).
- **4.4 `LocationPicker.tsx` on MapLibre.** Tap-to-centre, rotation off.
- **4.5 Remove `OsmTiles.tsx`.** Update `app/_layout.tsx` and `spot.tsx`'s `mapDownloading` notice (en/el/fr), and the `noStrayApiCallers` allow-list.
- **4.6 Credit line** on the native map.
- **4.7 Real-device pass.** Rerun the Phase 0 checks plus SYC-287, SYC-555 and SYC-228 on the preview build before the store build.

---

## Model delegation

The session runs on Opus 5.5. Work below goes to the cheapest adequate tier. Each Agent call names its tier, and every agent prompt repeats "commit after each item and write a checkpoint note".

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Phase 0 spike screen and style export (0.1–0.2) | Sonnet | Clear, small, throwaway | Probe: Samuel's real-device checks (0.3) are the test |
| 1.1 ELOT 743 transliteration | Sonnet | Well-specified table and tests | Deterministic: the parametrised tests. Spot review by the session model against the ELOT 743 table. **Mutation probe:** break the ευ→ev/ef rule and confirm a named test goes red |
| 1.2 add_names | Sonnet | Standard pyosmium handler | Tests. **Mutation probe:** make it overwrite an existing `name:en` and confirm `test_adds_name_en_only_when_missing` goes red (it guards a silent failure) |
| 1.3 Style package | Sonnet | Port of an approved prototype | Tests, plus the session model comparing screenshots with the prototype (1.5 step 7) |
| 1.4 Pipeline and Action | Sonnet | Scripting with pinned tools | Probe: a full local `DRY_RUN=1` build, and the real Action run |
| 1.5 Cloudflare setup | Session model (Opus) | Credentialed account changes; probe-first rule; secrets handling | Probe: the curl checks in step 6 |
| 1.6 Daily check | Haiku | Mechanical workflow | Run via `workflow_dispatch`, green, and once against a wrong URL to see it fail |
| 2a/2c migrations | Sonnet | Routine, with known rules | `lib/db` runner.test; the session model checks the rollback block uses `-- --` |
| 2b.1 Map-data route | Sonnet | Clear interface | Tests, plus an adversarial review agent (Sonnet) aimed at the privacy property. **Mutation probe:** honour `Range` and confirm Review Focus 3's test goes red |
| 2b.3–2b.4 Dashboard map and pin scripts | **Opus** | Multi-file, plain-ES2019 browser code under a strict CSP, with privacy rules; subtle interactions | Smoke run plus the session model's browser check at 390 px and desktop |
| 2b.5 CSP proof | Session model | A security decision | Chromium smoke plus a manual Safari check, recorded |
| 2b.7 Removal and test updates | Sonnet | Wide but mechanical once the design is settled | Full api-server suite, typecheck, and a `git grep` for every removed symbol returning nothing |
| 3.1–3.2 mercator and mapSource | Sonnet | Pure functions with tests | Tests. **Mutation probe:** remove the −1 in `toMapLibreZoom` and confirm the round-trip test goes red |
| 3.3–3.4 Web map components | **Opus** | Behaviour-heavy UI with existing features to keep | Render tests, plus the session model's preview at 390 px and desktop |
| 4.2 offlineMap | **Opus** | Atomic download and swap, a silent-failure risk | Tests, plus the three mutation probes named in 4.2 (skip the checksum, swap before verify, delete old tiles first) |
| 4.3–4.4 Native map components | **Opus** | New engine, real-device behaviour | Phase 0 checks rerun on real phones |
| Each phase's final review before `gh pr ready` | **Opus** adversarial reviewer, one worktree per reviewer | Independent check of work the session built | Findings folded in before ready |

Escalations to Opus are justified in the "Why" column: browser and native map behaviour, and silent-failure download logic. Nothing here needs Fable.

## Self-review notes

- **Spec coverage:**
  - §1 pipeline: Tasks 1.1, 1.2, 1.4.
  - §2 hosting: Task 1.5.
  - §3 refresh: Task 1.4 (version N+1, `current.json` last), 3.2, 4.2.
  - §4 app: Phase 4.
  - §5 website: Phase 3.
  - §6 dashboard: Phase 2.
  - §7 credits: Tasks 3.3, 4.6 and the NOTICE update in 1.4.
  - §8 rollout: the phase order.
  - Risks: the daily check (1.6) and `names-added.csv` (1.2).
- **One deliberate change from the spec:** the daily check alerts by GitHub's failure email, not a Linear ticket (Task 1.6). It's flagged for Samuel.
- **NOTICE:** the update is Task 1.4, step 6.
