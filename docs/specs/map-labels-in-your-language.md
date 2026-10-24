# Map labels in your language

Ticket: SYC-705. Revives the idea in SYC-288 (cancelled 22 Oct 2026, "serve our own Syros map tiles").
Status: **draft v3, rewritten for MapLibre on every map** (24 Oct 2026). Samuel chose MapLibre and the adjusted style after seeing them side by side, then chose MapLibre for the dashboard too. Needs a fresh adversarial review, then approval. The v2 review (`reviews/map-labels-in-your-language-review.md`) covered the picture-based design; its points that still apply are carried over.
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
| English | The English name where OpenStreetMap has one ("Ermoupoli", with "Ερμούπολη" underneath for towns and villages). Everything else is spelled in Latin letters ("Odos Ermou"). |
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

- **Phone app (iPhone and Android).** After its first download, the phone holds the whole island's map data. With no signal, it shows the full map at any zoom, in the reader's language, with the cat markers the app already keeps. The download is one file of a few megabytes (estimate; the first build gives the real size). The fonts and symbols the map needs are downloaded with it.
- **Before that first download finishes,** for example on a phone that has never had signal since installing, the map is blank. That's the same as today.
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
2. **Fill in names** (Decision B).
   - A small script adds `name:en` to every feature that has a Greek name but no English one.
   - The spelling follows the standard Greek-to-Latin system used on Greek road signs.
   - Names OpenStreetMap already has in English are never replaced.
   - Each added name is also tagged as generated (`name:en:auto=yes` inside the file only), so its spelling can be checked later.
3. **Build the file.**
   - Run Protomaps' open-source map builder (`protomaps/basemaps`, built on Planetiler) over the extract.
   - That gives `syros.pmtiles`, with detail down to zoom 15. Closer zooms are drawn from the same data, so the map stays sharp.
4. **Fonts and symbols.** The map's fonts (Noto Sans, which includes Greek) and symbols are built from Protomaps' published assets, pinned to a version and hosted with the file. Nothing is fetched from Protomaps' own site at run time.
5. **Record it.** A `manifest.json` lists the data date, every tool version, the file size and the number of names added in step 2.

### 2. Hosting

- **Where it lives.** A Cloudflare R2 bucket on the custom domain `tiles.catspotters.com` holds:
  - `/v{N}/syros.pmtiles`, the map file;
  - `/v{N}/fonts/…` and `/v{N}/sprites/…`, the fonts and symbols;
  - `/v{N}/manifest.json`;
  - `/current.json` (`{"version": N}`).
- **Browser access.** The bucket allows the website's address to read it (CORS) and supports reading part of a file (range requests), which is how browsers fetch only what they need.
- **Caching.** Files under `/v{N}/` never change, so they carry a long cache lifetime. `current.json` carries a short one.
- **Old versions** stay for at least a year, because older app versions point at them.
- **Who does it.** Claude creates the bucket, the domain, the DNS record and the CORS rule with the stored Cloudflare API token, after a one-line heads-up. Claude then checks with curl: a part-of-file request returns 206, and the CORS header is present.
- **Cost.** A few megabytes of storage per version. Each phone downloads the file once per version. Browsers make a few hundred small part-of-file requests per visit, and Cloudflare's own copies at the edge serve most of them. That stays well inside R2's free allowance of 10 million reads a month. These figures are estimates and are checked after launch.

### 3. Refreshing

- **When.** Rebuild every three months, or sooner when the island's data has visibly changed. It's one button in GitHub Actions.
- **How it rolls out.** Each rebuild makes a new `v{N}` and updates `current.json`.
- **Phone app.** It reads `current.json` when it has signal. If there's a newer version, it downloads it in the background and switches over once it's complete.
- **Website.** It reads `current.json` on each visit.
- **Dashboard.** It reads `current.json` through its own address, and its server fetches the new file once.

### 4. App (iPhone and Android)

