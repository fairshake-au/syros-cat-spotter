# Map labels in your language

Ticket: SYC-705. Revives the idea in SYC-288 (cancelled 22 Oct 2026, "serve our own Syros map tiles").
Status: **approved by Samuel, 24 Oct 2026** ("approved, write the plan"). v3, review findings folded in. Rewritten for MapLibre on every map. Samuel chose MapLibre and the adjusted style after seeing them side by side, then chose MapLibre for the dashboard too. Needs a fresh adversarial review, then approval. Reviews: `reviews/map-labels-in-your-language-review.md` (v2, the picture design; points that still apply are carried over) and `reviews/map-labels-in-your-language-review-v3.md` (v3: 5 blockers, 9 should-fix and 8 dashboard findings, all addressed).
Decision behind it: on 24 Oct 2026 Samuel chose "a language-aware map" over "Google Maps everywhere" and "Google on phones only".

## The problem, as a spotter meets it

Samuel's phone and browser are set to English. Every map in Cat Spotters still shows Syros in Greek: Ερμούπολη, not Ermoupoli; Άνω Σύρος, not Ano Syros. A tourist who can't read Greek can't match the map to the road sign saying "Ermoupoli", or to the name of their beach.

This happens on every map:

- the app's map of cats;
- the "where was the cat?" pin;
- the same two maps on the website;
- the team dashboard's island map.

**Why:** all of them use OpenStreetMap's standard map pictures. Those always print each place's local name, and on Syros that is Greek. No phone setting changes it.

**What the map data knows.** We counted every named thing on Syros in OpenStreetMap's data on 24 Oct 2026, using the Overpass API over the island's box.

| | Named | With an English name | With a French name |
|---|---|---|---|
| Towns, villages, areas | 145 | 65 (44%) | 20 |
| Streets and roads | 1,064 | 17 (1%) | 0 |
| Beaches | 21 | 5 | 0 |
| Everything else (shops, churches, bays…) | 1,114 | 138 (12%) | 3 |

So the big places have English names. Ermoupoli and Ano Syros do, for example. Almost no streets do, so simply switching to "English names where they exist" would leave most of the map in Greek. That is why Decision B (spelling Greek-only names in Latin letters) matters.

**A second problem found on the way.** The app downloads the island's map pictures from OpenStreetMap when it first opens, so the map partly works without signal. OpenStreetMap's map-picture policy says "Offline use is not permitted on tile.openstreetmap.org" and forbids bulk downloading. Our server keeping copies for the dashboard is something the policy "does not recommend". (Source: operations.osmfoundation.org/policies/tiles, read 24 Oct 2026.) As the app grows, OpenStreetMap could block it, and the maps would go grey.

**A third, smaller gap.** The phone app's map shows no "© OpenStreetMap contributors" credit. OpenStreetMap's licence requires one. The website and dashboard maps already show it.


## What we're building

**Every map in Cat Spotters (the phone app, the website and the team dashboard) is drawn by MapLibre from one small file of Syros map data that we make and host. Every map uses the same adjusted look and shows names in the reader's language.**

How the map gets made:

1. Take OpenStreetMap's data for the island.
2. Give every place, street and beach a readable Latin-letter name (Decision B).
3. Pack it into one map-data file, `syros.pmtiles`.
4. Host that file at Cat Spotters' own address, `tiles.catspotters.com`.

The phone and the browser download that file, or the parts of it they need, and draw the map on the spot. Nothing draws or stores map pictures any more.

| Reader's language | Place names on the map |
|---|---|
| English | Towns and villages: the English name with the Greek underneath ("Ermoupoli / Ερμούπολη"). Streets, beaches, churches and landmarks: one line, the English name where OpenStreetMap has one, otherwise spelled in Latin letters ("Odos Ermou"). |
| Greek | Greek, as today ("Ερμούπολη"). |
| French | The English map (Decision A). Turning on a French version later only needs a small adjustment to the style and the same Latin-spelling step for French; it needs no new map file. |

