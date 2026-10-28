# SYC-705 Phase 2, Task 2b.9: real-browser check of the dashboard maps

**Current result (second run, 27 Oct 2026, built server at branch head bb4daf0fa): 184 of 184 checks pass, 0 fail.** Raw results: `check-result.json`. The first run (148 of 160, one bug) is kept below as history.

Engines: Chromium 156.0.8078.4 (software WebGL: `--use-angle=swiftshader --enable-unsafe-swiftshader`) and WebKit 27.2 (stands in for Safari; the real-iPhone check stays on SYC-287). Widths: 390 px (phone: touch, mobile emulation) and 1280 px. No app code was changed by the check.

Fixed since the first run (bb4daf0fa): the place-mode `new lib.Marker(...)` bug, the cats map's Key moved to the top left, "Use this area's centre" restyled, and the "Move the map until the pin..." line shown only when the map works. New checks this run: Key and + do not overlap (cats map, both widths); on the colony centre and move-site pickers the pin is shown, "Use this spot" is visible and lat/lng are filled after a drag; the no-script picker's "Move the map..." line is absent or hidden.

## Setup

- **Database:** scratch database `syc705_check_scratch` (migrated, seeded by `seed.mts`: 18 letters-only cats incl. a tight group in Ermoupoli, a trail cat with two sightings, a colony with a centre, a public and a private approximate feeding site, the 21 default areas). Dropped afterwards.
- **Server:** rebuilt, then `node dist/index.mjs`, `PRELAUNCH_GATE=off`. The server fetched the map files from tiles.catspotters.com on the first map request.
- **Sign-in:** signed team session cookie via `addCookies`. **Origin proxy:** `origin-proxy.mjs` gives POSTs the dashboard Origin. **No outside requests:** every non-localhost request aborted and recorded (none occurred).
- Playwright-core 1.64.1. The map-data limiter (600 per person per 10 min) is cleared on the scratch DB before each session, since every Playwright context is cold.

## Results (second run)

| Check | Chromium 390 | Chromium 1280 | WebKit 390 | WebKit 1280 |
|---|---|---|---|---|
| 1 cats map: draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 1 cats map: nothing scrolls sideways | pass | pass | pass | pass |
| 1 cats map: cat markers present | pass | pass | pass | pass |
| 1 cats map: group count in Ermoupoli at island view | pass | pass | pass | pass |
| 1 cats map: Key button and + button do not overlap | pass | pass | pass | pass |
| 1 cats map: markers' bounding boxes are 44x44 | pass | pass | pass | pass |
| 1 cats map: tapping a cat opens its card | pass | pass | pass | pass |
| 1 cats map: card closes with Escape | pass | pass | pass | pass |
| 2 focus trail: map draws and numbered trail markers present | pass | pass | pass | pass |
| 3 public site: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 3 public site: site marker present | pass | pass | pass | pass |
| 3 public site: "Position approximate" note absent | pass | pass | pass | pass |
| 3 approximate site: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 3 approximate site: site marker present | pass | pass | pass | pass |
| 3 approximate site: "Position approximate" note shows | pass | pass | pass | pass |
| 4 add a site: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 4 add a site: "Use this spot" appears | pass | pass | pass | pass |
| 4 add a site: dragging the map moves the pin's position (hidden inputs change) | pass | pass | pass | pass |
| 4 "Check the spot" page: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 4 "Check the spot" page: title and carried position | pass | pass | pass | pass |
| 4 add a site: saved position within 30 m of the pin at submit; not approximate | pass | pass | pass | pass |
| 6 colony centre picker: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 6 colony centre picker: the fixed pin and the revealed Use-this-spot controls are there (place mode finished starting) | pass | pass | pass | pass |
| 6 colony centre picker: the pin is shown and "Use this spot" is visible | pass | pass | pass | pass |
| 6 colony centre picker: lat/lng inputs are filled after a drag | pass | pass | pass | pass |
| 6b move-a-site picker: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 6b move-a-site picker: the fixed pin and the revealed controls are there | pass | pass | pass | pass |
| 6b move-a-site picker: the pin is shown and "Use this spot" is visible | pass | pass | pass | pass |
| 6b move-a-site picker: lat/lng inputs are filled after a drag | pass | pass | pass | pass |
| 7 "Show on our map": button found on the cat page | pass | pass | pass | pass |
| 7 "Show on our map": map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 7 "Show on our map": the sighting marker is centred in the map | pass | pass | pass | pass |
| 8 no console errors | pass | pass | pass | pass |
| 8 no CSP violations | pass | pass | pass | pass |
| 8 no request left localhost (none blocked, none recorded outside) | pass | pass | pass | pass |
| 8 no request URL matches the position pattern | pass | pass | pass | pass |
| 8 syros.pmtiles: requested, no Range header, status 200 | pass | pass | pass | pass |
| 5 no JS: the "Move the map until the pin..." line is absent or hidden | pass | pass | pass | pass |
| 5 no JS: picker shows the no-map line and the area list (Use this spot hidden) | pass | pass | pass | pass |
| 5 no JS: area pick leads to "Check the spot" carrying approximate=1 | pass | pass | pass | pass |
| 5 no JS: saved site page says "Position approximate" | pass | pass | pass | pass |
| 5 no JS: nothing left localhost; no console errors or CSP violations | pass | pass | pass | pass |
| 5 no JS: no request URL matches the position pattern | pass | pass | pass | pass |
| 9 Greek style (style-el.json served in place of style-en.json): style-el.json answered 200 and the map draws | pass | pass | pass | pass |
| 9 Greek style: no console errors or CSP violations | pass | pass | pass | pass |
| 9 Greek style: nothing left localhost | pass | pass | pass | pass |

