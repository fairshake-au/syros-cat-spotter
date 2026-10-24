# Map labels in your language

Ticket: SYC-705. Revives the idea in SYC-288 (cancelled 22 Oct 2026, "serve our own Syros map tiles").
Status: **draft, review findings folded in** (24 Oct 2026). Awaiting Samuel's decisions A–D and approval. Adversarial review: `reviews/map-labels-in-your-language-review.md` (4 blockers, 12 should-fix; all addressed below).
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

So the big places have English names. Ermoupoli and Ano Syros do, for example. Almost no streets do, so simply switching to "English names where they exist" would leave most of the map in Greek. That is why Decision B matters.

**A second problem found on the way.** The app downloads the island's map pictures from OpenStreetMap when it first opens, so the map partly works without signal. OpenStreetMap's map-picture policy says "Offline use is not permitted on tile.openstreetmap.org" and forbids bulk downloading. Our server keeping copies for the dashboard is something the policy "does not recommend". (Source: operations.osmfoundation.org/policies/tiles, read 24 Oct 2026.) As the app grows, OpenStreetMap could block it, and the maps would go grey.

**A third, smaller gap.** The phone app's map shows no "© OpenStreetMap contributors" credit. OpenStreetMap's licence requires one. The website and dashboard maps already show it.

## What we're building

**We make our own map pictures of Syros, one copy per language, and serve them from Cat Spotters' own address.**

The steps are:

1. Take OpenStreetMap's data for the island.
2. Give every place, street and beach a readable name in each language.
3. Draw the map pictures once per language.
4. Store them at `tiles.catspotters.com`.

Every map in the app, the website and the dashboard then uses them.

| Reader's language | Place names on the map |
|---|---|
| English | The English name where OpenStreetMap has one (Ermoupoli). Otherwise see Decision B. |
| Greek | Greek, as today (Ερμούπολη). |
| French | See Decision A. |

What this gives us:

- **English readers can read the map.** Greek readers see Greek, as now.
- **The offline map keeps working as it does today, within the rules.** The app downloads our pictures, not OpenStreetMap's.
- **No map company sees where anyone looks.** Today a spotter's phone or browser asks OpenStreetMap directly for the patch of map they're viewing. After this change it asks Cat Spotters. Our host, Cloudflare, carries the requests, as it already does for the rest of the site. We don't turn on logging of map requests.
- **No keys, no monthly limits, and no outside map company to depend on.** The data is free to use under OpenStreetMap's licence, as long as we credit it.

### What the spotter sees

- **The map follows the app's language.** Switch the app from English to Greek and the labels change too, including on a map that's already open. On phones the map layer is rebuilt when the language changes, because some phones don't redraw it otherwise.
- **The map looks a little different.** We draw it ourselves in a clean, simple style. Roads, buildings, beaches, footpaths and names are all there, but the colours and road widths won't match openstreetmap.org exactly (Decision C).
- **Sharper on modern phones.** The pictures are drawn at double size, so labels stay crisp on high-resolution screens.
- **Credit line:** "© OpenStreetMap contributors" stays on the website and dashboard maps, and is added to the phone app's map.
- **Outside the island:** the map shows nothing past a margin around Syros. That is what the dashboard already does, and Cat Spotters is only about Syros.

### Offline, precisely

This works the same as today, no more:

- The phone app (iPhone and Android) keeps the island's map on the phone. It stores the whole island at overview zooms, and street level around Ermoupoli and Ano Syros. That is zooms 11–16, about 1,700 pictures, roughly 20–40 MB per language. The size is an estimate; the first build gives the real figure.
- Zooming closer than that with no signal shows a blurred map.
- The website has no offline map (SYC-167, unchanged).

**Changing language on a phone.** The app downloads the island again in the new language, in the background. Until that finishes, the map keeps showing the old pictures, so nothing goes grey. When the new copy is complete, the old one is deleted, so the phone only ever keeps one language. If the language changes again mid-download, the download switches to the newest choice.

**Phones that already have the app.** They keep their current OpenStreetMap pictures until our copy has fully downloaded. Then those are deleted. Even the first launch after updating, with no signal, still shows a map.

**Phones that haven't updated the app** keep asking OpenStreetMap until they do. So the problem with OpenStreetMap's rules ends only as people update. Our map address must therefore never change in a way that breaks older app versions that already use it.

### What the team sees

The dashboard's island map shows labels in the language of the person viewing it, as the rest of the page already does. It's still drawn from the dashboard's own address, so its security header doesn't change.

## How it works (for the build)

### 1. Building the pictures

A script in the repo (`scripts/map-tiles/`) is run by a manual GitHub Action ("Rebuild Syros map"). The steps:

