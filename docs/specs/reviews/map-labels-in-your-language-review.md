# Adversarial review: Map labels in your language (SYC-705)

Reviewer: independent subagent (Sonnet), 24 Oct 2026, read-only against branch `claude/google-maps-migration-8a087c` at commit 1672721d. Each finding below says how it was handled in the revised spec.

## Blockers

- **B1. The zoom range didn't match the code.** The web and dashboard maps go to zoom 19, and the dashboard's cache refuses anything outside zooms 12–19 (`geometry.ts:20`, migration 0022). The phone app's offline copy is zooms 11–16 only: about 1,681 pictures, not 25,000.
  → *Revised:* the build covers zooms 11–19, so no map has to change its zoom limits. The spec now lists the zooms each map uses.
- **B2. Spelling Greek in Latin letters can't be done inside a Protomaps style.** The style only reads `name:en`, and falls back to the Greek name when there isn't one. Spelling names out needs a step that edits the data before the map is drawn.
  → *Revised:* the build pipeline now adds that step (Syros extract, then the spelling step, then the map build). We also counted how many names are missing: 1% of streets have an English name (see the spec).
- **B3. "A sea-coloured picture outside the box" isn't possible with plain R2 storage, which returns "not found".**
  → *Revised:* we draw every picture inside a box that is padded around the island, so nothing inside it is ever missing. Outside the box, every map shows nothing, which is how the dashboard already behaves. Tile servers only send the parts of a map that are needed, so this needs no Worker.
- **B4. The dashboard section was wrong on how the map gets its language and how pictures are cached.** The picture token needs a language. The cache's key is (z, x, y), and both the duplicate handling and the trimming are keyed on it. If the version isn't in the key, an old picture could be served for up to 30 days after a rebuild.
  → *Revised:* the token carries the language and the version. The cache key becomes (version, language, z, x, y). The migration ordering and the rollback comment rule are stated.

## Should-fix

- **S1.** The phone app's offline download is one shared piece of code with no language. It needs a way to notice a language change. A map that is already on screen may not redraw on iOS when the picture address changes (unchecked).
  → The spec now gives the trigger and gives the map layer a `key` tied to the language and version, so it redraws.
- **S2.** Edge cases: the language changing mid-download, phones low on storage, existing installs, and old app builds that still ask OpenStreetMap.
  → All are covered in the "Offline" section and the rollout order.
- **S3.** Fragile build: the data only has detail up to zoom 15; fonts and sprites have to be stored with the build; pictures look blurry on retina phones; the dashboard shrinks pictures, which makes labels smaller; the build must be repeatable.
  → The spec now covers all of these. Pictures are drawn at double size, fonts and sprites are kept with the build, a manifest records each build, and Playwright is the main way of drawing.
- **S4.** The website has no content-security header and no service worker (searched). The new address needs nothing extra.
  → Stated in the spec.
- **S5.** Cost needs numbers, including the free monthly allowance of reads from R2.
  → Numbers added. Cloudflare's own copies at the edge absorb most reads.
- **S6.** Cloudflare (our host) sees requests.
  → Stated. Logging is off by default.
- **S7.** Licence: the phone app's map currently shows **no** OpenStreetMap credit. Only the web and dashboard maps have it (`AppMap.web.tsx:235`, `LocationPicker.web.tsx:208`).
  → The spec now adds the credit to the phone app's map.
- **S8.** The headline "English readers see English names" oversold it.
  → Rewritten with the measured coverage.
- **S9.** Our map host becomes the one thing every map depends on.
  → Covered in Risks: an uptime check, the phone's offline copy, and the dashboard's cache.
- **S10/S11.** Rollout order, and who does the Cloudflare steps.
  → Added: Claude does them with the stored API token, with a heads-up before creating anything.
- **S12.** "Offline keeps working" needed "partly".
  → Fixed.

## Plain English and nits

- Jargon removed from the decisions ("ELOT 743", "set", "falls back"). The "ten minutes of tuning" estimate is gone. Decision D now spells out the order and says the phone apps need a store update.
- The `noStrayApiCallers` test is a list of allowed files, not hosts. The spec's wording is fixed. `mapTiles.test.ts:94` and a comment in `cats.tsx:130` mention the OpenStreetMap address and need updating.
