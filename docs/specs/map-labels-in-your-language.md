# Map labels in your language

Ticket: SYC-705. Revives the idea in SYC-288 (cancelled 22 Oct 2026, "serve our own Syros map tiles").
Status: **draft, awaiting adversarial review and Samuel's approval** (24 Oct 2026).
Decision behind it: Samuel, 24 Oct 2026, chose "a language-aware map" over "Google Maps everywhere" and "Google on phones only".

## The problem, as a spotter meets it

Samuel's phone and browser are set to English. Every map in Cat Spotters shows Syros in Greek: Ερμούπολη, not Ermoupoli; Άνω Σύρος, not Ano Syros. A tourist who can't read Greek can't match the map to the road sign that says "Ermoupoli", or to the name of the village where they're staying.

It happens on every map:

- the app's map of cats and the "where was the cat?" pin;
- the same two maps on the website;
- the team dashboard's island map.

**Why:** all of them use OpenStreetMap's standard map pictures. Those always print each place's local name, and on Syros that's Greek. Nothing on the phone changes it.

**What the map data already knows:** OpenStreetMap's data has English names for Syros's places. Ermoupoli carries "Ermoupoli" in English and "Ermoúpoli" in French, and Ano Syros carries "Ano Syros" and "Áno Sýros". The words exist. The standard pictures just don't use them. (Checked 24 Oct 2026 through OpenStreetMap's own place search, Nominatim. Ermoupoli and Ano Syros were checked; Kini and Galissas were not.)

**A second problem found on the way:** the app downloads the whole island's map pictures when it first opens, so the map works without signal. OpenStreetMap's map-picture policy says "Offline use is not permitted on tile.openstreetmap.org" and forbids bulk downloading. Our server's copy-keeping for the dashboard map is also something the policy "does not recommend" (operations.osmfoundation.org/policies/tiles, read 24 Oct 2026). As the app grows, OpenStreetMap could block it, and every map would go grey.

## What we're building

**We make our own map pictures of Syros, one set per language, and serve them from Cat Spotters' own address.**

We take OpenStreetMap's data for the island, draw the pictures once with labels in each language, and store them at Cat Spotters' own address (`tiles.catspotters.com`). Every map in the app, the website and the dashboard uses them.

| Reader's language | Place names on the map |
|---|---|
| English | English name (Ermoupoli). Where OpenStreetMap has no English name, see Decision B. |
| Greek | Greek name (Ερμούπολη), as today. |
| French | See Decision A. |

What this gives us:

- **English readers see English names.** Greek readers see Greek, as they do now.
- **Offline keeps working, within the rules.** The app downloads our pictures, not OpenStreetMap's.
- **No map company sees where anyone looks.** Not a spotter on the app, not a spotter on the website, not the team. Today a spotter's phone asks OpenStreetMap directly for the patch of map they're viewing. After this, it asks Cat Spotters. This is what SYC-288 wanted.
- **No bills, no keys, no outside company to depend on.** The data is free to use under OpenStreetMap's licence, provided we give credit. The island is small: about 25,000 pictures per language up to street level. That is a few hundred megabytes in all, which costs pennies a month in Cloudflare storage. That size is an estimate; the real figure comes from the first build.

### What the spotter sees

- **The map follows the app's language.** If you switch the app from English to Greek, the map's labels switch too. A map already on screen redraws with the new labels.
- **The map looks a little different.** We draw the pictures ourselves in a clean, simple style. Roads, buildings, beaches, footpaths and place names are all there, but the colours and road widths won't match openstreetmap.org exactly. Ten minutes of tuning will keep it close (Decision C).
- **Offline:** on first launch, the app downloads the island in the reader's language, as it does today. If they change language, the app downloads the island again in the new language in the background. Until that finishes, it keeps showing the old pictures. Nothing goes grey.
- **Credit line:** "© OpenStreetMap contributors", as now. OpenStreetMap's licence requires it.

### What the team sees

The dashboard's island map shows labels in the language the dashboard is set to. It is still drawn from the dashboard's own address, so the security header doesn't change.

### Precise about offline

Same as today, no more. The app (iPhone and Android) keeps the island's map on the phone at the zooms it already stores: island-wide down to street level around Ermoupoli and Ano Syros. Zooming in closer than that with no signal still shows a blurred map. The website still has no offline map (SYC-167, unchanged).

## How it works (for the build)

1. **Build the pictures, once per release of map data.**
   - Take a Syros-only extract of OpenStreetMap's data. Protomaps publishes daily builds of the world's map data, and `pmtiles extract` cuts out a box covering the island plus a margin. That box is the existing `SYROS_RECT` plus `SYROS_MARGIN_DEG`.
   - Draw the pictures with MapLibre's map-drawing engine (`@maplibre/maplibre-gl-native` in Node). Use Protomaps' open map style, one style per language. Protomaps documents a style per language that picks `name:en`, `name:el` and so on (docs.protomaps.com/basemaps/localization).
   - The output is 256-pixel PNG pictures at zooms 11–18, in OpenStreetMap's usual z/x/y numbering. Zoom 19 is not drawn: maps that zoom past 18 enlarge the zoom-18 picture.
   - A script in the repo does all of this (`scripts/map-tiles/build.mjs`). A manual GitHub Action runs it and uploads the result.