What this gives us:

- **Everyone can read the map.** English readers see English or Latin-letter names. Greek readers see Greek, as now.
- **A much better offline map on phones.** Today the phone stores pictures of the island and goes blurry past street level outside town. After this, the phone keeps the whole island's map data. With no signal, it shows full street detail anywhere on Syros, in either language. (Offline is still partial overall: see "Offline, precisely".)
- **Instant language change.** All the names are in the one file, so switching language redraws the map straight away. Nothing is downloaded again.
- **Sharper maps.** Labels stay crisp at every zoom and on every screen, and they don't block each other.
- **No map company sees where anyone looks.** Phones and browsers fetch map data from Cat Spotters, not from OpenStreetMap. Cloudflare, our host, carries the requests, as it already does for the rest of the site. We don't turn on logging of map requests.
- **We follow OpenStreetMap's rules.** We no longer bulk-download their map pictures.
- **No keys, no monthly limits, no outside map company.** The phone app no longer needs a Google Maps key on Android.

### The look

We use the **adjusted style** Samuel saw on 24 Oct 2026. It starts from Protomaps' light style and is changed to look close to today's map:

- Today's colours: cream land, light-green parks, darker-green woods, sandy beaches, blue sea.
- Main roads in orange-tan and lanes in white.
- Hill tops with a ▲, their name and height (Βούλιας 263 m).
- Churches marked †, with their names when zoomed in close.
- Beach names in italics.
- No label is written all in capitals. Greek in capitals drops its accent marks (ΝΗΣΑΚΙ), and the map can't do that, so capitals would show wrong spellings (ΝΗΣΆΚΙ).
- To add: footpaths and hiking trails as dotted lines, like today's map.
- Kept calm on purpose: only a few landmarks in town (theatre, post office, supermarket), not every shop and café, so the cat markers stand out.

The style is one file in the repo (`map-style/`), shared by the phone app, the website and the dashboard, so all three look the same.

### What the spotter sees

- **The map follows the app's language,** and switching redraws at once, including a map already open.
- **Same map, a little cleaner.** It's close to today's map, with fewer shop icons in town.
- **The credit "© OpenStreetMap contributors"** stays on the website and is added to the phone app's map, which lacks it today.
- **The map can be turned with two fingers.** The labels stay upright and a compass button turns it back to north. (Or rotation can be switched off: see Risks.)
- **Outside Syros the map is empty sea.** Cat Spotters is only about Syros, and the file covers the island plus a margin of about 3 km.

### Offline, precisely

- **Phone app (iPhone and Android).** Once its first download has finished, the phone holds the whole island's map data. With no signal, it shows the full map at any zoom, in the reader's language, with the cat markers the app already keeps. The download is one file of a few megabytes (estimate; the first build gives the real size). The fonts and symbols the map needs are downloaded with it.
- **Before that first download finishes,** the phone shows the map from the internet when it has signal. On a phone that has had no signal since installing, the map is blank. Both are the same as today.
- **Website:** no offline map (SYC-167, unchanged). The browser fetches only the parts of the file it needs as the spotter moves around.

**Phones that already have the app** keep today's OpenStreetMap pictures until the new file has downloaded. Then those pictures are deleted, which frees space. **Phones that haven't updated the app** keep asking OpenStreetMap until they do, so the problem with OpenStreetMap's rules ends only as people update. Our map address must never change in a way that breaks app versions already using it.

### What the team sees