- **Map engine.** Replace `react-native-maps` with `@maplibre/maplibre-react-native`. It has an Expo config plugin and works with the store builds made on EAS (Expo's build service).
- **Rebuilt components.** `AppMap.tsx` (the cat markers and the rounded area squares) and `LocationPicker.tsx` (the pin) are rebuilt on MapLibre. `OsmTiles.tsx` and the picture download in `lib/offlineTiles.ts` are removed.
- **Shared geometry.** `lib/cellShape.ts` keeps its geometry and drops the `react-native-maps` types.
- **The offline file.** A new `lib/offlineMap.ts` downloads `syros.pmtiles`, the fonts and the symbols into the app's own storage. It records the version it holds, and the map reads the file from there.
  - MapLibre on Android can read a PMTiles file from device storage (MapLibre Android 11.7 and later; maplibre.org/maplibre-native/android/examples/data/PMTiles).
  - Whether `maplibre-react-native` passes this through on **both** iPhone and Android is **unchecked**, so PR 1 proves it first (see Rollout).
- **Fallback.** If reading the file directly doesn't work on one platform, the fallback is MapLibre's own offline storage, filled from the same data. That would need a small Cloudflare Worker that hands out the file in pieces. Protomaps publishes one.
- **Language.** The style takes the app's language. Changing language swaps the label field (`name:en` or `name:el`) without reloading the map.
- **No Google key.** `app.config.js` drops `GOOGLE_MAPS_ANDROID_API_KEY` and its build check.
- **Credit.** The map shows "© OpenStreetMap contributors".

### 5. Website

- **Map engine.** `AppMap.web.tsx` and `LocationPicker.web.tsx` are rebuilt on `maplibre-gl` with the `pmtiles` library, reading `tiles.catspotters.com/v{N}/syros.pmtiles`. `lib/mapTiles.ts` (today's picture-drawing code) is removed. Its tap-to-position maths is replaced by MapLibre's own.
- **Size.** MapLibre adds roughly 250 KB (compressed) to the website. It loads only on screens with a map, so Home and other screens don't wait for it.
- **Very old browsers.** MapLibre needs WebGL. Browsers without it see a plain box saying "The map can't show in this browser." What a spotter can do instead (for example, use the phone's own location) is settled in the plan.
- **No other website changes.** The website has no content-security header and no service worker (searched 24 Oct 2026), so the new address needs nothing else.

### 6. Dashboard

The dashboard moves to MapLibre. Every map picture and the picture cache are removed.

- **The map engine.**
  - MapLibre's strict-security build (`maplibre-gl-csp.js` and its worker file) is stored with the dashboard's other files, as Leaflet is today (`scripts/buildAssets.mjs`, `teamAssets.ts`). It replaces Leaflet.
  - `assets/dashboard-map.js` is rewritten on MapLibre: cats, groups when zoomed out, a card on tap, and a feeding site's trail.
  - A new small script does the drag-the-pin placing for feeding sites (SYC-585).
- **The map file, from the dashboard's own address.**
  - `GET /api/team/map-data/v{N}/syros.pmtiles` returns the whole file. The server fetches it once from `tiles.catspotters.com`, keeps it on disk, and serves it with a long private cache lifetime.
  - The fonts and symbols come the same way.
  - The browser downloads the whole file, never pieces of it, so no request says which part of the island someone is looking at. The "no position in any address" rule (spec §10.4) still holds.
  - Signed-in team members only, like the rest of the dashboard.
- **Security header.** The map page gains `worker-src 'self'`, because MapLibre draws in a background worker loaded from our own address. Everything else stays `'self'`; nothing is loaded from another site.
- **Removed:**
  - the picture routes (`/api/team/map-squares`, `/api/team/map-square/:token`, the map-tiles route);
  - `tileToken.ts`, `tileCache.ts`, and the picture-joining code;
  - the button-map forms (`mapForms.ts`, `POST /api/team/cats/map`);
  - Leaflet.
- **The `map_tile_cache` table** is dropped in a later migration, after the new code is live. The old code still reads it until then.
  - The migration reaches production only after Samuel has republished the new code.
  - Its rollback block uses the "-- --" comment form, and the `lib/db` runner test is run before pushing.
- **No map** (JavaScript off, or no WebGL): see "What the team sees".
  - Areas already exist (`seedAreas.ts`). A site placed by area gets the area's centre and is flagged "position approximate".
  - The exact wording, and where the flag shows, are settled in the plan.
- **Logging.** The server never logs which part of the file was asked for, and with whole-file downloads there is nothing to log anyway.

### 7. Credits and licences

- "© OpenStreetMap contributors" appears on every map, with a link to the copyright page where there's room.
- NOTICE says the map is made by Cat Spotters from OpenStreetMap data (ODbL). It also names:
  - Protomaps' builder and style (BSD; the style's licence text is checked during the build);
  - MapLibre (BSD);
  - the Noto fonts (OFL).

### 8. Rollout order (Decision D, step by step)

1. **Prove MapLibre on real phones** (a small throwaway test, not merged). A development build on a real iPhone and a real Android reads a downloaded `syros.pmtiles` with signal off and shows Greek and English labels. If either fails, use the fallback in §4 and say so before going on.
2. **The map file and its address.** The build script, the Action and `tiles.catspotters.com`. Check with curl and in the browser.
3. **Dashboard.** The code first. Samuel pulls main in Replit and republishes. Then, in a later change, the migration that drops `map_tile_cache`.
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
- The website still has no offline map (SYC-167).

## Risks

- **MapLibre on phones is unproven in this app.** It's a different map engine with different marker handling. Mitigation:
  - Step 1 of the rollout tests it on real phones before anything else is built.
  - The markers, the pin and the rounded area squares get the same render tests as today.
  - SYC-287 and SYC-555 (the real-phone checks) are rerun.
- **Rotation could confuse.** A two-finger twist turns the map, which today's map doesn't do. Mitigation: show the compass button, which turns the map back to north. If testers find rotation confusing, turn it off. That's one setting.
- **Our map host becomes something every map depends on.** If `tiles.catspotters.com` breaks, the website's maps go blank. Phones keep their offline file, and the dashboard server keeps its own copy of the file. Mitigation: a daily check fetches `current.json` and part of the map file, and raises a Linear ticket if either fails.
- **Automatic spellings will sometimes be clumsy** ("Agios" where a sign says "Ayios"). Mitigation: real English names always win. Adding the right English name in OpenStreetMap fixes it for everyone at the next rebuild.
- **The website gets heavier,** by about 250 KB on map screens. Mitigation: it loads only where there's a map.
- **A team member with JavaScript off, or a very old browser, loses the map.** Mitigation: the grid and the area list still let them do the work. The team is small and uses ordinary phones and laptops.
- **The data goes stale between rebuilds,** so a new road appears weeks later than on openstreetmap.org. That's acceptable for this island.