2. **Store and serve.**
   - The pictures go in a Cloudflare R2 bucket, served at `tiles.catspotters.com/v{N}/{lang}/{z}/{x}/{y}.png` with a long cache lifetime.
   - `v{N}` changes on every rebuild, so a phone never mixes old and new pictures.
   - Outside the island box, the address returns a plain sea-coloured picture, not an error.
3. **Refresh.** Rebuild when the island's map data has visibly changed, or every three months. The rebuild is a button in GitHub Actions; it needs nobody's hands but the person pressing it.
4. **App (native).**
   - `OsmTiles` and `lib/offlineTiles.ts` point at our address for the current language.
   - Offline pictures live in a folder per version and language. The "ready" flag records which version and language were downloaded.
   - The old OpenStreetMap pictures already on phones are deleted once the new set is complete.
5. **Website.** `lib/mapTiles.ts` builds addresses from our template plus the current language. The `noStrayApiCallers` test allows `tiles.catspotters.com` in place of `tile.openstreetmap.org`.
6. **Dashboard.**
   - The server's picture cache (`mapTiles/tileCache.ts`) fetches from our address instead of OpenStreetMap's.
   - The cache records the language, so the cache table gains a `lang` column. That is a database migration, and it reaches production before Samuel republishes.
   - The OpenStreetMap-specific back-off and identifying name can be simplified, because we are only asking ourselves.
7. **Credits.**
   - "© OpenStreetMap contributors" stays on every map.
   - NOTICE is updated to say the pictures are drawn by Cat Spotters from OpenStreetMap data (ODbL), using Protomaps' style (BSD/CC0; exact licence to be confirmed during the build).

## What we looked at and didn't choose

- **Google Maps** (Samuel, 24 Oct). Offline would go: we understand Google's terms don't allow keeping its pictures. The dashboard's privacy promise would go too. It also needs Google keys and billing, and all four maps would be rebuilt.
- **A paid map company with English labels.** None of the companies checked offers picture-style maps with a choice of label language. MapTiler, Stadia, Thunderforest, Geoapify and Jawg document none; Geoapify says outright that its pictures can't be relabelled. Stadia forbids keeping copies on a server. CARTO is free for charities, but whether its labels are English is unchecked, and so are its offline terms. One small company, Tracestrack, does offer a language choice, but its Greek support and its terms are unchecked. Every one of these brings a key, a monthly limit, and a company that sees where people look.
- **Switching the whole app to a different kind of map** (MapLibre vector maps, where labels change instantly). This is the most flexible option, but it swaps out the map engine on phones and on the website, which is a much bigger job. Pictures we draw ourselves get the same labels with almost no change to the app.
- **The German OpenStreetMap server**, which prints Greek with Latin underneath (Ερμούπολη / Ermoupoli; we looked at a sample). It needs no work, but its policy asks offline apps not to bulk-download either. It's a stopgap at best.

## Decisions for Samuel

**A. French readers: English or French labels?**
OpenStreetMap has French names for the big places (Ermoúpoli, Áno Sýros), but probably not for small ones.
- *French set:* the big places read naturally in French. Small places fall back to English or Greek (see B). It means one more set to build and store; that costs very little.
- *English set for French readers:* simpler, and the names match the road signs, which are in Greek and English.
- **Recommendation: a French set.** It costs almost nothing, and a French tourist reading "Ermoúpoli" is the kind touch the rest of the French app already has.

**B. A place with no English name in OpenStreetMap: what shows?**
Many small streets and beaches have only a Greek name.
- *Show the Greek name* (the usual map behaviour). Honest and simple, but some labels stay Greek for English readers.
- *Spell the Greek out in Latin letters automatically* (Οδός Ερμού → Odos Ermou), using the standard Greek-to-Latin spelling that Greek road signs use (ELOT 743). Every label becomes readable, but the build is a little more work, and an automatic spelling can look odd ("Agios" vs "Ayios").
- *Both, stacked:* Greek with Latin underneath, like the German server does. Everyone can read it, but the map gets busier.
- **Recommendation: spell it out in Latin letters automatically** for English and French readers. A tourist can then match any label to a sign.

**C. The map's look.**
- *Protomaps' "light" style, lightly tuned* to be close to today's colours: green parks, sandy beaches, white roads.
- *A style closer to openstreetmap.org's own.* It's familiar, but there's much more to draw and maintain.
- **Recommendation: Protomaps "light", lightly tuned.** You'll see before and after screenshots of Ermoupoli and Kini in the PR before anything ships.

**D. Order of the work.**
- *All four maps at once:* one change and one test round.
- *Website and dashboard first, then the phone apps:* the website is where you saw the problem, and the phone apps need a new store build to pick it up.
- **Recommendation: one PR for the picture build, then one PR per map type.** That's three to four PRs, each small enough to review.

## Not changing

- Where cats and feeding sites appear, how the pin works, map zoom limits, and the location-privacy blur on public maps.
- The website still has no offline map (SYC-167).

## Risks

- **The drawn map could look worse than OpenStreetMap's** in some places. Mitigation: before and after screenshots in the PR at three spots: Ermoupoli's centre, Ano Syros, and a beach.
- **The build needs the MapLibre drawing engine in GitHub Actions.** It runs on Linux with a virtual screen. If that proves fragile, we fall back to drawing the vector data in a headless browser with MapLibre's web engine. Same pictures, slower build.
- **Data goes stale between rebuilds.** A new road appears on openstreetmap.org weeks before it appears on our map. That's acceptable for an island where cats live on old streets.