Notes:
- Greek: `LIVE_LANGUAGES = ["en"]` (SYC-283), so nobody can be served an `el` page; the browser's `style-en.json` request is answered with our server's `style-el.json` (200, 45,101 bytes) so the real map draws with the Greek style. This tests the style and fonts, not the page's Greek words.
- Add-site by drag: the saved lat/lng equals the pin at submit (0 m apart) in all four runs.
- Throughout: no console errors, no CSP violation reports, no request left localhost, no request URL matched the position pattern, `syros.pmtiles` had no Range header and status 200.

## Cold-load timing (first cats-map load in a fresh context)

| Engine | Width | Navigation to `.map.maplive` | Server cold? | Map-data requests | `syros.pmtiles` bytes | Status | Range |
|---|---|---|---|---|---|---|---|
| chromium | 390 | 1909 ms | yes | 8 | 1,473,392 | 200 | none |
| chromium | 1280 | 1330 ms | no | 8 | 1,473,392 | 200 | none |
| webkit | 390 | 318 ms | no | 8 | 1,473,392 | 200 | none |
| webkit | 1280 | 259 ms | no | 8 | 1,473,392 | 200 | none |

The first row is the only one where the server also fetched the files from the tiles host (new scratch DB): about 1.9 s in software-GL Chromium. Server warm: about 1.3 s (Chromium software GL) and 0.26 to 0.32 s (WebKit). `syros.pmtiles` is 1,473,392 bytes, sent whole and uncompressed. `maplibre-gl.mjs` is 1,098,062 bytes raw (about 293 KB gzipped) and the asset route does not compress it (checked in the first run).

## Screenshots

`<engine>-<width>-<n>-<name>.png`: 1 `cats-map`, 2 `cat-card`, 3 `trail`, 4 `site-public` / `site-approx`, 5 `add-picker`, 6 `add-dragged`, 7 `add-check-the-spot`, 8 `add-saved-site`, 9 `colony-centre`, `site-move-picker` and their `-dragged` shots, 10 `show-on-our-map`, 11 `nojs-picker`, 12 `nojs-check-the-spot`, 13 `nojs-site-approx`, 14 `cats-map-greek-style-ermoupoli`.

Files: `check.mjs`, `seed.mts`, `origin-proxy.mjs`, `check-result.json`, `NOTES.md`.

## History

### First run (head 5a7fcfba1 / app commit 5618c9c5f): 148 of 160 pass, 12 fail, one bug

`artifacts/api-server/assets/dashboard-pin.js:107`:
`new window.CatMap.lib().Marker({ element: pinFor(plain), anchor: "center" })...`
This is read as `new (window.CatMap.lib)()`, i.e. it tries to construct the MapLibre module function and throws:
- Chromium: `TypeError: Class constructor WF cannot be invoked without 'new'`
- WebKit: `Unhandled Promise Rejection: TypeError: Cannot call a class constructor without |new|`

It runs inside the `.then` of `CatMap.start` in place mode, **only when the page hands the picker its own markers** (a colony's current centre, a site's current spot). Everything after the throw never runs, so on **`/api/team/colonies/<id>/centre`** and **`/api/team/sites/<id>/move`**:
- the map draws, but there is no fixed pin (`.placepin` missing) and nothing is drawn for the current centre/spot;
- the "Use this spot" button and hint stay hidden (`[data-mapon]` never revealed);
- the hidden `lat`/`lng` stay empty, so dragging the map writes nothing and a person cannot choose a new centre/spot by dragging.

It looks like it should be `new (window.CatMap.lib().Marker)(...)`. Unit tests missed it because the fake MapLibre's `Marker` is callable both ways. The add-a-site picker is unaffected (it has no markers to draw), and so is "Check the spot".

### Other failures in the first run

None. (A first run had the map-data limiter answer 429 once one scratch person had made more than 600 requests in 10 minutes: every Playwright context starts cold, a real person's browser keeps the files for a year. The runner now clears that counter on the scratch database before each session, as the SYC-396 check did with RESET_LIMIT. Not an app fault.)