- **Draggable maps everywhere.** The island map of cats and the feeding-site maps become draggable, pinchable MapLibre maps, in the adjusted look, with labels in the viewer's language (English or Greek; the French dashboard uses English). The feeding sites page gets the draggable map at last (SYC-585).
- **Nothing about where you look leaves your browser.** The dashboard downloads the whole Syros map file (a few megabytes) from its own address, once per version, and the browser keeps it. Panning and zooming then happen entirely inside the browser.
- **If the browser can't run the map** (JavaScript off, or a browser too old for MapLibre), there is no map (Samuel, 24 Oct 2026):
  - Cats show as the usual grid.
  - A feeding site is placed by choosing its area from a list, and it's marked "position approximate" until someone places it on a map.
  - A short line says "The map needs a newer browser with JavaScript on."
  - The old button maps (zoom, move and "Go to" buttons) are removed.

## How it works (for the build)

### 1. Making the map file

A script in the repo (`scripts/map-data/`) is run by a manual GitHub Action called "Rebuild Syros map":

1. **Cut out Syros.**
   - Download Geofabrik's Greece extract.
   - Cut out a box with `osmium extract`. The box is `SYROS_RECT` padded by 0.03° (about 3 km) on every side.
   - Drop the names of seas and oceans. The box cuts the Aegean Sea down to a square, and its name would land in the middle of the square, on the island. A one-island map needs no sea name.
2. **Fill in names** (Decision B).
   - A small script adds `name:en` to every feature that has a Greek name but no English one.
   - The spelling follows the standard Greek-to-Latin system used on Greek road signs.
   - Names OpenStreetMap already has in English are never replaced.
   - Every added name is listed in a side file, `names-added.csv` (Greek name, our spelling, kind of feature), so spellings can be checked and corrected later. The map file can't carry this flag: Protomaps' builder keeps only the tags it knows.
   - The added names live only in our file. They are **never** uploaded to OpenStreetMap.
3. **Build the file.**
   - Protomaps' builder copies `name:en` through unchanged (checked in its source, `OsmNames.java`), so the names from step 2 reach the map.
   - The builder also downloads Natural Earth and OpenStreetMap's water outlines for the sea and coast. Their versions are pinned too, and they are credited.
   - Run Protomaps' open-source map builder (`protomaps/basemaps`, built on Planetiler) over the extract.
   - That gives `syros.pmtiles`, with detail down to zoom 15. Closer zooms are drawn from the same data, so the map stays sharp.
   - **Check the labels.** The build stops before upload if any sea or ocean name is left, if a water name (a bay, a harbour) sits on land, or if a town or village name sits out at sea (`check_labels.py`).
4. **Fonts and symbols.** The map's fonts (Noto Sans, which includes Greek) and symbols are built from Protomaps' published assets, pinned to a version and hosted with the file. Nothing is fetched from Protomaps' own site at run time.
5. **Record it.** A `manifest.json` lists the data date, every tool version, the file size and the number of names added in step 2.

### 2. Hosting

- **Where it lives.** A Cloudflare R2 bucket on the custom domain `tiles.catspotters.com` holds:
  - `/v{N}/syros.pmtiles`, the map file;
  - `/v{N}/fonts/…` and `/v{N}/sprites/…`, the fonts and symbols;
  - `/v{N}/manifest.json`;
  - `/current.json` (`{"version": N}`).
- **Browser access.** The bucket supports reading part of a file (range requests), which is how browsers fetch only what they need. Its CORS rule:
  - allows `GET` and `HEAD` with the `Range` and `If-Match` headers;
  - exposes `ETag`, `Content-Range` and `Content-Length`;
  - lists every website address: catspotters.com, www, the test site, localhost for development, and Replit preview addresses.
- **Caching.** Files under `/v{N}/` never change, so they carry a long cache lifetime. `current.json` carries a short one. Cloudflare doesn't keep copies of `.pmtiles` files at its edge by default, so a Cache Rule turns that on for `tiles.catspotters.com/v*/`. Whether a part-of-file request fills Cloudflare's copy when it doesn't have one yet is **unchecked**, and is checked with curl in step 2.
- **Old versions** stay for at least a year, because older app versions point at them.
- **Who does it.** Claude creates the bucket, the domain, the DNS record and the CORS rule with the stored Cloudflare API token, after a one-line heads-up. Claude then checks with curl: a part-of-file request returns 206, and the CORS header is present.
- **Cost.** A few megabytes of storage per version. Each phone downloads the file once per version. Browsers make a few hundred small part-of-file requests per visit. With the Cache Rule, Cloudflare's own copies at the edge should serve most of them (to be confirmed in step 2). That stays well inside R2's free allowance of 10 million reads a month. These figures are estimates and are checked after launch.