1. **Cut out Syros.** Download Geofabrik's Greece extract and cut a box around the island with `osmium extract`. The box is `SYROS_RECT` padded by 0.03° (about 3 km) on every side. It's a few megabytes.
2. **Fill in names** (Decision B). A small script adds a Latin-letter name to every feature that has a Greek name but no English (or French) one. It uses the standard Greek-to-Latin spelling found on Greek road signs, and writes the result to the extract. Names that OpenStreetMap already has in English are never replaced.
3. **Make the map data.** Run Protomaps' open-source map builder (`protomaps/basemaps`, built on Planetiler) over the extract. This produces one map-data file (PMTiles). The data has full detail up to zoom 15; closer zooms are drawn from the same data, enlarged.
4. **Draw the pictures**, once per language:
   - Use MapLibre's web map engine in headless Chromium, through Playwright, which the repo already uses. Each language gets its own Protomaps style.
   - Draw in large blocks of 8×8 pictures and slice them up. That's quicker, and it stops labels being cut off at picture edges.
   - The output is 512-pixel pictures shown at 256, at zooms 11–19, covering the padded box.
   - The fonts (Noto Sans, which includes Greek) and the map symbols are kept with the build, not fetched from Protomaps' site.
   - All versions are pinned: the Greece extract date, the builder, the style and MapLibre.
5. **Record the build.** A `manifest.json` per build lists the data date, every version used and the picture counts.

**Size:** about 182,000 pictures per language over the padded box at zooms 11–19, and three languages. Most of those pictures are sea, which compresses to almost nothing. The estimate is a few gigabytes in all, which is about 10 cents a month in Cloudflare R2. Uploading is within R2's free monthly allowance. All of these are estimates; the first build gives real figures.

### 2. Storing and serving

- The pictures live in a Cloudflare R2 bucket, served on the custom domain `tiles.catspotters.com` at `/v{N}/{lang}/{z}/{x}/{y}.png`.
- They carry a long cache lifetime, so Cloudflare's edge serves most requests and R2 reads stay within the free allowance. The free allowance is 10 million reads a month. A new phone downloading the island makes about 1,700 requests, so even thousands of installs a month fit.
- `v{N}` changes on every rebuild. Old versions stay for at least a year, because older app versions and phones' offline copies point at them.
- Inside the padded box every picture exists. Outside it the address answers "not found", and every map shows that as blank. The web maps hide the broken-image icon.
- **Who does it:** Claude creates the bucket, the custom domain and the DNS record with the stored Cloudflare API token, after a one-line heads-up. Claude checks it afterwards by fetching a picture with curl.

### 3. Refreshing

Rebuild every three months, or sooner when the island's data has visibly changed. It's one button in GitHub Actions. Each rebuild is a new `v{N}`. Alongside it, the build writes a tiny `tiles.catspotters.com/current.json` (`{"version": N}`) with a short cache lifetime. The app, the website and the dashboard read that file to find the current version; no API change is needed. (The API has no settings call that could carry this: searched 24 Oct 2026.) If the file can't be read, each map keeps the version it last knew, and builds carry a fallback version.

### 4. App (iPhone and Android)

- `OsmTiles` and `lib/offlineTiles.ts` take the current language and version.
- `UrlTile` gets a `key` made from the language and version, so it redraws on a change. It is told the pictures are double size.
- Offline pictures live in `tiles/v{N}/{lang}/`. The "ready" record stores the version and language it holds.
- The old `tiles/` folder and the `offline-tiles-ready-v1` record are removed once the new copy is complete.
- The map gets a small "© OpenStreetMap contributors" line, matching the website's.

### 5. Website

`lib/mapTiles.ts` builds addresses from our template plus the current language and version. The website has no content-security header and no service worker, so the new address needs nothing else. (Searched 24 Oct 2026; none found.) `mapTiles.test.ts` and the comment in `cats.tsx` that mention OpenStreetMap's address are updated. The `noStrayApiCallers` test lists allowed files, not addresses, so it needs no change unless a new file builds map addresses.

### 6. Dashboard

- **The picture token** (`tileToken.ts`) gains the language and version. Its version number goes up, so pages cached before the change, which last up to a day, simply ask again.
- **The cache** (`map_tile_cache`) gains `version` and `lang` columns. The key becomes (version, language, z, x, y), and the duplicate-handling and trimming code is changed to match. Old rows are cleared.
  - This is a database migration. It goes to production **before** Samuel republishes.
  - Its rollback block uses the "-- --" comment form. The `lib/db` runner test is run before pushing.
- **Fetching** (`tileCache.ts`) asks `tiles.catspotters.com` instead of OpenStreetMap. The cache stays: it keeps the dashboard map working if our map host has a bad hour.
- The rule "nothing logs a picture's position" stays.

### 7. Credits and licences

- "© OpenStreetMap contributors" stays on every map, with a link to the copyright page where there's room.
- NOTICE says the map pictures are drawn by Cat Spotters from OpenStreetMap data (ODbL). It also names Protomaps' builder and style (BSD; the style's licence text is checked during the build) and the Noto fonts (OFL).

### 8. Rollout order

