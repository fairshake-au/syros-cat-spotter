# SYC-705 Phase 2, Task 2b.9: real-browser check of the dashboard maps

Run on 27 Oct 2026 against the **built** server (`pnpm --filter @workspace/api-server run build`, then `node dist/index.mjs`) at commit 5618c9c5f on branch `claude/syc-705-dashboard-maps-2b`. No app code was changed. **148 of 160 checks pass; 12 fail, all from one bug (below).** Raw results: `check-result.json`.

Engines: Chromium 156.0.8078.4 (software WebGL: `--use-angle=swiftshader --enable-unsafe-swiftshader`) and WebKit 27.2 (stands in for Safari; Samuel's real-iPhone check stays on SYC-287). Widths: 390 px (phone: touch, mobile emulation) and 1280 px.

## The one bug found (FAILS 3 checks x 4 runs)

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

## Other failures

None. (A first run had the map-data limiter answer 429 once one scratch person had made more than 600 requests in 10 minutes: every Playwright context starts cold, a real person's browser keeps the files for a year. The runner now clears that counter on the scratch database before each session, as the SYC-396 check did with RESET_LIMIT. Not an app fault.)

## Setup

- **Database:** scratch database `syc705_check_scratch` on the local Postgres, migrated with `pnpm --filter @workspace/db run migrate`, seeded by `seed.mts`: 18 cats (a tight group of 12 in Ermoupoli, others in Kini, Galissas, Posidonia, Tigris area and two just off the coast; all four sterilisation marks; letters-only names), one cat (Mavros) with two sightings (a trail), a colony "Harbour steps" with a centre, two feeding sites (a public one; a private one with `position_approximate = true`), and the default named areas (21). Dropped at the end.
- **Server:** `node dist/index.mjs` with `PRELAUNCH_GATE=off`, a scratch `TEAM_SESSION_KEYS`, dummy `AI_INTEGRATIONS_*`. The server (not the browser) fetched the map files from `https://tiles.catspotters.com` on the first map request.
- **Sign-in:** a signed team session cookie for a staff person, planted with Playwright's `addCookies` before the first navigation (as the SYC-396 check did).
- **Origin proxy:** `origin-proxy.mjs` gives POSTs the dashboard's own Origin (`https://team.catspotters.com`) so `requireOrigin` passes; browsers talk to the proxy.
- **No outside requests:** `context.route` aborts every non-localhost request and records it first. Every request is also recorded.
- **Playwright:** playwright-core 1.64.1 from the session scratchpad (`PLAYWRIGHT_CORE`), browsers from `~/Library/Caches/ms-playwright`.

## Results

| Check | Chromium 390 | Chromium 1280 | WebKit 390 | WebKit 1280 |
|---|---|---|---|---|
| 1 cats map: draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 1 cats map: nothing scrolls sideways | pass | pass | pass | pass |
| 1 cats map: cat markers present | pass | pass | pass | pass |
| 1 cats map: group count in Ermoupoli at island view | pass | pass | pass | pass |
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
| 6 colony centre picker: the fixed pin and the revealed Use-this-spot controls are there (place mode finished starting) | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| 6b move-a-site picker: map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 6b move-a-site picker: the fixed pin and the revealed controls are there | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| 7 "Show on our map": button found on the cat page | pass | pass | pass | pass |
| 7 "Show on our map": map draws (.maplive, canvas not blank) | pass | pass | pass | pass |
| 7 "Show on our map": the sighting marker is centred in the map | pass | pass | pass | pass |
| 8 no console errors | **FAIL** | **FAIL** | **FAIL** | **FAIL** |
| 8 no CSP violations | pass | pass | pass | pass |
| 8 no request left localhost (none blocked, none recorded outside) | pass | pass | pass | pass |
| 8 no request URL matches the position pattern | pass | pass | pass | pass |
| 8 syros.pmtiles: requested, no Range header, status 200 | pass | pass | pass | pass |
| 5 no JS: picker shows the no-map line and the area list (Use this spot hidden) | pass | pass | pass | pass |
| 5 no JS: area pick leads to "Check the spot" carrying approximate=1 | pass | pass | pass | pass |
| 5 no JS: saved site page says "Position approximate" | pass | pass | pass | pass |
| 5 no JS: nothing left localhost; no console errors or CSP violations | pass | pass | pass | pass |
| 5 no JS: no request URL matches the position pattern | pass | pass | pass | pass |
| 9 Greek style (style-el.json served in place of style-en.json): style-el.json answered 200 and the map draws | pass | pass | pass | pass |
| 9 Greek style: no console errors or CSP violations | pass | pass | pass | pass |
| 9 Greek style: nothing left localhost | pass | pass | pass | pass |

Notes on the table:
- **Check 5 (JavaScript off)** ran in a separate `javaScriptEnabled:false` context at each width; the picker shows the no-map line and the 21-area list ("Use this spot" stays hidden), an area pick leads to "Check the spot" carrying `approximate=1`, and the saved site page says "Position approximate" (database `position_approximate = t`).
- **Check 4:** the pin position read from the hidden inputs just before "Use this spot" matched the database row exactly (0 m apart) in all four runs. The picker needs a zoom-in (the two `+` presses) before the pin can be moved sideways, because at the start zoom the island fills the box's width and the map can't leave the island bounds.
- **Check 7:** the sighting marker sits at the exact centre of the map (0 px off) in all four runs.
- **Check 1:** the number of cat markers at the island view is 5 at 390 px (a group of 14 including a nearby cat) and 6 at 1280 px (a group of 13). All were 44 x 44.
- **Check 9 (Greek):** Greek and French are not live on the dashboard (`LIVE_LANGUAGES = ["en"]`, SYC-283), and the team and guardians are all served English, so no person (a cat guardian included) can be made to see an `el` map. Instead the browser's request for `style-en.json` was answered with our own server's `style-el.json` (HTTP 200, 45,101 bytes) so the page's real map drew with the Greek style; screenshots `*-14-cats-map-greek-style-ermoupoli.png` show Greek-only labels. English screenshots are the others. This tests the Greek style and fonts, not the page's own Greek words.
- **Check 8 per run:** no console errors except the bug above; no CSP violation reports (console text or `securitypolicyviolation` events); no blocked request and no request to any host but localhost (173 to 207 requests per run); no request URL matched `/3[67]\.\d{2,}|2[45]\.\d{2,}|lat=|lng=/i`; `syros.pmtiles` had no `Range` header and status 200 every time.

## Cold-load timing and map file

The first cats-map load in each fresh browser context (cold browser cache, so the whole map file and fonts are downloaded):

| Engine | Width | Navigation to `.map.maplive` | Server cold? | Map-data requests | `syros.pmtiles` bytes | Status | Range header |
|---|---|---|---|---|---|---|---|
| chromium | 390 | 1955 ms | yes (map files fetched by the server from tiles.catspotters.com during this request) | 8 | 1,473,392 | 200 | none |
| chromium | 1280 | 805 ms | no (server already held the files) | 8 | 1,473,392 | 200 | none |
| webkit | 390 | 320 ms | no (server already held the files) | 8 | 1,473,392 | 200 | none |
| webkit | 1280 | 282 ms | no (server already held the files) | 8 | 1,473,392 | 200 | none |

- The **first** row is the only one where the server also had to fetch the files from the tiles host (map file table emptied and the server restarted just before the run): **about 2.0 s** from navigation to the map being live, in software-GL Chromium. With the server holding the files, a cold browser took about 0.8 s (Chromium, software GL) and about 0.3 s (WebKit). Software WebGL in Chromium is slower than a real device's GPU.
- Each cold load made **8 map-data requests** (version, style, the map file, 2 sprite files and 3 font ranges at this view) and 17 to 19 requests in all.
- `syros.pmtiles` is **1,473,392 bytes** (about 1.5 MB), sent whole, uncompressed, no `Content-Encoding`.
- `maplibre-gl.41198b23679a.mjs` is 1,098,062 bytes raw, about 293,082 bytes gzipped by `gzip -c`, but the asset route **does not compress**: it answered `Accept-Encoding: gzip, br` with no `Content-Encoding` and `Content-Length: 1098062` (cache header `public, max-age=31536000, immutable`). The worker `maplibre-gl-worker.1c6906636833.mjs` is 518,806 bytes raw. (Replit's front end may compress in production; not checked here.)

## Screenshots

`<engine>-<width>-<n>-<name>.png` in this folder, for chromium and webkit at 390 and 1280:
1 `cats-map`, 2 `cat-card`, 3 `trail`, 4 `site-public` and `site-approx`, 5 `add-picker`, 6 `add-dragged`, 7 `add-check-the-spot`, 8 `add-saved-site`, 9 `colony-centre` and `site-move-picker` (both show the bug: no fixed pin), 10 `show-on-our-map`, 11 `nojs-picker`, 12 `nojs-check-the-spot`, 13 `nojs-site-approx`, 14 `cats-map-greek-style-ermoupoli`.

## Files

`check.mjs` (the check), `seed.mts` (the scratch data and session cookies), `origin-proxy.mjs`, `check-result.json`, `NOTES.md`.

Run: `ENGINES`/`WIDTHS` (comma lists) narrow the run; env `BASE`, `SEED`, `OUT`, `PLAYWRIGHT_CORE`, `DBNAME` as in the file header.