### 3. Refreshing

- **When.** Rebuild every three months, or sooner when the island's data has visibly changed. It's one button in GitHub Actions.
- **How it rolls out.** Each rebuild makes a new `v{N}` and updates `current.json`.
- **Phone app.** It reads `current.json` when it has signal. If there's a newer version, it downloads it in the background and switches over once it's complete.
- **Website.** It reads `current.json` on each visit.
- **Dashboard.** It reads `current.json` through its own address, and its server fetches the new file once.

### 4. App (iPhone and Android)

- **Map engine.** Replace `react-native-maps` with `@maplibre/maplibre-react-native`. It is at v11.5.0 (4 Oct 2026); it needs Expo 54 or later, React 19.1 or later and React Native 0.80 or later, and this app meets all three. It bundles MapLibre Android 13.6 and iOS 6.31. Its config plugin is added to `app.json`; without it, the iPhone build fails (library issue #1623).
- **No more Expo Go.** The app can no longer run inside Expo Go. Development and the step 1 proof use a development build (`expo-dev-client`, using the `developmentClient` profile already in `eas.json`) or the preview build. The Expo Go bundle server (`server/serve.js`, `scripts/build.js`) is retired, or kept for the website only. Which of the two is settled in the plan.
- **What the native map draws** (as today):
  - the rounded area squares and their "N cats" labels. The phone app shows no individual cat markers today (`cats.tsx` passes none on native), and that stays.
  - The squares become a GeoJSON source drawn as fill and outline layers. Taps come through the map's press event.
  - Tilting the map (pitch) is off. The blue "you are here" dot uses MapLibre's `UserLocation`.
- **The pin.** `LocationPicker.tsx` is rebuilt, including tap-to-centre. Rotation is off on the pin screen.
- **Shared maths.**
  - The map-projection maths in `lib/mapTiles.ts` (`toWorld`, `fromWorld`, `MIN_ZOOM`, `clampZoom`, `latLngAtOffset`) moves to a new `lib/mercator.ts`, because `lib/cellShape.ts` and the web map still need it. Only the picture code (`visibleTiles`, the picture address) is deleted.
  - `lib/cellShape.ts` keeps its geometry and drops the `react-native-maps` types.
- **Zoom numbers.** MapLibre counts zoom one lower than the picture maps do: its zoom 15 is today's zoom 16. All of today's numbers (the 12–19 limits, `fitRegion`, `zoomForDelta`, starting views) stay as they are. They are converted in one place where they're handed to MapLibre, and tests check that a fitted view is the same before and after.
- **The offline file.** A new `lib/offlineMap.ts`:
  - downloads `syros.pmtiles`, plus only the fonts and symbols the map needs (Latin, Greek, punctuation, and the ▲ and † marks), into `documentDirectory`, not the cache folder that iPhones may empty;
  - downloads to a temporary name, checks the size and the checksum from `manifest.json`, then renames to a file named by version, so a half-finished download is never used;
  - stores only the file name, never the full path, because iPhone app folders can move between updates;
  - points the map at `pmtiles://file:///…/syros-v{N}.pmtiles`. Library issue #728 shows this working, and #618/#625 fixed iPhone address handling. Percent signs in font folder names ("Noto Sans Regular") are tested specifically (issue #647).
- **Before the file is on the phone,** the map reads the same file over the internet (`pmtiles://https://tiles.catspotters.com/…`). So a first launch with signal shows the map straight away, as today. A first launch with no signal shows no map until signal returns, also as today.
- **Fallback.** If reading the file from storage fails on either phone, the fallback is MapLibre's own offline storage. That needs map pieces at ordinary addresses, which means a small Cloudflare Worker that serves pieces of the file (Protomaps publishes one). MapLibre can't fill its offline storage from a PMTiles source directly (MapLibre Android docs).
- **Language.** Changing language rewrites only the label fields of the label layers (`setLayoutProperty`-style updates on the style), not the whole style. The map doesn't flash or reload.
- **Other files touched:** `app/_layout.tsx` (it starts the offline download today), `spot.tsx` (the `mapDownloading` notice and its en/el/fr text), and `noStrayApiCallers.test.ts` (its allowed-files list).
- **No Google key.** `app.config.js` drops `GOOGLE_MAPS_ANDROID_API_KEY` and its build check.
- **Credit.** The map shows "© OpenStreetMap contributors".

### 5. Website

- **Separate web map files stay.** MapLibre's React Native library doesn't run on the web (library issue #1346), so the web keeps its own `AppMap.web.tsx` and `LocationPicker.web.tsx`, rebuilt on `maplibre-gl` with the `pmtiles` library. They read `tiles.catspotters.com/v{N}/syros.pmtiles` and use `lib/mercator.ts` (see §4).
- **What stays the same on the web map:** the strip of cat chips, the cat markers (the web shows them, unlike the phone app), the zoom buttons, and the rounded area squares.
- **Rotation** is off on the pin screen and allowed on the cats map.
- **Size.** MapLibre makes the website bigger. Our estimate is about 250 KB compressed, which is **unchecked** until measured. The plan checks whether Expo's web build can load it only on map screens (code-splitting is **unchecked** for this build). If it can't, the size is measured and reported to Samuel before the website step ships.
- **Browsers that can't draw the map** (too old, or 3D graphics switched off):
  - The cats map shows "The map can't show in this browser" above the list of cats.
  - The pin step offers "Use where I am now" (the browser's own location) instead of the map.
- **No other website changes.** The website has no content-security header and no service worker (searched 24 Oct 2026), so the new address needs nothing else.

### 6. Dashboard

The dashboard moves to MapLibre. Every map picture and the picture cache are removed. It is built as its **own series of PRs**: it adds three new interactive pieces and removes working flows.

- **The map engine.**
  - MapLibre's strict-security build (`maplibre-gl-csp.js`, its worker file and its CSS) joins the dashboard's stored files in place of Leaflet, in both `teamAssets.ts` and `scripts/buildAssets.mjs`.
  - `assets/dashboard-map.js` is rewritten on MapLibre: cats, groups when zoomed out, a card on tap, and a cat's trail.
  - A new script does drag-the-pin placing.
- **Every flow that uses the button map today moves to MapLibre:**
  - the cats map (`/api/team/cats?view=map`) and `/team/map`;
  - the feeding sites list, add, move and site page (SYC-585);
  - "Show on our map" from a sighting (`map-at-sighting`);
  - the colonies map steps;
  - adding an area and setting its centre;
  - the cat page map.
- **Where a pin lands goes in the POST body,** never in an address (the "no position in any address" rule, spec §10.4).
- **The map file, from the dashboard's own address.**
  - `GET /api/team/map-data/v{N}/syros.pmtiles` returns the whole file, signed-in team only. The fonts and symbols come by sibling routes with the right content types.
  - The server keeps one copy of the file in Postgres, as a single row (a few MB), with a copy in memory. The server's disk on Replit doesn't survive restarts, so the dashboard keeps working after a restart even if `tiles.catspotters.com` is down.
  - It's served with `Accept-Ranges: none`, so the browser always gets the whole file, never pieces. The browser keeps it between visits (Cache API) and hands it to MapLibre from memory. No request ever says which part of the island someone is looking at.
  - The route gets its own rate limit.
- **Security header.**
  - No new rule is needed. MapLibre's worker is loaded from our own address, which `script-src 'self'` already allows; `worker-src` falls back to it. This is proved in Chromium and Safari before relying on it; Safari is **unchecked**. If it fails, `worker-src 'self'` is added, and the exact header strings in `refuse.ts` and `test/wideCsp.ts` change with it.
  - Every page with a map is added to `WIDE_CSP_ROUTES` and `WIDE_CSP_FILES` (today only the cats grid and find-from-photo are there).
  - The worker file itself is served without the page header, so its own fetches aren't blocked.
- **Removed:**
  - the picture routes (`/api/team/map-squares`, `/api/team/map-square/:token`, the map-tiles route);
  - `tileToken.ts`, `tileCache.ts`, and the picture-joining code;
  - the button-map drawing in `mapForms.ts` and `POST /api/team/cats/map`;
  - Leaflet.
- **Kept:**
  - `ISLAND_BOX` and `inIsland` from `geometry.ts`, which move to their own file. They're used by `sightingSpot.ts`, `teamSiteWrites.ts` and `areas.ts`.
  - `readPick` in `teamSites.ts` (typed coordinates).
- **When the map can't run** (JavaScript off, or a browser too old):
  - Cats show as the grid.
  - A feeding site, area centre or colony position can be set by choosing an area from a list (it takes the area's centre), or by typing coordinates, which already works today through `readPick`.
  - A site placed by area is marked "position approximate" until someone places it on a map. That needs a new `position_approximate` yes/no column on feeding sites: an added column, so its migration reaches production **before** Samuel republishes.
  - The pages reached after a form is posted carry the strict header with no script, so this no-map path must be complete on its own.
- **Tests.**
  - The Leaflet stub tests are replaced by tests of the page data and form handling.
  - One Playwright check opens the cats map in headless Chromium, using software graphics, and sees it draw.
  - About 12 existing tests that use the button map are updated or removed.
- **The `map_tile_cache` table** is dropped in a later migration. Unusually, this happens **after** Samuel has republished the new code, because the old code reads the table until then.
  - That change also updates `photoRemoval/catalogue.test.ts` and the schema export.
  - Its rollback block uses the "-- --" comment form, and the `lib/db` runner test is run before pushing.
  - Dashboard tabs left open across the switch show blank map squares until they're reloaded (up to about a day).

### 7. Credits and licences

- "© OpenStreetMap contributors" appears on every map, with a link to the copyright page where there's room.
- NOTICE says the map is made by Cat Spotters from OpenStreetMap data, and that the map file is offered under the same licence (ODbL). Whether a published map file counts as a "derivative database" under that licence is an **unchecked** legal question; offering it under ODbL covers either answer. NOTICE also names Natural Earth (public domain) and:
  - Protomaps' builder and style (BSD; the style's licence text is checked during the build);
  - MapLibre (BSD);
  - the Noto fonts (OFL).

### 8. Rollout order (Decision D, step by step)

1. **Prove MapLibre on real phones** (a small throwaway test, not merged). A development build on a real iPhone and a real Android:
   - loads the **real adjusted style**: the two-line town names, the ▲ hill tops with heights, the † churches, the colours;
   - reads a downloaded `syros.pmtiles` and its fonts from storage, with signal off;
   - switches between English and Greek.
   
   If anything fails, say so to Samuel and use the fallback in §4 before going on.
2. **The map file and its address.** The build script, the Action and `tiles.catspotters.com`. Check with curl and in the browser.
3. **Dashboard** (its own series of PRs):
   - The `position_approximate` column goes to production first.
   - Then the code; Samuel pulls main in Replit and republishes.
   - Then, in a later change and only after that republish, the migration that drops `map_tile_cache`.
4. **Website.** Samuel pulls main and republishes.
5. **Phone apps.** A new store build. The offline download moves to our file from that build on.

Before each map goes live, there are before-and-after pictures of Ermoupoli's centre, Ano Syros, Kini, Galissas beach and the whole island, at phone width and desktop width.

## What we looked at and didn't choose

- **Google Maps** (Samuel, 24 Oct). As we understand Google's terms, the map couldn't be kept on the phone, and the dashboard's privacy would go. It also needs Google keys and billing.
- **A paid map company.**
  - None of those checked lets you choose the label language for map pictures.
  - None fixes the 1% street-name problem.
  - Each brings a key, a monthly limit, and a company that sees where people look.
- **Drawing our own map pictures for every map** (the previous version of this spec). It's the smaller change to the app, and it would look the same. But offline stays limited to pictures already stored, changing language means downloading the island again, and we'd draw and store about 360,000 pictures. Samuel chose MapLibre on 24 Oct 2026, after seeing both side by side.
- **Keeping the dashboard's no-JavaScript button map** on ready-drawn pictures. Nobody would ever lose the map, but it means building and storing about 360,000 pictures, plus a picture cache, for a backup few would use. Samuel chose no map with a plain fallback on 24 Oct 2026.

## Decisions (Samuel, 24 Oct 2026)

- **Engine:** MapLibre for every map. Samuel's words: "go with MapLibre and the adjusted style", then "dashboard on MapLibre too".
- **Dashboard without JavaScript:** no map, with a plain fallback (grid, area list). Samuel chose this from the options he was given.
- **Look:** the adjusted style shown to Samuel, with footpaths still to add (C).
- **A. French readers:** they get the English map.
- **B. Greek-only names:** spelled out automatically in Latin letters, the way Greek road signs do it.
- **D. Rollout:** step by step, in the order above, starting with the real-phone proof.

## Not changing

- Where cats and feeding sites appear, how the pin works, the map zoom limits, and the rounded squares that show a cat's published area instead of an exact spot.
- The cat page's Map tab (`components/catPage/MapTab.tsx`) stays pannable and zoomable in the MapLibre version. SYC-707 (PR #337, open on 24 Oct 2026) makes it so at Samuel's request, and the rebuild must not turn it back into a still map.
- The website still has no offline map (SYC-167).

## Risks

- **MapLibre on phones is unproven in this app.** It's a different map engine with different marker handling. Mitigation:
  - Step 1 of the rollout tests it on real phones before anything else is built.
  - The markers, the pin and the rounded area squares get the same render tests as today.
  - SYC-287 and SYC-555 (the real-phone checks) are rerun.
- **Rotation could confuse.** A two-finger twist turns the map, which today's map doesn't do. Mitigation: show the compass button, which turns the map back to north. If testers find rotation confusing, turn it off. That's one setting.
- **Our map host becomes something every map depends on.** If `tiles.catspotters.com` breaks, the website's maps go blank. Phones keep their offline file, and the dashboard server keeps its own copy of the file. Mitigation: a daily check fetches `current.json` and part of the map file, and raises a Linear ticket if either fails.
- **Most street and landmark names an English reader sees will be machine spellings.** That's 99% of streets and most landmarks. They follow the road-sign system, but some will differ from the actual sign ("Agios" where a sign says "Ayios"). Mitigation:
  - `names-added.csv` lets anyone check them.
  - Real English names always win.
  - A wrong one is fixed by adding the right English name in OpenStreetMap, which the next rebuild picks up.
- **Automatic spellings will sometimes be clumsy** ("Agios" where a sign says "Ayios"). Mitigation: real English names always win. Adding the right English name in OpenStreetMap fixes it for everyone at the next rebuild.
- **The website gets heavier,** by about 250 KB on map screens. Mitigation: it loads only where there's a map.
- **A team member with JavaScript off, or a very old browser, loses the map.** Mitigation: the grid and the area list still let them do the work. The team is small and uses ordinary phones and laptops.
- **The data goes stale between rebuilds,** so a new road appears weeks later than on openstreetmap.org. That's acceptable for this island.