1. Build the pictures and set up `tiles.catspotters.com`. Check sample pictures in all three languages with curl and by looking at them.
2. Dashboard: migration to production first, then the code. Samuel pulls main in Replit and republishes.
3. Website: Samuel pulls main and republishes.
4. Phone apps: a new store build. The app's offline download moves to our pictures only from that build on.

## What we looked at and didn't choose

- **Google Maps** (Samuel, 24 Oct). As we understand Google's terms, its pictures can't be kept on the phone, so offline would go. The dashboard's privacy would go too, it needs Google keys and billing, and all four maps would be rebuilt.
- **A paid map company with English labels.**
  - MapTiler, Stadia, Thunderforest, Geoapify and Jawg document no choice of label language for picture-style maps. Geoapify says outright that its pictures can't be relabelled.
  - Stadia forbids keeping copies on a server.
  - CARTO is free for charities, but whether its labels are English is unchecked, and so are its offline terms.
  - Tracestrack offers a language choice in its picture addresses, but its Greek support and terms are unchecked.
  - None of them would fix the 1% street-name problem. Every one brings a key, a monthly limit, and a company that sees where people look.
- **Switching every map to MapLibre "live-drawn" maps**, where the phone draws the map itself. It's the most flexible option, but it means swapping the map engine in the app and on the website, which is a much bigger job. Drawing the pictures ourselves gets the same labels with small changes to the app.
- **The German OpenStreetMap server.** It prints Greek with Latin underneath (Ερμούπολη / Ermoupoli; checked on a sample picture). But its policy also asks offline apps not to bulk-download, and it only covers names it already knows.

## Decisions for Samuel

**A. French readers: English or French labels?**
OpenStreetMap has French names for 20 of the 145 places on Syros, and for no streets or beaches.
- *A French copy:* the big places read the French way (Ermoúpoli, Áno Sýros). Everything else uses the Latin-letter spelling from B. It looks nearly identical to the English map, and it's one more copy to build. That costs almost nothing.
- *French readers get the English map:* simpler, and the names match the road signs, which are in Greek and English. A French tourist sees "Ermoupoli" instead of "Ermoúpoli".
- **Recommendation: French readers get the English map.** Only 20 places differ, and those differ only by accent marks. A third copy doubles the checking work for very little gain. We can add a French copy later if Syros Cats ask.

**B. Streets and places with only a Greek name: what does an English reader see?**
This affects most of the map: 99% of streets and over half the places.
- *Leave them in Greek:* honest and simple. But an English reader sees English town names on a map full of Greek streets, so most of the map stays unreadable to them.
- *Spell them out in Latin letters automatically* (Οδός Ερμού → Odos Ermou), using the same spelling as Greek road signs. Everything becomes readable, and a tourist can match a label to a sign. The cost is one more step in the build, and automatic spellings can look slightly odd (Agios vs the "Ayios" some signs use).
- *Greek with Latin letters underneath:* everyone can read it. But every label takes two lines, so the map gets crowded, especially in Ermoupoli's narrow streets.
- **Recommendation: spell them out in Latin letters automatically.** Without it, this fix mostly doesn't fix anything for streets.

**C. How the map looks.**
- *Protomaps' "light" style, adjusted* to stay close to today's colours: green parks, sandy beaches, white roads. It's clean and easy to read, but less familiar than openstreetmap.org.
- *A copy of openstreetmap.org's own style.* It's familiar, but it's much harder to rebuild and maintain ourselves.
- **Recommendation: Protomaps "light", adjusted.** Before anything ships, you'll see before-and-after pictures of Ermoupoli's centre, Ano Syros and Kini beach, on a phone and on a computer.

**D. Order of the work.**
- *Everything in one change:* one round of testing, but a very large change to review.
- *Step by step:* first build the map pictures and set up the map address. Then switch the dashboard, then the website, then the phone apps. Each step is small enough to check properly. The phone apps only get it with their next store update.
- **Recommendation: step by step**, in that order (see "Rollout order" above).

## Not changing

- Where cats and feeding sites appear, how the pin works, and the map zoom limits.
- The website still has no offline map (SYC-167).

## Risks

- **Our map host becomes something every map depends on.** If `tiles.catspotters.com` breaks, the website maps go blank. Phones keep their offline copy, and the dashboard keeps its cached pictures. Mitigation: a daily uptime check fetches one picture per language and raises a Linear ticket if any fails.
- **The drawn map could look worse in places.** Mitigation: before-and-after pictures at five spots, at street level and island-wide, before each map switches.
- **Automatic spellings will sometimes be clumsy.** Mitigation: names OpenStreetMap already has in English always win. A clumsy name can be fixed for everyone by adding the right English name in OpenStreetMap, after which the next rebuild picks it up.
- **The dashboard shrinks map pictures**, so its labels are smaller than on the website. Mitigation: the before-and-after pictures include the dashboard. If its labels are too small, the dashboard gets a slightly larger label size.
- **The data goes stale between rebuilds.** A new road appears weeks later on our map than on openstreetmap.org. That's acceptable for an island where cats live on old streets.
