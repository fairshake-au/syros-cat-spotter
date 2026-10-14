# SYC-209: feeding sites and colonies on the dashboard

**Status: approved by Samuel, 13 Oct 2026. The build starts with the docs PR (D209) and Slice 0.** Samuel decided all three questions on 13 Oct 2026: 1A, 2B and 3C, each as recommended (see "Decisions for Samuel"). The Safari and Firefox tap check (3C) has been run and passes (see "The tap test"). Adversarially reviewed by an independent Sonnet critic on 12 Oct 2026: no blockers, ten majors and ten minors, all folded in (see "Review").
**Spec:** `docs/specs/feeding-sites-and-colonies.md`, approved by Samuel on 12 October 2026 (PR #103, merged as `50c6262`). This plan builds it as written. Where the spec and the code on `main` disagree, the plan says so in "Where the spec and the code disagree" and does not decide quietly.
**Builds on:** `roles-and-invites.md` (the capability names, approved 12 Oct 2026) and its plan in progress (`claude/syc-53-plan`, draft "SYC-53 plan: roles and invites", read at `e21a16e`); `cat-record-data-spine.md` §6.5, §6.7, §10.1, §10.5; `team-access-and-welfare-queue.md`; `DECISIONS.md` F2, Part 2h, Part 2m. Its format follows `syc-43-part-2-welfare-queue-and-corrections.md`.
**Linear:** SYC-209 (this plan; parent SYC-43). Builds SYC-245, SYC-255 and SYC-263, and the feeding-site half of SYC-256. Touches SYC-53, SYC-22, SYC-51, SYC-54, SYC-67, SYC-208, SYC-257, SYC-283, SYC-4.
**Checked against:** `origin/main` at `586763a` (12 October 2026); the open PRs (#101, #107, #111); the SYC-53 plan branch at `e21a16e`; and Linear SYC-209 with all its comments, plus SYC-43, SYC-53, SYC-22, SYC-51, SYC-67, SYC-245, SYC-255, SYC-256, SYC-257 and SYC-263. Every "exists today" claim names the file it was read in.

---

## In plain English

Syros Cats already know where every feeding spot on the island is, and they already have names for their colonies ("Vaporia — Eleni's"). None of that is in the app. This plan gives the team three things on their dashboard, and later gives visitors one thing in the app.

**Before launch, for the team only:**

1. **Colonies, with the names they already use.** Create a colony, rename it when a guardian changes (the old name still finds it), and say which cats belong to it. Nothing about a colony is ever public.
2. **A private map of feeding sites.** Tap the map to place a site, move it when the pin is wrong, retire it when the spot closes. Every site starts private. Nobody outside the team can see any of it.
3. **A history of every change.** Who added, moved, renamed or retired what, and when. It can never be edited, only blanked if a guardian asks to be forgotten.

**When cat guardians get accounts** (after the roles work): a guardian sees only her own colonies and their sites. She can create a colony, add and take out her own cats, and add, fix and retire her own sites. She can **ask** for a site to be public, but she can never make one public herself. Her phone can keep her sites for 72 hours with no signal.

**After launch, for everyone:** the team can make one site at a time public, after a page that shows exactly what a visitor will see. A visitor then sees a bowl on the app's map at that spot. Tapping it says roughly how many cats live there ("About 10 cats use this spot"), and asks people to give the cats room, not to leave food, and to see how they can help. Making a site private again is one tap.

**How it is built.** Small pull requests, each safe to merge on its own. The order is: the records first, then colonies, then the private map, then guardians, then (after launch) the public half. The map is the riskiest piece. Before any of it is built, the plan tested the one thing the map relies on, in a real browser (see "The tap test").

### What people notice, step by step

| After | What people notice |
|---|---|
| **The docs PR** | Nothing. The specs agree with each other |
| **Slice 0: preconditions** | The team's cat page, welfare queue and alert email stop sending exact positions to Google (Decision 2 says how). Nothing else |
| **Slice 1: the records** | Nothing. The database can now hold everything below |
| **Slice 2: colonies** | The team gets a **Colonies** page: create, rename, guardian's name, notes, history. They can put cats in a colony and take them out. The team's cat page says "Vaporia — Eleni's", not "colony 12" |
| **Slice 3: the private map** | The team gets a **Feeding sites** page: a map of the island, add a site by tapping, move, retire, bring back, history. "Make a feeding site here" on a cat's sighting |
| **Slice 4: guardians** | A guardian with an account sees only her own colonies and sites, in English, Greek or French; she can create a colony, manage her own cats and sites, and is told when a cat of hers moves to another colony. The team sees a "Recent guardian changes" list |
| **Slice 5: forgetting a guardian's name** | Nothing visible. The tool that blanks a guardian's name everywhere is ready for the management button (SYC-208) |
| **Slice 6 (after launch): public sites** | The team can make a site public, one at a time. Visitors see a bowl on the map with a short card, in English, Greek and French |

---

## What exists today, and what this plan needs

Checked by a Sonnet read-only sweep of `origin/main` at `586763a`, then spot-checked by the session model. AS = `artifacts/api-server/src`, APP = `artifacts/cat-spotter`.

| Needed | Exists on `main`? | Evidence |
|---|---|---|
| `colonies` table | **Yes.** `id`, `name`, `normalised_name` (unique, folded), `guardian_name` (text), `lat`/`lng` (team-only centre), `notes`, `created_by` (**text**, not a link), `created_at`. No `updated_at` | `lib/db/src/schema/colonies.ts`; migration `0001_data_spine_tables.sql` |
| `colony_name_history` | **Yes.** `colony_id`, `name`, `normalised_name`, `replaced_at`, `replaced_by` (text). No redaction columns | same |
| `feeding_sites` table | **Yes, the spine's shape only.** `name`, `colony_id`, `lat`/`lng`, `is_public` (default false), `made_public_by` (**text**), `made_public_at`, `notes`, `created_at`. **No** `public_label`, `public_id`, `directions`, `last_public_position`, `guardian_aware`, `retired_at`, `updated_at` | same |
| Any route or screen for sites or colonies | **No.** The only code touching `feeding_sites` is a test proving a private site is absent from the public payload | `AS/routes/publicPayload.blur.test.ts:22, :205` |
| One folding function for names | **Yes.** `foldName` (accents, case, final sigma, Cf characters), with its SQL twin and an agreement test | `lib/db/src/fold.ts`, `foldSql.ts`, `foldSql.test.ts` |
| The `colony` observation | **Yes, but number-only.** `{ colonyId: number }`; `null` is refused | `AS/lib/observations.ts:214–217` |
| Writing a colony statement from the dashboard | **No.** `capabilityFor` returns null for `colony`; `SUPERSEDE_CAPABILITIES` is `set_life_status`, `set_sterilisation` only; `roleAtTime: "staff"` is hard-written in four places | `AS/lib/teamCorrections.ts:43, :51, :141, :193, :300, :391` |
| The capability names this spec cites | **Two of ten.** `set_site_public` and `rename_colony` exist; `add_feeding_site`, `edit_feeding_site`, `reassign_feeding_site`, `request_site_public`, `create_colony`, `edit_colony`, `assign_cat_to_colony`, `view_guardian_changes` do not. `can()` ignores its target and answers "holds `staff`?"; no `canSomewhere`; every refusal is a 401 | `AS/lib/capabilities.ts`, `AS/middlewares/requireTeam.ts` |
| The dashboard's security header | **Yes, and pinned by a test.** `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, plus `Cache-Control: no-store` | `AS/lib/teamAuth/refuse.ts:21–29`; `AS/routes/team.headers.test.ts:22, :132–134` |
| Outbound links to a map company | **Yes, three places.** Team cat page ("Open map", Google); welfare queue (Google); welfare alert email (Google **and Apple**) | `AS/lib/teamPages/catPages.ts:63`; `queuePage.ts:67`; `AS/lib/welfare/alertEmail.ts:58–59, :183`; tests `team.queuePage.test.ts:148`, `reports.test.ts:501–502` |
| The team cat page's colony line | Shows `Put in colony 12` (the raw number) | `AS/lib/teamCatView.ts:158–161` |
| Request logging | `pino-http` with `redactRequestUrl`: query strings dropped, paths kept; only device-id paths are redacted. **A tile path would be logged in full** | `AS/app.ts`; `AS/lib/logger.ts:50–52` |
| The route walk | Walks the router, expects at least 23 `/api/team` routes, each answering the same `401` with no session | `AS/routes/team.walk.test.ts` |
| Serving images from the server | Yes, bytes from Postgres with a stored type (photos). No image proxy, and no outbound fetch sets a `User-Agent` | `AS/routes/photos.ts:28`, `AS/routes/teamReports.ts:67, :93`, `AS/lib/push.ts:16` |
| Public-read rate limits | In memory, per server, per address (`express-rate-limit`); `photoLimiter` 300 per 15 minutes is the model | `AS/middlewares/rateLimit.ts` |
| The app's map | Web: OSM tiles drawn by the app with cells laid over them; native: `react-native-maps`. Offline tiles from `tile.openstreetmap.org`, island box 37.36–37.53 N, 24.85–25.01 E | `APP/components/AppMap.web.tsx`, `AppMap.tsx`, `APP/lib/offlineTiles.ts` |
| The cats cache key | `cat-spotter/cats-cache/public/v2` | `APP/lib/catalogue.ts:16` |
| The app's strings | One file, `en`/`el`/`fr`, with a parity test (same keys, no empty values, same placeholders). **The API server cannot import it today** (no dependency between the two packages) | `APP/lib/i18n.ts:1464`; `APP/lib/__tests__/i18n.test.ts` |
| Campaign copy | In the API server, not the app. Default title `"Help us desex the Vaporia colony"` | `AS/lib/campaign.ts:62` |
| `Clear-Site-Data`, service worker | None anywhere | grep of `artifacts`, `lib`, `scripts` |
| Add-only history pattern | `photo_visibility_events`: a trigger refusing update and delete, a truncate guard, an author check | `lib/db/migrations/0014_photo_visibility.sql` |
| Redaction pattern | The `observations` trigger allows exactly one update: setting `redacted_at` and `redaction_reason`, with the rest unchanged | `0001_data_spine_tables.sql:81–129` |
| Migrations | `0000`–`0014` on `main`; each file ends with a commented rollback; CI runs `migrate:check` and an up/down/up of the real history | `lib/db/migrations/`, `lib/db/package.json`, `.github/workflows/ci.yml:61` |
| db-ops | `migrate`, `migrate-rollback`, `verify`, `smoke`, people commands. **No read-only query command** | `scripts/db-ops.sh` |
| Tests | `supertest` against a throwaway real Postgres with every migration applied | `artifacts/api-server/vitest.config.ts`, `AS/test/globalSetup.ts` |

### What this plan takes from the SYC-53 plan

The roles plan (`claude/syc-53-plan`, draft PR "SYC-53 plan: roles and invites", read at `e21a16e`) is still being written and is not approved. Its Decision D (recommended) says **SYC-209 builds the colony and feeding-site screens and routes; SYC-53 builds the powers they ask for.** This plan is written to that split. Every roles piece it needs is named below by PR number **and** by purpose, so the two can be lined up if the roles plan is renumbered.

| What SYC-209 needs | SYC-53 plan PR | Needed by |
|---|---|---|
| The `colony` observation accepts `{ colonyId: null }` ("in no colony") | **0.2** (vocabulary) | Slice 2, PR 2.2 (if 0.2 hasn't merged, PR 2.2 adds it and 0.2 drops that bullet) |
| `actingRole()`, so a guardian's statement carries her real role | **0.2** | Slice 4 (until then the team's statements say `staff`, as today) |
| The capability catalogue (all ten names above), strict `can()`, `canSomewhere()`, the 403 page, targets read from the record, and the route walk with a row per route | **0.5** | Slice 4 (Slices 2 and 3 can ship before it: Decision 1) |
| Guardian placements (`person_scopes.reach`, the database refusing an island-wide guardian) | **0.3** | Slice 4 |
| `createColonyWithPlacement(person, colony)`: a guardian's new colony and her placement on it, in one transaction | **1.1** | Slice 4, PR 4.2 |
| The dashboard's three-language string catalogue | **1.0** (SYC-251) | Slice 4 (guardians read these pages; the team's own pages stay English, spec Decision 9) |
| A guardian's own colony page (`/api/team/my/colonies/:id`), which lists her sites | **2.1** | Slice 4, PR 4.1 provides the filtered site query it calls |
| `listGuardianChanges()` | **2.2** | Slice 4, PR 4.3 |
| "Needs an OK" and the site-public request | **3.4** | Slice 6 (see conflict K7) |
| The saved list with no signal, `Clear-Site-Data` | **4.2** (SYC-54) | Slice 4's site query; this plan builds no separate offline PR |

**The roles plan's tests that travel with this plan's PRs:** T16 (a guardian's colony change is immediate, recorded, refused for a colony she doesn't hold, moves a cat out of another colony with a line for its guardian, and appears on the guardian-changes list) is built in PR 4.2. T30 (the routes half: a guardian holds placed powers for her new colony only, can't rename it, and a team member who creates a colony isn't placed on it) is built in PR 4.2.

**Route names.** SYC-209 owns `/api/team/colonies…`, `/api/team/sites…` and `/api/team/map-tiles…`; SYC-53 owns `/api/team/my/…` and `/api/team/people…`. Neither plan writes the other's paths.

---

## Where the spec and the code disagree

Each is a "how". None changes what anyone experiences, unless it points to a decision.

| # | The spec says | The code, or another approved document, says | What this plan does |
|---|---|---|---|
| **K1** | §10 and §5.2: "the server imports the app's string file" so the card's words live in one place | The API server can't import `APP/lib/i18n.ts` (no package dependency; the app file is a large React Native module) | The card's twelve strings move to a small shared module (`lib/feeding-spot-strings`, a workspace package both import). `i18n.ts` spreads it into each language, so the app's parity test still covers them, and a second test checks the server's preview uses the same object. One place, as the spec wants |
| **K2** | §11.1: `made_public_by` becomes a link to people. Spine ask 5 originally said the same of `colonies.created_by` | Both are `text` today. **Updated 14 Oct 2026:** the approved roles plan (finding C7, applied to the spec by #133 and to the spine by #129) keeps `colonies.created_by` as text holding the creator's person id, with no foreign key | PR 1.2 converts **only** `feeding_sites.made_public_by` to a strict link to `people.id`, in a checked migration that refuses with a list if any value isn't a person's id. `colonies.created_by` stays text; the roles plan's `createColonyWithPlacement` and this plan's colony routes write the person's id into it |
| **K3** | §11.1: "the plan's first step is a count" on production | db-ops has no read-only query command | The migration itself refuses with a list if a public, labelless or non-uuid row exists (test 24). The count is still run first, read-only, through the Neon tools, in the same "ask" mode window as the snapshot (Rollout) |
| **K4** | §3: on a 390 px phone the map is 2×2 tiles of 179 px | Phones narrower than 390 px are common: 375 px (iPhone SE and mini) leaves no margin, and at 360 px (many Androids) a 2×179 map doesn't fit at all, so it would scroll or be squeezed, and a squeezed picture reads taps at the wrong scale | The page draws one mosaic per width band (2×144 below 360 px, 2×164 from 360, 2×171 from 375, 2×179 from 390, 256 px tiles from 600) and a CSS width rule shows exactly one. **Each form carries its own size in a hidden field**, so the server always converts at the scale that was tapped. The hidden mosaics' pictures may still download; that is accepted (team-only, privately cached, a few people). No script |
| **K5** | §7.5: "forget this guardian" is a team power unless the roles spec says otherwise | The roles spec §17.4 point 1 says it is **management only**; its plan leaves the button to SYC-208's plan | This plan builds the function that blanks the name in every feeding-site and colony store, with test 23 (Slice 5). The management-only button is SYC-208's |
| **K6** | §2.6: the Colonies page lists "Recent guardian changes" | The roles catalogue names its capability `view_guardian_changes` | Uses `view_guardian_changes` |
| **K7** | §7.3: a guardian asks for a site to be public; the team decides on the §4.3 page | The roles plan's PR 3.4 ("Needs an OK") approves by calling SYC-209's make-public page, which is **after launch** (spec Decision 2). If 3.4 ships first, a guardian can ask and nobody can act | Recommend 3.4 waits for this plan's PR 6.2. Raised as a comment on SYC-53, not by editing that plan |
| **K8** | §11.2: every write to a site is conditional on `updated_at` | `colonies` has no `updated_at`, and the spec adds no colony columns | Colony renames are already safe (the folded-name unique index refuses a clash, and both renames are in the history). Guardian-name edits use last-write-wins with both in the history. **Making a site public** carries the guardian name the page showed, and re-reads the colony row `FOR SHARE` inside the transaction, refusing with "Someone already changed this." if it differs, so consent can never be recorded for the wrong guardian. A guardian-name change takes the row `FOR UPDATE`. No colony column is added |
| **K9** | §11.3: rate-limited "like the other public reads" | Only photos have a read limiter, and limits are counted per server (SYC-105) | The public sites list and the code lookup get their own limiter, `feedingSpotLimiter`, shaped like `photoLimiter`. SYC-105's per-server caveat applies unchanged |
| **K10** | §6: "the Help tab's campaign text (`lib/campaign.ts`)" in the app | The file is in the API server, and its default title names the Vaporia colony | Changed in PR 6.3, with the "no public string names a colony" test (test 25) |
| **K12** | §4.8, §11.3: the rough count is worked out "in the one query that builds the public list" | Whether a cat is alive is decided in TypeScript (`resolveLifeStatus`, `AS/lib/resolve.ts:419`), not SQL. A SQL copy of that rule would drift from it without any test noticing | The count uses the existing resolver, on the server, in the same request. The number lives only in one local variable, is turned into a band before anything is serialised, and is never logged, cached or returned. Test 2a checks no log line, cache entry or response holds it. The outcome is the spec's (the exact number never leaves the server); only *where* the counting happens changes |
| **K13** | §11.4: tiles at `/api/team/map-tiles/:z/:x/:y.png`, kept out of *our* logs (SYC-255) | A tile address is a position to about 75 m. Even with our logs redacted, the address still reaches the hosting provider's edge logs, and pan or zoom links would put positions in the browser's history (which Chrome can sync to Google) | Tile pictures are fetched by an **opaque reference** (`/api/team/map-tiles/:tile`, an encrypted, short-lived token for z/x/y), so no address anywhere holds a position. Panning, zooming, area links, "Show on our map" and every tap are **POST forms with hidden fields**, never links with a position in them. A test fails if any `href`, `action` or `src` on a team page holds a coordinate or a z/x/y |
| **K11** | SYC-263's ticket text: "directions in words, never coordinates", built "only if Decision 12 is approved" | Superseded by roles Decision 12 and spec §2.2: the line is **optional**, and the phone may hold exact positions | Built as an optional field in Slices 1 and 3. A comment on SYC-263 records the change |

---

## The tap test (done before approval, as the spec requires)

The spec (§3, Decision 1) makes the whole map depend on one browser behaviour: when you tap a picture that is a form button, the browser sends the point you tapped, measured on the picture as it is shown. The spec asks for this to be checked before the plan is approved.

**What was tested (12 Oct 2026).** A throwaway page with a 2×2 grid of 179 px picture buttons (the spec's phone layout) and one 256 px button, each in its own form posting to a small local server. Taps were made at known points and the posted point compared with the expected one. The page and server live only in the session's scratch folder; nothing was committed.

| Browser | Width | Pixel ratio | Tapped (expected) | Sent |
|---|---|---|---|---|
| Chromium (the app's built-in browser), phone emulation, Android user agent | 390 px | 2 | (50, 100), (100, 20), (200, 30) | (50, 101), (100, 21), (200, 31) |
| Chromium, desktop | 1024 px | 2 | (150.6, 40.4), (100, 99.7) | (151, 41), (100, 100) |

**Result.** Every point arrived in displayed CSS pixels, within one pixel (the half-pixel offset of the grid's top edge), on a high-density screen, at both widths. The displayed size equalled the drawn size (179×179, no shrinking), and the page had no sideways scroll at 375 px or 390 px.

**Safari's engine (WebKit) and Firefox (Gecko), 13 Oct 2026 (Decision 3C).** Playwright's WebKit and Firefox builds were downloaded to this machine's Playwright cache (not the repository) and driven with real touch taps (phones) and mouse clicks (desktop) on the same page. The script checked which picture received each tap as well as the point.

| Engine | Widths | Taps | Result |
|---|---|---|---|
| WebKit (Safari), touch, pixel ratio 3 | 390 px, 360 px | 14 | All within 1 px and on the right picture, except one tap at the right edge at 360 px (below) |
| WebKit, mouse, pixel ratio 2 | 1280 px | 7 | All within 1 px |
| Firefox, touch, pixel ratio 3 | 390 px, 360 px | 14 | All within 1 px, except the same right-edge tap at 360 px |
| Firefox, mouse, pixel ratio 2 | 1280 px | 7 | All within 1 px |
| Both engines, **the 164 px map at 360 px** (K4) | 360 px | 12 | **All within 1 px**, including taps 1 px from every corner. The form's hidden size field arrived with each tap |

Taps included points 1 px inside a picture's corners and a tap on the boundary between two pictures.

**What the two failures were.** At 360 px, a 2×179 map is 374 px wide, wider than the screen. Its right edge is off-screen, so WebKit read the wrong point and Firefox sent nothing. This is K4's problem, and K4's fix (a 164 px map at that width) passed all 12 taps in both engines.

**One new rule from the run.** On the first run, the test page's pictures started at a fractional position (59.44 px down the page), and WebKit read taps up to 1.5 px off and mishandled an exact-corner tap. Once the pictures started on a whole pixel, every tap was exact. So **PR 3.1 must lay the map out on whole pixels**: fixed-height elements above it, no fractional margins. Its browser test asserts each picture's top and left are whole numbers at every width.

**Still to do:** a tap on a real iPhone and a real Android phone on the development site, in PR 3.1 (SYC-287), as test 17 requires.

---

## Decisions for Samuel

Three, all about *how* or *when* to build what is approved. None reopens a decision in the spec. **All three decided by Samuel on 13 Oct 2026, as recommended: 1A, 2B, 3C.**

### Decision 1: do the team's colonies and private map wait for the roles foundations?

**Decided by Samuel, 13 Oct 2026: 1A, don't wait.**

**The question.** The team's half (Slices 2 and 3) uses capability names that don't exist yet, such as `create_colony` and `add_feeding_site`. The roles plan creates them, with strict checks, in its PR 0.5, which comes after four other roles PRs and a change to the sign-in Worker. Should colonies and the private map wait for that?

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **1A. Don't wait (recommended)** | Slices 2 and 3 add the names they use to today's list, held by the team only, exactly as `can()` works today ("does this person hold the team role?"). Each route already looks up its colony from the record and passes it to `can()`, so when PR 0.5 makes `can()` strict, the routes are already right | The spec says so (§7.2: "nothing in the team's half waits for it"). Colonies are ready for launch even if roles slip. **Safe:** until the roles PRs 0.3, 0.4, 0.5 and the Worker change are live, nobody but the team can sign in at all | Two plans edit `capabilities.ts`: whichever merges second rebases (a few lines). PR 0.5's route walk must list this plan's routes; if they merged first, 0.5 adds their rows |
| 1B. Wait for PR 0.5 | Slices 2 and 3 start after the roles foundations are live | One way of checking permissions from the start; no rebase | Colonies and the map wait on six roles PRs and the Worker. If roles slip, the team launches with no colonies and no map, which spec Decision 2 put before launch |

**Recommendation: 1A.** Guardians (Slice 4) wait for the roles foundations either way.

**What people notice.** With 1A, the team gets colonies and the map sooner. With 1B, they get them later. Nobody else notices either way.

### Decision 2: removing the links that send exact positions to Google (SYC-245)

**Decided by Samuel, 13 Oct 2026: B, mixed.**

**The question.** Today the team's cat page, the welfare queue and the welfare alert email each have an "Open map" link. It opens Google Maps (and in the email also Apple Maps) at the exact spot. Cats are mostly seen where they are fed, so these links tell Google where feeding spots are. The spec says "Make a feeding site here" can't ship until these links are gone, **or** until they are dropped for any position within 50 m of a feeding site (its fallback).

| Option | What the team gets | Benefits | Risks |
|---|---|---|---|
| A. Remove all three links | Exact positions shown as plain text, and (from Slice 3) on our own map | Nothing exact goes to a map company, ever | Someone rushing to a cat in trouble loses one-tap directions in their phone's maps app. They can copy the numbers, which sends the same position to the same company anyway, just more slowly |
| **B. Mixed (recommended):** remove the link on the cat page (replaced by our own map in Slice 3); keep it in the welfare queue and alert email, **except** within 50 m of any feeding site | Directions still work for welfare call-outs, which are about one cat in trouble, not about a feeding spot | The cat page, where sites are made, never leaks. Near a known feeding spot the queue shows "Near a feeding site: see the dashboard map"; **the email simply has no map link**, because a sentence saying "near a feeding site" in an email would itself tell the mail provider where one is | A report away from a known site still goes to Google when tapped, including at a spot that *later* becomes a site. That is the spec's own accepted fallback |
| C. The 50 m rule everywhere, including the cat page | Links stay for most positions | Least change for the team | A sighting is usually what *becomes* a site, so on the cat page the link has often already been tapped before anyone makes a site there. That is the leak the spec is about |

**Recommendation: B.** It puts the strict rule where sites are created, and keeps directions for welfare call-outs, where a minute matters.

**What people notice.** On a cat's page, "Open map" becomes "Show on our map" once Slice 3 is live (plain text until then). In the queue and the alert email, nothing changes except near a feeding site.

### Decision 3: finishing the tap test in Safari and Firefox

**Decided by Samuel, 13 Oct 2026: 3C. The WebKit and Firefox check ran the same day and passes (see "The tap test"); the real-phone check stays with PR 3.1 (SYC-287).**

**The question.** The spec wants the tap behaviour checked in Safari on iPhone, Chrome on Android and Firefox **before this plan is approved**. Chrome is done (above). Safari and Firefox need test browsers this machine doesn't have.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **3A. Download Playwright's WebKit and Firefox test browsers and run the same check now (recommended)** | About 200 MB from Playwright's download server, into this machine's Playwright cache (not the repository). The same page and taps, in each engine, at 390 px and desktop | Closes the spec's condition before approval, with no phone and no one else involved. WebKit is the engine behind Safari on every iPhone | A desktop engine with touch emulation isn't a real phone. Real phones are still checked in PR 3.1 (test 17) |
| 3B. Approve now; check on real phones in PR 3.1 | No download. Samuel (or a Syros Cats person) taps the development site's map once on an iPhone and once on Android, about two minutes | Real devices | Approval happens before the spec's condition is met. Needs a person with a phone |
| 3C. Both | 3A now, real phones in PR 3.1 | Strongest | Both costs |

**Recommendation: 3C**, which is 3A now plus the real-phone check PR 3.1 already includes. If either engine fails, the spec's fallback applies: our own tile set (Decision 1 option C) plus typed coordinates, before any script is considered.

**What people notice.** Nothing.

### Also needed from Samuel, not decisions

- **Before each production migration** (PR 1.1, PR 1.2, PR 3.1): switch the session to **"ask" mode**, so Claude can take the Neon snapshot and run the read-only count. Auto mode blocks Neon snapshots. Claude says when.
- **Before Slice 6 ships:** nothing. Samuel has accepted the matching and photo risk (spec §4.6), so the public half has no gate on SYC-67.

---

## How it ships: the order

Every PR is built in **its own worktree off fresh `origin/main`**, is **one PR**, and can merge alone, leaving `main` safe if the next one is late. "Review and merge" uses `/ship`: an independent adversarial review in **its own worktree** (never shared with the builder or another reviewer), findings folded in, CI green, merge, Linear synced, worktree removed.

| Step | PRs | Needs first | Who notices |
|---|---|---|---|
| **Docs** | D209: spine and team-access amendments, `DECISIONS.md` entries | Samuel's approval of this plan | Nobody |
| **Slice 0: preconditions** | 0.1 tile paths out of the logs (SYC-255) · 0.2 links out to map companies (SYC-245, Decision 2) | Nothing; both can start at once | The team, slightly |
| **Slice 1: the records** | 1.1 site columns, history, read log (migration `feeding_sites_and_history`) · 1.2 strict links to people (migration `feeding_site_people_links`) | D209 merged | Nobody |
| **Slice 2: colonies (before launch)** | 2.1 the Colonies pages · 2.2 cats in colonies | Slice 1; Decision 1 | The team |
| **Slice 3: the private map (before launch)** | 3.1 tiles and the map (migration `map_tile_cache`) · 3.2 the Feeding sites pages, read-only · 3.3 add, move, retire, bring back, change colony · 3.4 "Make a feeding site here" and "Add a site to this colony" | Slice 2; 0.1 before 3.1; 0.2 before 3.4 | The team |
| **Slice 4: guardians** | 4.1 what a guardian sees · 4.2 what a guardian does · 4.3 Recent guardian changes | Roles PRs 0.2, 0.3, 0.5, W1, 1.0, 1.1 (and 2.2 for 4.3) | Guardians and the team |
| **Slice 5: forgetting a guardian's name** | 5.1 the redaction function (SYC-256's feeding-site half) | Slice 3 | Nobody (management's button is SYC-208's) |
| **Slice 6: public sites (after launch)** | 6.1 the public endpoint, empty · 6.2 the make-public switch · 6.3 the app's layer and card | Launch; Slice 3 | Visitors, and the team |

**If the window bites** (spec §16): colonies first, then the private map, then the public half. The tile map (3.1) is the riskiest piece and the first to slip, ahead of colony naming. Slices 2 and 3 are each useful alone.

**The rule that orders all of it:** no site can be public until Slice 6, and no route in Slices 1–5 can set `is_public` (test 7 checks every route and the seed path).

### Migrations

Three migrations, in this order. **Each takes the next free number when it is generated after rebasing on the latest `main`, never by hand** (`lib/db/migrations/README.md`). The roles plan adds three of its own (`person_events`, `roles_and_invites`, `field_check_photos`) and SYC-44 may add one. They don't depend on each other's numbers: the roles plan's `confirmation_items` links to `feeding_sites.id`, which already exists. The highest on `main` today is `0014`.

| Migration | PR | What it does | Additive? |
|---|---|---|---|
| `feeding_sites_and_history` | 1.1 | New `feeding_sites` columns and checks; `feeding_site_old_codes`; `mapping_events` with its redaction trigger; `site_page_reads`; redaction columns on `colony_name_history`; one `system:migration` event per existing site | **No:** the new checks fail if a public site already exists. The migration checks first and stops with a list |
| `feeding_site_people_links` | 1.2 | `feeding_sites.made_public_by` from text to a strict link to `people.id` (`colonies.created_by` stays text, K2) | **No:** a type change. Stops with a list if any value isn't a person's id |
| `map_tile_cache` | 3.1 | One table of cached map pictures, with a size cap | Yes |

Each migration's PR proves **up, down, up** with the repository's own commands (`migrate:cycle` locally, and CI's "Test migrations" step on the real history). Each has a commented rollback block. Rollback for 1.1 says in capitals that it **deletes the history**.

---

## Before any code: the docs PR (D209)

One docs-only PR, built from the spec's §12 word for word. **Nobody edits `DECISIONS.md` from a spec branch**, so these entries have been waiting for this.

| File | What changes |
|---|---|
| `cat-record-data-spine.md` §10.5 | The `feeding_sites` columns of spec §11.1, `feeding_site_old_codes`, `mapping_events`, `site_page_reads`, `colony_name_history`'s redaction columns, `made_public_by` and `created_by` as links to people (§12 asks 1, 3, 5); the public endpoint of §11.3 as the definition of "filters in the query" (ask 2) |
| `cat-record-data-spine.md` §6.7 | A public label never contains the guardian's name; a private site is indistinguishable from an unknown code (ask 7, first half) |
| `team-access-and-welfare-queue.md` §3.2 | "One switch per site" gains the confirmation page; "no bulk action" stands (team-access ask 2) |
| `DECISIONS.md` | A new part, dated 12 October 2026, carrying spec §12 entries 1–13 as written |

**Not in D209, because the roles plan's docs PRs carry them:** the "in no colony" value (spine ask 4), a guardian's saved list holding exact positions (ask 6), a guardian seeing only her own sites (ask 7, second half), and the team-access capability and 403 asks (team-access asks 1 and 3). Those are in the roles plan's D1 and D2, word for word the same. **Whichever docs PR merges second checks the other's text and rebases.** If the roles docs PRs haven't started when D209 is written, D209 carries those asks too, and the roles plan drops them.

**Collision:** PR #107 (SYC-130) edits `DECISIONS.md` and the spine too. The sections don't overlap; whichever merges second rebases.

---

## Slice 0: preconditions (two small PRs, either order)

**In plain English.** Two leaks have to close before the map exists. First, the server's logs would otherwise record roughly where every feeding site is whenever its page opens. Second, three "Open map" links send exact positions to Google. After this slice the logs never hold a map position, and the cat page no longer sends positions out.

### PR 0.1: map tile addresses never reach the logs (SYC-255)

- `redactRequestUrl` (`AS/lib/logger.ts`) rewrites any path under `/api/team/map-tiles/` to `/api/team/map-tiles/:tile`, before the existing device-id rule. The route doesn't exist yet, so nothing else changes.
- **Tests.** A request to `/api/team/map-tiles/17/74000/50000.png` produces a log line containing `/api/team/map-tiles/:tile` and none of the three numbers (checked through the real `pino-http` serializer, as `app.logRedaction.test.ts` does). **Mutation probe:** remove the rule → red.

### PR 0.2: no exact position goes to a map company from the cat page (SYC-245, Decision 2)

Option B, as decided by Samuel on 13 Oct 2026.

- **Cat page** (`catPages.ts`, `place()`): the "Open map" link is removed. Positions show as text (`37.4452, 24.9423`, team-only as today). PR 3.4 adds "Show on our map".
- **Welfare queue** (`queuePage.ts`) and **alert email** (`alertEmail.ts`): the Google and Apple links stay, except when the position is within 50 m of any feeding site. Then the queue line reads "Near a feeding site: see the dashboard map", and the email **silently leaves the links out** (no sentence that names a feeding site). `buildWelfareAlert` is a plain synchronous builder, so the distance check runs in the mail outbox (`AS/lib/mail/outbox.ts:292`) and is passed in as one yes/no. **If the check fails, the alert still sends, without map links**: an urgent alert is never held up, and a failure never adds a link. There are no sites until Slice 3, so nothing visible changes yet; the check is written now so it can't be forgotten. Distance is computed in the query against `feeding_sites` (retired sites included, since the spot is still a known place).
- **Tests.** The cat page contains no `google.com/maps` and no `maps.apple.com` (a source test over `lib/teamPages` too, so a new page can't add one). With a site seeded 30 m from a report, the queue line and the email have no outbound link, and the email contains no words about a feeding site; at 80 m they do. With the distance check forced to fail, the alert still sends, with no map link. The existing assertions in `team.queuePage.test.ts:148` and `reports.test.ts:501–502` are kept for the "far" case. **Mutation probes:** put the link back on the cat page → red; change 50 to 0 → red.

---

## Slice 1: the records (nobody sees anything)

**In plain English.** The database learns to hold everything the screens will need: a site's public label and code, a "how to find it" line, whether it is retired, and a permanent history of every change, which can be blanked if a guardian asks to be forgotten. Every existing site stays private. Nobody sees any change.

### PR 1.1: site columns, the history and the read log (migration `feeding_sites_and_history`)

**The migration, in one transaction, stopping with a list and changing nothing if a check fails:**

1. **Refuse** if any `feeding_sites` row has `is_public = true`, printing the ids (spec §11.1: the new rules would fail on deploy). A public row must be made private by hand first. Production is expected to have none (the count, Rollout step 1).
2. Add to `feeding_sites`: `public_label` text; `directions` text; `public_id` text unique; `last_public_lat`, `last_public_lng`; `guardian_aware` boolean; `retired_at`, `retired_by` (uuid → `people.id`); `updated_at` (not null, default now). Checks: `is_public` needs `public_label` and `public_id`; `is_public` and `retired_at` never both set; the two `last_public_*` columns set together or not at all.
3. Create `feeding_site_old_codes` (`site_id` → `feeding_sites.id`, `public_id` unique, `retired_at`, `reason` check in `moved`, `retired`). A code can never be in both tables (a trigger on insert into either refuses a code the other holds).
4. Create `mapping_events` exactly as spec §11.1: `subject_kind` check `site`/`colony`, `subject_id`, `kind` (a check listing every event of spec §8, plus `existing`, `guardian_forgotten`, and the automatic make-private kinds `made_private_moved`, `made_private_colony_changed`, `made_private_guardian_changed`), `person_id` (uuid, strict link), `actor_system` (check in `system:seed`, `system:migration`), `at`, `before` jsonb, `after` jsonb, `note`, `guardian_aware`, `redacted_at`, `redaction_reason`. **Exactly one of `person_id` and `actor_system` is set** (check). A trigger copied from the `observations` trigger: no insert may arrive redacted; no delete; the **only** update sets `redacted_at` and a non-empty `redaction_reason` and blanks `before`, `after` and `note` (to `{}`, `{}` and null), with every other column unchanged. A truncate guard uses the shared `append_only_no_truncate()`. Index on (`subject_kind`, `subject_id`, `id` desc).
5. Create `site_page_reads` (`person_id` strict link, `site_id`, `at`). No position column.
6. Add `redacted_at`, `redaction_reason` to `colony_name_history`, with the same one-update trigger (blanking `name` and `normalised_name` to a fixed placeholder; it has no other free text).
7. Write one `mapping_events` row per existing site: `kind = 'existing'`, `actor_system = 'system:migration'`, `after` = name, position, colony. Every existing site stays private, with no label and no code.

**Code.** The schema in `lib/db/src/schema/colonies.ts` (columns, checks, indexes; triggers live only in the migration, per the README). `system:seed` and `system:migration` join the app-written authors list. A small `lib/mappingEvents.ts` with one writer, `recordMappingEvent(tx, …)`, which **requires a transaction** (it takes the caller's `tx`, never the pool), so a change and its history row always commit together.

**Tests.** Test 11 (the database half): the history trigger refuses delete, truncate, an insert already redacted, and every update except a redaction that blanks exactly `before`, `after` and `note`. **Mutation probes:** let the trigger allow `kind` to change → red; drop the "exactly one of `person_id` and `actor_system`" check → red. Test 10 (the database half): `is_public` with `retired_at` is refused. Test 24: on a seeded copy, a public row, a public row with no label and a retired-and-public row each stop the migration with the id listed; existing sites each get exactly one `system:migration` event; every event has exactly one of `person_id` and `actor_system`. Up/down/up passes.

### PR 1.2: strict links to people (migration `feeding_site_people_links`)

Its own step, as spec §11.1 asks, because it changes a column's type.

- **Refuse with a list** if any `feeding_sites.made_public_by` is not null and isn't the id of a row in `people`.
- Convert it to `uuid`, with a strict link to `people.id`. Rollback converts back to text. `colonies.created_by` is not touched (K2).
- **Tests.** Test 24 (rest): a non-uuid value, and a uuid that isn't a person, each stop the migration with the id listed; valid values convert unchanged. Up/down/up passes.

---

## Slice 2: colonies (the team, before launch)

**In plain English.** The dashboard's top bar gains **Colonies**. The team can create a colony with the name they already use ("Vaporia — Eleni's"), write down who the guardian is, rename it when that changes (searching the old name still finds it), and keep team-only notes. They can put cats in a colony, move them, and take them out. The team's page for a cat says which colony it is in by name. Every change shows in the colony's history with the person's name and the date. Nothing about colonies is public, and no guardian can sign in yet.

**Permissions in this slice (Decision 1A).** `create_colony`, `edit_colony` and `assign_cat_to_colony` join `capabilities.ts` (`rename_colony` exists already), held by the team only, as `can()` works today. **Until PR 4.1, every route in Slices 2 and 3 calls `can()` with no target.** Today that means "the team"; once roles PR 0.5 makes `can()` strict, "no target" means island-wide holders only, so a guardian is refused (403) on every one of these pages until PR 4.1 adds the filtering. This fails closed: these pages show team notes, every colony and team names, and must never be opened to a guardian by accident. PR 4.1 is where targets and filters are switched on together. If PR 0.5 has already merged, the routes use its catalogue.

**One rule for "which colony is a cat in", in one place.** The newest active `colony` statement stands; "in no colony" and "marked wrong" behave as spec §2.8 says. It lives in one function, `currentColonyOf(catIds)` in `lib/colonyMembership.ts`, used by the colony counts, the colony page, the cat page and (later) the roles plan's target lookup. If PR 0.5 already has one, this slice uses that instead of writing a second.

### PR 2.1: the Colonies pages

- **Routes** (each a server-drawn page, no scripts; POSTs run `requireOrigin(TEAM_ORIGIN)`, then the capability, then the body; a bad form answers `400` naming fields only; every value through `escapeHtml`):
  - `GET /api/team/colonies`: every colony by name, with guardian, number of sites, number of cats (by `currentColonyOf`). A search box finds a colony by **any name it has ever had**, folded with `foldName` (so `ΜΙΜΗ` finds `Μιμή`), against `colonies.normalised_name` and `colony_name_history.normalised_name`. A **Create a colony** button.
  - `GET /api/team/colonies/:id`: name, guardian, counts, its sites (empty until Slice 3), its cats with photos (through the team photo route), team-only notes, and its history, newest first, with "Maria (left)" for someone who has left.
  - `POST /api/team/colonies` (`create_colony`): name, optional guardian name, notes. The page shows the convention *a place and the person who looks after it, like "Vaporia — Eleni's"*.
  - `POST /api/team/colonies/:id`: guardian name, notes and centre (`edit_colony`); the name (`rename_colony`). A rename writes the old name to `colony_name_history`, in the same transaction.
- **Name clash** (folded, using the existing unique index): a team member sees "Already used by [colony]" with a link, as the cat rename does. Two creates at once of the same name produce one colony; the loser sees the clash.
- **History.** Create, rename, guardian change, notes or centre change each write one `mapping_events` row through `recordMappingEvent(tx, …)`, before and after, in the same transaction.
- **Notes boxes** carry the hint "Don't write when people come and go."
- **Guardian change while a site is public**: no site is public until Slice 6, so the "make private automatically" rule (spec §4.7) is written in PR 6.2 and tested there.

**Tests.** Test 14 (colony names): a clash under case, accents, final sigma and NFD is refused, with a link for the team; a rename keeps every cat and site attached; the old name still finds the colony; two simultaneous creates produce one. Test 11 (part): every write here writes exactly one history row, and a forced failure in the history write leaves the colony unchanged. **Mutation probe:** write the history row outside the transaction → red. Test 16 (escaping): a colony name with markup shows as text on every page. Test 12 (part): each new route refuses a signed-in person without the team role, writes nothing, and refuses a foreign or missing `Origin`. The route walk's minimum count goes up and the new routes are listed. Browser check (test 20) at 390 px and desktop with seeded colonies and cats.

### PR 2.2: cats in colonies

- **Vocabulary.** `colony { colonyId: null }` is accepted by `writeObservation` (roles PR 0.2 does this; if 0.2 hasn't merged, this PR does it and 0.2 drops that bullet). The writer checks that a named colony exists (the value check doesn't).
- **From a colony page, "Add cats":** search by name or SYR number; each result has a tick box and shows the cat's current colony by name. *Add the ticked cats* writes one signed `colony` statement per cat.
- **From the team's cat page, "Colony":** pick one colony from a list; one statement. The colony line shows the current colony's name (and "was [old name]" if renamed since), replacing `Put in colony 12` (`teamCatView.ts:158`).
- **"Take out of this colony"** writes an "in no colony" statement. **"Mark wrong"** uses the existing supersede route: `colony` joins `capabilityFor` **and** the pre-lookup gate `SUPERSEDE_CAPABILITIES` (`teamCorrections.ts:43, :51`) under `assign_cat_to_colony`, so the next newest active statement stands (spec §2.8). **For a `colony` statement, the replacement value is worked out on the server, never taken from the form**: the colony of the next newest active statement, or `colonyId: null` if there is none. (The existing route writes `input.value`, `teamCorrections.ts:184–197`; the colony case branches before that.) "Newest" is the data spine's resolver rule (§10.2): the latest `observedAt` among statements that are neither superseded nor redacted, ties broken by the higher observation id. `currentColonyOf` uses the same rule.
- `roleAtTime` comes from the roles plan's `actingRole()` if PR 0.2 has merged; otherwise `"staff"`, as every team write does today.
- **A colony statement moves no derived status**: not life, not sterilisation, not "last seen".

**Tests.** Test 15 (team half): adding cats writes one statement each and moves no derived status (a snapshot of the public cat before and after); a colony that doesn't exist is refused; moving writes a new statement and the newest stands; "Take out" writes "in no colony" and the earlier statement stays visible; A → B, then "Mark wrong" on B, puts the cat back in A; "Mark wrong" with no earlier statement leaves it in no colony; the colony counts agree with `currentColonyOf`. **Mutation probes:** drop `colony` from `SUPERSEDE_CAPABILITIES` → red (the "Mark wrong" test); make `currentColonyOf` ignore superseded statements → red; take the replacement colony from the form → red. Browser check at 390 px and desktop.

---

## Slice 3: the private map (the team, before launch)

**In plain English.** The top bar gains **Feeding sites**. It opens a map of Syros with a marker on every site and, below it, the same sites as a list. The team adds a site by tapping the map, checks the spot on a confirmation page and saves. They can fix the name, notes and an optional "how to find it" line, move a pin that is in the wrong place (saying why), retire a spot that has closed, and bring it back. Every site is private. The map is made of plain pictures served by our own server, so the browser never talks to a map company and the dashboard still runs no scripts. On a cat's page, "Make a feeding site here" turns a sighting into a site.

### PR 3.1: map tiles and the map itself (migration `map_tile_cache`; needs PR 0.1 merged)

- **The tile route**, `GET /api/team/map-tiles/:tile` (`view_exact_location`; `canSomewhere` once roles PR 0.5 exists). `:tile` is an opaque, encrypted reference to z/x/y that expires after a day (K13), so no address anywhere holds a position. It refuses any tile outside the island box (the app's own, 37.36–37.53 N, 24.85–25.01 E, `offlineTiles.ts`) or outside zooms 12–19, so it can't be used as a free map proxy. Zoom 19 is where a fingertip is about 10 m, as spec §3 says. It fetches once from `tile.openstreetmap.org` with an identifying `User-Agent` (the first in the repository; `push.ts` sets none), and a 10-second timeout.
- **The cache.** Table `map_tile_cache` (`z`, `x`, `y`, `bytes`, `fetched_at`, `size`), capped at 200 MB, oldest first out, refetched after 30 days. Postgres, because Replit's disk doesn't survive a restart and photos already live in Postgres. The whole island box is about 18,000 tiles at zoom 18 and about 73,000 at zoom 19; the team will touch a small fraction, and the cap bounds it. *(The cap and the refresh period are this plan's numbers, not the spec's; they cost a little Neon storage.)*
- **Headers.** Tiles are the one stated exception to the dashboard's `no-store`: `Cache-Control: private, max-age=86400`, never `public`. Any answer that isn't a picture (a refusal or an error) stays `no-store`. The security header is otherwise unchanged; `team.headers.test.ts` still passes untouched.
- **The phone mosaic (K4).** `sharp` (already a dependency, `imageValidation.ts`) builds the picture at **exactly** the size it is drawn, one mosaic per width band (K4: 2×144, 2×164, 2×171, 2×179, then 256 px tiles from 600 px). A CSS width rule shows exactly one set; **each form carries its own size and tile in hidden fields**, so the server always converts at the scale that was tapped.
- **`lib/teamPages/map.ts`**, one function `renderMap({ centre, zoom, markers, mode })`. In `view` mode the tiles are plain pictures and the markers are links, placed with inline `style` (allowed by `style-src 'unsafe-inline'`). In `place` mode each tile is a picture button inside its own form. Zoom in and out, and quick buttons for the island's areas (all POST forms, K13) (Ermoupoli, Vaporia, Kini, Galissas, Finikas, Posidonia, Azolimnos; a configuration list). The attribution line ("© OpenStreetMap contributors") is printed under every map. Designed so a better map can replace it later without touching any other page (spec §3).
- **From a tap to a position:** standard Web Mercator from (tile, displayed size, tapped point). Taps outside the island box are refused.
- **Whole pixels.** The map is laid out so every picture starts on a whole pixel (fixed heights above it, no fractional margins). The tap test showed Safari's engine reads taps up to 1.5 px off when a picture starts part-way through a pixel.

**Tests.** Test 17: tiles need a session and the capability; the security header is byte-identical to `EXPECTED_CSP` (no `script-src`); a tap converts to the right position at zooms 13, 16 and 19, including a tap on a tile's edge and on every mosaic size; at 320, 360, 375 and 390 px and desktop, the shown mosaic's displayed size equals the size in its form, each picture's top and left are whole pixels, and there's no sideways scroll; no `href`, `action` or `src` on a map page holds a coordinate or z/x/y (K13); a tap outside the island is refused; the tile route's cache header is `private`, never `public`; a tile request logs as `/api/team/map-tiles/:tile` (PR 0.1's test, extended to the real route); a tile outside the island box or the zoom range is refused without a fetch. A malformed tile request (for example `/api/team/map-tiles/17%zz`) through the real route logs neither its path nor its error message (PR 0.1 guards both; this proves it on the real route). **Mutation probes:** use the 179 px scale for a 171 px form → red; send `public` → red; drop the island-box check → red; put z/x/y back in the tile address → red. **Real phones (test 17's last part):** on the development site, one tap at a marked point on an iPhone (Safari) and one on Android (Chrome), the posted point compared with the expected one and recorded in the PR (Decision 3).

### PR 3.2: the Feeding sites pages, read-only

- `GET /api/team/sites`: the count line ("31 sites: 2 public, 28 private, 1 retired"); a **Recently changed** strip (the last five site events, with the person and the day); the map with filled (public), outlined (private) and grey (retired, only with *Show retired*) markers; the list sorted by name, each row with its colony (or "no colony yet"), private or public, and the date last changed.
- `GET /api/team/sites/:id`, in the spec's order (§2.2): name and a small map; visibility as a plain sentence; colony; notes and "How to find it"; history, newest first, with positions; actions. **Opening it writes one `site_page_reads` row** (person, site, time; no position).
- No page links to any map company (the source test from PR 0.2 covers these pages).

**Tests.** Test 16 (escaping) for site names, notes and directions. The read record is written once per site page and never for the list or the map. **Mutation probe:** write the read record from the list page → red. Test 5 (part): the history is visible only with `view_exact_location`. Browser check at 390 px and desktop with ten seeded sites, including a retired one, and the map with no sideways scroll at 375 px and 390 px.

### PR 3.3: adding, moving, retiring and changing colony

- **Add:** `GET /api/team/sites/new` shows the map in `place` mode. A tap posts to `POST /api/team/sites/pick`, which **answers with the confirmation page directly** (marker on the spot, a small map around it, and the form). The position travels in hidden fields, **never in a web address**, so it is in no browser history and no log. *Save* posts to `POST /api/team/sites` (`add_feeding_site`; the target is the colony picked in the form, read and checked to exist). Fields: name, colony (optional for the team), how to find it (optional), notes (optional). **No visibility field exists.**
- **Typed coordinates:** a second form on the same page for keyboard and screen-reader users, with the warning "Don't copy these from a map company's site; ask a colleague who has been there." Same island-box check.
- **Edit details** (`POST /api/team/sites/:id`): name, notes, how to find it. **Move** (`GET`/`POST /api/team/sites/:id/move`): the same picker, starting at the site, then a reason. **Retire** and **Bring back** (`…/retire`, `…/restore`), each with a reason; bringing back always leaves the site private. All `edit_feeding_site` (team-only until PR 4.1, which adds the target: **the site's own colony, read from the record**). **Change colony** (`POST /api/team/sites/:id/colony`, `reassign_feeding_site`).
- **Every write is conditional on the `updated_at` the page showed**, answering "Someone already changed this." as the corrections do. The page carries the exact database value as text, to the microsecond, and the comparison is done in SQL, because a JavaScript date drops microseconds and would make every edit look like a clash.
- **Every write records one history row in the same transaction**, with before and after; a move keeps the old and new positions and the reason.
- **Written now, live from Slice 6:** `makePrivateIfPublic(tx, site, why)`, called by move and change colony. It does nothing to a private site. It is here so the rule can't be forgotten when publishing arrives; its tests seed a public row directly in the database.

**Tests.** Test 7: no route or script can create a site as public, and no route touches more than one site's visibility per request. **Mutation probe:** accept `is_public` from the add form → red. Test 13 (part): two simultaneous moves of one site, and a move while someone edits the name, each leave one definite state, and the loser sees "Someone already changed this." **Mutation probe:** drop the `updated_at` condition → red. Test 9 (early half): moving a public site (seeded) makes it private and writes both events. Test 11 (part) for every write. Test 12 (part): every route here refuses a signed-in person without the team role (and, after roles PR 0.5, a guardian: 403), writing nothing. Browser check: add a site end to end by tapping, at 390 px and desktop.

### PR 3.4: "Make a feeding site here", "Add a site to this colony" (needs PR 0.2 merged)

- On the team's cat page, each sighting gets **Make a feeding site here**, which opens the PR 3.3 confirmation page placed at that sighting (the position in hidden fields), ready to nudge. And **Show on our map**, which replaces the removed Google link with our own map centred there. Both are POST forms carrying only the sighting's number; the server looks up the position (K13).
- On a colony page, **Add a feeding site to this colony** opens the picker with the colony filled in.
- **Tests.** The cat page has no outbound map link (PR 0.2's source test); "Make a feeding site here" doesn't appear unless PR 0.2's change is present (a test fails if `catPages.ts` has both the button and a map-company link). Browser check at 390 px and desktop.

---

## Slice 4: cat guardians (after the roles foundations)

**In plain English.** Once guardians can sign in (the roles plan), Eleni opens **Colonies** or **Feeding sites** and sees only her own: her colonies, their sites with exact positions, their cats. Anywhere else looks to her as if it doesn't exist. She can create a colony when she finds a place nobody has recorded, and it is hers at once, named by her. She can add her cats, take them out, add a site to her colony, fix a pin, change notes and the "how to find it" line, and retire a spot that has closed. She can't change which colony a site belongs to, can't rename a colony after creating it, and can never make a site public. If one of her cats is added to someone else's colony, her colony page tells her ("Mimi has moved to another colony"), without saying whose. The team sees everything guardians do in a **Recent guardian changes** list. Pages a guardian reads are in English, Greek or French, her choice.

**Needs first (roles plan):** 0.2 (her real role on statements), 0.3 (placements), 0.5 (strict checks, `canSomewhere`, targets from the record, the 403 page, the route walk), W1 (she can sign in), 1.0 (three-language dashboard strings), 1.1 (`createColonyWithPlacement`), 1.3 and 2.1 (her "My colonies" and colony pages, which show the Decision 14 line from this plan's PR 4.2), and 2.2 (the roles plan's PR that lets `writeObservation` accept a guardian's statements, and `listGuardianChanges`). **No guardian is invited to use these screens until PRs 4.1 and 4.2 are live.**

### PR 4.1: what a guardian sees (spec §7.3)

- **Entry** to every list page with `canSomewhere(person, 'view_exact_location')`; then **every query is filtered by her colonies in SQL**, through one helper, `visibleColonyIds(person)`, which returns `null` ("all") only for an island-wide holder. A route that forgets to call it fails closed: the helper is the only way the list queries get a colony filter, and a source test fails if a sites or colonies query in `routes/teamSites*.ts` / `teamColonies*.ts` doesn't use it.
- Every row of the spec's table (§7.3) is built: the count line, the map and markers, the list and *Show retired*, *Recently changed* (her sites only, and no other person's name beyond her colony's), the site page, the Colonies page and search, "Add a site to this colony", the colony pick lists, the name-clash message ("That name can't be used", no link, no colony named), "Add cats" ("in another colony", no name, no link), the cat page colony line ("another colony"), history (her own, with positions), and the *Ask the team to make this public* button (the roles plan's PR 3.4 builds what it does; see K7).
- **Another colony's site or colony id** answers exactly what an id that doesn't exist answers, for **every** method (pages and POSTs alike): the same status, the same page, the same length, so ids can't be counted by trying them.
- **"Add cats" results** for a cat outside her colonies show only what the public sees about that cat. **A site's history** shows her only the events since the site joined her colony, so a site reassigned to her doesn't show the earlier guardian's names.
- **The *Ask the team to make this public* button** appears only once the roles plan's PR 3.4 and this plan's PR 6.2 are both live (K7); until then it isn't drawn.
- **`sitesForPerson(person)`**, one query returning her sites with exact positions and the optional "how to find it" line. The roles plan's PR 2.1 ("My colonies") and PR 4.2 (the saved list with no signal) call it, so there is one filter, not three.
- **Language.** Every string a guardian can see on these pages moves into the roles plan's dashboard catalogue (PR 1.0), with Greek and French. The team still reads English (spec Decision 9). Johnny checks the Greek and French (SYC-283) before guardians are invited. Slices 2 and 3 write their page words through one small `t()` helper from the start, so this is a move of keys, not a rewrite of every page.

**Tests.** Test 12 (part): every placed check takes its colony **from the record**, never the request. **Mutation probe:** take the colony from the form → red. Test 21 (seeing): with a guardian of colony 1, colony 2's name, guardian, counts and sites appear on no page in the §7.3 table; an id of colony 2's site answers byte-for-byte like an id that doesn't exist. **Mutation probes:** drop the colony filter from the list query → red; from the count line → red; from *Recently changed* → red; from the "Add cats" colony label → red. The route walk (roles T1) gains a row per route here for all seven kinds of person.

### PR 4.2: what a guardian does

- **Create a colony** (`create_colony`): `POST /api/team/colonies` calls `createColonyWithPlacement`, which writes the colony (`created_by` = her), her placement and the history in one transaction. Her form has a name and notes only; her own name is filled in as the guardian. She sees it at once; the team sees it too.
- **Sites** (`add_feeding_site`, `edit_feeding_site`, placed): add to a colony she holds (the colony is required and must be hers); edit, move, retire, bring back her own. **Change colony** isn't offered and is refused (`reassign_feeding_site` is island-only).
- **Cats** (`assign_cat_to_colony`, placed): add to and take out of her own colonies, with immediate effect; checked against the colony the cat goes into and, for "take out", the colony it leaves, both read from the records. Her statements carry `roleAtTime = guardian` and `authority_scope = colony:<id>` (roles Decision B).
- **When her cat moves to another colony** (spec Decision 14): her colony page shows "Mimi has moved to another colony", with the date, for 30 days after the move. It is worked out from the cat's statements (no new table): a cat whose previous standing statement was her colony and whose newest is another colony, written by someone else. It never names the other colony or its guardian. One function, `movedAwayNotices(person)`, builds the lines; this plan's colony page, the roles plan's "My colonies" page and its saved list all call it. *(The spec says the line appears "next time she opens" her colony page; it doesn't say when it goes. Thirty days is this plan's choice, so nothing new has to be stored. Say if you want it different.)*
- **Not offered:** rename, make public, change a site's colony, mark wrong (a guardian takes out instead, spec §2.8).

**Tests.** Test 15 (guardian half): she can add a cat to and take one out of her own colony, immediately, with her real role; she is refused (403, nothing written) for a colony that isn't hers; there is no `propose_colony_change` route and no pending state; adding a cat that is in another colony moves it and shows that colony's name nowhere on her pages. Test 21 (doing): she can create a colony and it is hers in the same step; she can't rename it or any other, or change a site's colony; she can add a site only to her own colony, and it is private. **Roles T16 and T30** (routes half), as named above. Decision 14: the losing guardian sees the line and it contains no colony name and no guardian name (checked against every name in the seed). **Mutation probes:** check "take out" against the colony it goes into instead of the one it leaves → red; show the notice for a move she made herself → red.

### PR 4.3: Recent guardian changes (`view_guardian_changes`; needs roles PR 2.2)

- At the top of the team's Colonies page: the last twenty things guardians did here (colonies created, sites added or moved, cats added or taken out), each with the guardian's name, the day and a link to the colony. Built from the roles plan's `listGuardianChanges()` plus this plan's history rows written by guardians.
- **Tests.** Test 21's last part: after a guardian creates a colony, colonies 1 and 2 are still invisible to each other, and the new colony appears in this list. A guardian never sees the list (403).

**With no signal.** This plan builds no offline PR. The roles plan's PR 4.2 (the saved list, 72 hours by server time, deleted on next open, `Clear-Site-Data` on sign-out and removal) shows her sites with their exact positions and "how to find it" line, from `sitesForPerson`. Spec test 26 is built there, with this plan's seed data. The team's own pages, including the map, have no offline copy.

---

## Slice 5: forgetting a guardian's name (SYC-256, the feeding-site half)

**In plain English.** If a cat guardian asks to be forgotten, management needs one action that removes her name from every place this feature stores it: the colony's guardian line, its old names, site names ("Vaporia — Eleni's"), notes and the history. This slice builds the part that does the removing, and proves it reaches every place. The button management presses is built with SYC-208 (the roles spec makes it management-only). Nothing visible changes.

### PR 5.1: `forgetGuardianName`

- `forgetGuardianName(tx, { colonyId, name, by, reason })` in `lib/forgetGuardian.ts`. Matching is by word **beginning** after `foldName`, so "Ελένη" also finds "Ελένης" and "Eleni" finds "Eleni's" (the caller passes every spelling the team knows). Because a stem can over-match, the function first returns a **preview** of every occurrence it will change, for the person to confirm, and lists any it can't change safely as "these remain; edit by hand".
  - `colonies.guardian_name`: cleared. `colonies.name` and each site name: the matched word replaced with "(name removed)" plus the colony's number, so two forgotten colonies never clash on the unique name. This writes a normal rename and history row, so the colony and site stay findable by number and new name. **Clearing the guardian name makes the colony's public sites private** (`makePrivateIfPublic`, spec §4.7: no site is public without a named guardian).
  - `colony_name_history`: each row containing the name is redacted (the trigger from PR 1.1 allows only this).
  - `feeding_sites.notes`, `directions`, `public_label`, `colonies.notes`: the matched words replaced.
  - `mapping_events`: each row whose `before`, `after` or `note` contains the name is redacted (blanks all three; the trigger allows only this).
  - One new event, `kind = 'guardian_forgotten'`, holding **no name**: who did it, when, which colony.
  - **Already-redacted rows are skipped** (from PR 1.1's review): the redaction triggers allow a second redaction only with the same stamp, so a re-run must leave rows with `redacted_at` set alone rather than stamping them again.
- `privacy-policy.md` gains the list of these stores (spec §7.4 point 5), in the same PR.

**Tests.** Test 23: after forgetting, the name (in any case, accent or sigma form) appears in no column of `colonies`, `colony_name_history`, `feeding_sites` or `mapping_events`, checked by a full-table text search; every other field is unchanged (a snapshot before and after); its own event exists and holds no name; "Ελένη" finds "Ελένης"; two colonies forgotten in turn don't clash; a public site of the colony becomes private. **Mutation probes:** skip the history redaction → red; skip site notes → red; skip `public_label` → red; skip the make-private step → red. **Where else must this hold** (the question a mutation probe can't answer): the plan lists every store of a guardian's name, and the test searches all four tables in full rather than the columns the function touches, so a new column holding the name fails it too.

---

## Slice 6: public feeding sites (after launch)

**In plain English.** The team can now choose a feeding site to show to visitors, one at a time. Pressing **Make public…** opens a page showing exactly what a visitor will see, in all three languages, explains in plain words what this will and won't do, and asks the team member to confirm that the guardian knows. In the app, a "Feeding spots" layer shows a bowl at that spot. Tapping it gives the label, roughly how many cats use the spot, and the request to give the cats room, not leave food, and see how to help. No private site, colony name, guardian, note or exact count ever leaves the server. Making a site private is one tap.

**Needs first:** launch (spec Decision 2). No gate on SYC-67 (Samuel accepted the risk, 12 Oct 2026).

### PR 6.1: the public endpoint, empty to start

- `GET /api/feeding-sites`, no sign-in, no parameters. **Filtered in the query** (`WHERE is_public AND retired_at IS NULL`), with an explicit column list. Each item is exactly `{ id: public_id, label, position, cats? }`, **ordered by `public_id`**. `cats` is one of `few`, `about5`, `about10`, `about15`, `20plus`, worked out in the same request from the site's colony (alive cats seen in the last 12 months, by `currentColonyOf` and the existing `resolveLifeStatus`, K12). The number is turned into a band before anything is serialised and is never logged, cached or returned. Absent when zero.
- `GET /api/feeding-sites/:code`: filters `is_public AND retired_at IS NULL AND public_id = :code` in the query. A private, retired, superseded, unknown or malformed code all answer the same `404` with the same body.
- **`publishedSitePosition(site)`** is the one place a published position comes from (exact today; the spine's open question 3 could make it blurred).
- `Cache-Control: public, max-age=300`. `feedingSpotLimiter` on both (K9). Both routes added to the public allow-list of the pre-launch gate only if it is still on.
- With no public site, the list is `[]`. Nothing else changes.

**Tests.** Test 1 (the canary): a private site with distinctive name, label, notes, directions and coordinates, and a colony with exactly 13 qualifying cats; every public route (`/api/feeding-sites`, the code lookup, `/api/cats`, `/api/cats/:id`, the resolve and sighting responses, notification payloads, `/api/healthz`) contains none of those strings, coordinates or the number 13, including after the site has been public and made private again. **Mutation probe:** drop `is_public` from the query → red. Test 2 (exact keys, fixed order; **mutation:** add `notes` → red). Test 2a (the bands at 0, 1, 4, 5, 7, 8, 12, 13, 19, 20 and 40; what is not counted; **mutation:** return the number → red). Test 3 (byte-identical for different headers, query strings, device ids, positions). Test 4 (a private, retired, never-public, random and superseded code all answer identically, and the query reads no private row). Test 6 (a source search of the public routes finds no read of a site's `lat`/`lng` outside `publishedSitePosition`). The limiter answers `429` after its limit and the list's header is exactly `public, max-age=300`. **Mutation probe:** compute the band with a hand-written "alive" rule instead of `resolveLifeStatus` → red (a cat the resolver calls presumed-deceased is then counted).

### PR 6.2: the make-public switch

- **The shared strings package is created here** (K1): `lib/feeding-spot-strings` with the twelve keys, imported by the server's preview now. A build check proves the app's web and native bundles can import it, before PR 6.3 uses it.
- `GET /api/team/sites/:id/publish` (`set_site_public`): the spec's page, in order (§4.3): a **preview** of the marker and card in English, Greek and French, built from the real label and the **real band today**, from the shared strings module (K1); what this will do; the reason; what it won't do (the matching and photo line, and the count line); the honest caveat; the tick *"The cat guardian for this place knows, and is happy for it to be public."*; the public label; **Make public**.
- `POST …/publish`: refused, writing nothing, without a label, with a label failing any of the three rules (§4.4: the site's own name minus place words, where "place words" are the area list of PR 3.1 plus a short team-editable list in configuration; any word of the current guardian's name or of any earlier one, read from the colony's guardian-change events in `mapping_events`; a word and a number side by side, Latin or Greek), without the tick, or for a site with no colony or whose colony has no guardian name. Otherwise, in one transaction, conditional on `updated_at` **and on the guardian name the page showed** (the colony row read `FOR SHARE`, K8): a `public_id` (random 128-bit) is issued if the site has none, **or** if this position is more than 10 m from `last_public_*`, or after a retire (the old code goes to `feeding_site_old_codes`); `last_public_*`, `made_public_by/at`, `guardian_aware` set; one "made public" event with the label, the code, the tick and its wording. The page then reads "Public since 14 October, by Maria."
- **Order when a code is retired** (from PR 1.1's build): the database refuses a code that is in both `feeding_sites.public_id` and `feeding_site_old_codes`, so the site's `public_id` is changed (to the new code, or null) **before** the old code is written to `feeding_site_old_codes`, in the same transaction.
- `POST …/unpublish`: one tap with a one-line confirmation, "Take down any QR sticker at this place." Never harder.
- **Changing a public label** shows the confirmation page again. **Automatic make-private** (`makePrivateIfPublic`, from PR 3.3) now also runs when a colony's guardian name changes (`POST /api/team/colonies/:id`), for each of its public sites, with the event "made private automatically: guardian changed". **Retiring** a public site makes it private and retires its code at once.
- The page for any re-publish after a move says "Old QR stickers for this place will stop working. Take them down."
- **The roles plan's hook:** a site made public closes any open site-public request as "no longer needed" (its PR 3.4).

**Tests.** Test 5 (opaque code: never-public has none; not derivable from the id; public → private → public at the same spot keeps one code; more than 10 m away, or after a retire, a new one, and the old answers "unknown"; the old is kept). **Mutation:** compare against 100 m → red. Test 8 (each refusal, writing nothing, including Greek address shapes and accent variants). Test 9 (moving a public site makes it private; re-confirming restores it). Test 10 (retired is never public by route or database; bringing back never makes it public; a retire retires the code). Test 11 (the "made public" event agrees with `made_public_by/at`, which are kept on make-private). Test 13 (two simultaneous make-public and make-private presses leave one definite state; a guardian-name change while the make-public page is open makes the publish fail with "Someone already changed this."). **Mutation probe:** drop the guardian-name check → red. Test 22 (a guardian change, or a move to another colony, makes the colony's public sites private with an automatic event; the confirmation page restores them). **Mutation:** skip the guardian-change hook → red. Test 2a (the preview shows the same band the endpoint will, in all three languages). Browser check of the make-public page at 390 px and desktop.

### PR 6.3: the app's layer and card

- **The strings.** The twelve keys of spec §5.2, from the package PR 6.2 created (K1), spread into `APP/lib/i18n.ts`. Greek and French go to the native review (SYC-4, and Johnny for SYC-283).
- **The layer.** "Feeding spots", on by default, with a switch; a bowl marker at each public position on the web map (`AppMap.web.tsx`) and the native map (`AppMap.tsx`), visibly different from the blurred cat cells. **Distance is worked out on the phone.**
- **The card.** The label and the lines of §5 in the visitor's language; the count line only when `cats` is present; "See how you can help" opens the Help tab (which needs a connection; the rest of the card doesn't).
- **The phone's copy.** Key `cat-spotter/feeding-sites-cache/public/v1`, storing `{ fetchedAt, sites }`, separate from the cats cache; refreshed each time the map opens while online, at most every five minutes; **not shown after seven days** (spec Decision 8); an older shape is dropped.
- **Campaign copy** (K10): the default title in `AS/lib/campaign.ts` stops naming a colony. Production's `CAMPAIGN_TITLE` setting, if set, is checked against the same rule on release (Rollout).
- **No change to spotting.** No "you are near feeding spot X", and sites play no part in matching.

**Tests.** Test 18 (older than seven days not shown; old shape dropped; a key different from the cats cache; re-fetched when the map opens online, at most every five minutes). **Mutation:** skip the age check → red. Test 19 (the new strings exist in all three languages with no empty values; the server's preview and the app's card use the same object). Test 25 (no public string, campaign included, contains any colony name or guardian name from the database or the seed). Test 20 (the card, in a real browser, at 390 px and desktop, with real-looking data).

---

## Where each of the spec's tests is built

API tests use `supertest` against a throwaway real Postgres with every migration applied (`AS/test/globalSetup.ts`). Every "mutation probe" is done once by hand before merge: break the named line, see the named test go red, restore, and list it in the PR.

| Spec test | PR | | Spec test | PR |
|---|---|---|---|---|
| 1 public isolation (canary) | 6.1 | | 14 colony names | 2.1 |
| 2 listed fields, fixed order | 6.1 | | 15 cats in colonies | 2.2 (team), 4.2 (guardian) |
| 2a the rough count | 6.1 (endpoint), 6.2 (preview), 6.3 (strings) | | 16 escaping | 2.1, 3.2 |
| 3 identical for every caller | 6.1 | | 17 map | 3.1 (+ SYC-287 real phones) |
| 4 not distinguishable | 6.1 | | 18 phone cache | 6.3 |
| 5 opaque code, new after a move | 6.2 | | 19 language parity | 6.3 (+ 4.1 for guardian pages) |
| 6 one position function | 6.1 | | 20 looks right in a browser | every UI PR |
| 7 never created public | 3.3 | | 21 guardian sees only her own | 4.1, 4.2, 4.3 |
| 8 make public needs everything | 6.2 | | 22 re-confirmation | 6.2 |
| 9 moving a public site makes it private | 3.3 (hook), 6.2 | | 23 forgetting a guardian | 5.1 |
| 10 retired is never public | 1.1 (database), 6.2 (routes) | | 24 migration | 1.1, 1.2 |
| 11 one history row per change | 1.1 (trigger), every write PR | | 25 public copy | 6.3 |
| 12 capabilities and refusals | every route PR (its own 403 tests); after 0.5, the roles T1 walk holds the full per-role matrix and every PR here adds its rows | | 26 a guardian's saved copy | roles plan PR 4.2, with this plan's seed |
| 13 concurrent writes | 3.3 (moves), 6.2 (publish) | | roles T16, T30 | 4.2 |

## Every place "a private site never leaves the team" must hold

A mutation probe only proves a test guards a place someone already thought of. This is the list of places, so the question "where else?" has an answer. Each has a test; the canary (test 1) is told to search every public route the router knows, not just this list.

1. `GET /api/feeding-sites` and the code lookup (6.1): filtered in the query.
2. `/api/cats`, `/api/cats/:id`, and the public payload (`publicPayload.blur.test.ts` already asserts a private site is absent; kept).
3. Sighting and resolve responses: sites play no part in matching (6.3), checked by test 1.
4. Notification payloads and emails: no site, colony or position is ever put in one (test 1; the alert email's 50 m rule in 0.2).
5. Request logs, **the hosting provider's edge logs, and browser history**: tile addresses are opaque (K13) and redacted anyway (0.1); a site page's address carries only its number; positions, tiles and map views travel only in hidden fields of POST forms, never in an address (3.1, 3.3), with a test over every team page.
6. Outbound links: none to a map company from any team page (0.2's source test).
7. The tile provider: sees tile areas only, through our server (3.1; SYC-288 removes even that).
8. Campaign and every public string (6.3, test 25).
9. A guardian's view of other colonies (4.1, test 21).
10. The phone: the app holds public sites only (6.3); a guardian's saved list holds her own only (roles 4.2, test 26).

---

## Rollout

Production steps are Claude's, through db-ops and the Neon tools. **Samuel is never asked to run a command.** The order for any PR with a migration is always **migrate before publish**.

1. **Before PR 1.1's production migration**, with Samuel's "ask" mode on: a read-only count on production through the Neon tools: all `feeding_sites`, those with `is_public = true`, `made_public_by` and `colonies.created_by` values that aren't people's ids. If any public row exists, stop and tell Samuel what it is before anything is changed (spec §11.1). Then a Neon snapshot of production.
2. db-ops `migrate` on **development**, then on **production**, then read-only checks of the migration hashes and the new constraints and triggers (`verify` can't pass since the Neon move, SYC-178).
3. Samuel's Replit publish. Wait until `/api/healthz` shows a commit containing the merge before probing (the EU deploy can sit in "promoting").
4. db-ops `smoke`, then a no-session probe of every new route: each answers `401 not_signed_in`, compared with a made-up route's `404`, with HTML and JSON `Accept` headers, on `team.catspotters.com`.
5. For UI PRs: a signed-in browser check at 390 px and desktop **on the development site with realistic seeded data**, before saying it's live. On production, the check uses one clearly marked test colony and test site ("TEST — Claude check", private, retired afterwards), so no real feeding-site position ever appears in a screenshot or a session transcript (in the spirit of spec Decision 11).
6. PR 1.2 and PR 3.1 repeat steps 1–4 with their own snapshot (ask mode again).
7. **PR 6.1 after launch:** also `curl` `GET /api/feeding-sites` on production, expecting `[]` with `Cache-Control: public, max-age=300`, and a random code expecting the uniform `404`.
8. **PR 6.3 release:** check production's `CAMPAIGN_TITLE` and campaign text against test 25's rule.
9. **First public site (6.2):** chosen by Syros Cats. Claude checks the live endpoint returns exactly the four keys and the right band, and that making it private removes it within five minutes.

The seed (spec Decision 11): **Syros Cats place their own sites on the dashboard.** No file of positions is loaded. If that proves too slow and Samuel asks for a list to be loaded, it follows spec §11.8 exactly (never committed, a `.gitignore` rule and a script check, loaded from a scratch folder, deleted afterwards, never pasted into a session, `system:seed` events, never public), as its own small PR.

---

## Where this collides with other work

| Work | Touches | What happens |
|---|---|---|
| **SYC-53 roles plan** (`claude/syc-53-plan`, draft) | `capabilities.ts`, `requireTeam`, the route walk, `teamCorrections.ts`, the docs PRs, `confirmation_items` → `feeding_sites` | The split is Decision D (roles plan) and Decision 1 (this plan). Whichever PR merges second rebases. K7 is raised on SYC-53 as a comment. This plan doesn't edit the roles plan |
| **SYC-2 coat and health plan** (`claude/syc-2-plan`) | Spine §10.1, §10.2, §10.7, §3.4 and `DECISIONS.md` | Agreed with that session: separate docs PRs in disjoint sections (this plan: spine §6.7 and §10.5); whichever merges second rebases. Its plan was approved and merged as PR #119. **Code:** its PRs 3.1 and 3.2 add Appearance, Vaccination and Health-notes sections to `AS/lib/teamPages/catPages.ts`, which this plan's PRs 0.2 and 3.4 also edit; whichever lands second rebases |
| **PR #107 SYC-130** | `DECISIONS.md`, the spine, team-access | Different sections; second to merge rebases |
| **PR #111 SYC-44** | Photos and reports, maybe a migration | No overlap except migration numbers, taken at rebase time |
| **PR #101 SYC-166** | The app's location picker | No overlap; PR 6.3 touches `AppMap*.tsx`, not the picker |
| **SYC-208** | Forgetting people | Calls `forgetGuardianName` (5.1) from its management-only button |
| **SYC-22, SYC-51** | QR codes | Printed codes carry the public code only; a superseded or private code lands on "This feeding spot isn't on the map any more". SYC-22 must settle its colony-page questions (spec §11.6) before building one |

## What this plan does not do

- **A colony page for the public, or QR codes that land on a colony's cats** (SYC-22).
- **The management button for forgetting a guardian** (SYC-208); this plan builds what it calls.
- **The saved list with no signal, and `Clear-Site-Data`** (roles plan PR 4.2, SYC-54); this plan provides the site query.
- **"Needs an OK"** (roles plan PR 3.4).
- **Greek or French for the team's own pages** (spec Decision 9).
- **A label per language** (spec Decision 10).
- **Our own tile set** (SYC-288), and **public sites with no named guardian** (SYC-289).

## What works with no signal

Exactly as spec §9. **The dashboard:** nothing; every page, including the map, is drawn by the server, and a press of *Save* with no signal fails with the browser's own page, recording nothing. **A guardian's phone:** her colonies' sites with exact positions as text, for 72 hours by server time (roles plan 4.2). **The app:** the last list of public sites for up to seven days, the map's offline tiles, and every line of the card except "See how you can help", which needs a connection.

---

## Model delegation

Session model for this plan: **Opus 5.5** (the brief named Opus: the plan sequences privacy-critical work across PRs that depend on the roles foundation, and a wrong order means a privacy hole or rework). For the build, each package goes to the cheapest tier that can do it, with the reason stated wherever it goes up.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| D209 docs PR | Sonnet | Copying spec §12 text into three files | Session model reads the diff against spec §12 line by line |
| PR 0.1 log redaction | Haiku | One regex and one test, a known pattern (`app.logRedaction.test.ts`) | The test plus its **mutation probe**; session model reads the diff |
| PR 0.2 outbound links | Sonnet | Three templates and a distance query | Source test plus the 30 m / 80 m tests, with **mutation probes**; browser check |
| PR 1.1 migration (checks, history trigger with redaction, existing-site events) | **Opus** | *Escalated:* a trigger that allows the wrong update is a silent failure (history edited, every test green), and the first non-additive step on production data | Tests 10, 11, 24 with **mutation probes** on each trigger rule; up/down/up; session model reads the SQL line by line; adversarial review |
| PR 1.2 type change | Sonnet | One checked conversion, following 1.1 | Test 24 (rest); up/down/up; Opus spot review of the SQL |
| PR 2.1 Colonies pages | Sonnet | Server-drawn pages following SYC-43 part 2's pattern | Tests 11, 14, 16, 12 with **mutation probes**; browser check; Opus spot review |
| PR 2.2 cats in colonies | Sonnet | Calls reviewed write paths; adds `colony` to two gates | Test 15 with **mutation probes** on both gates and on `currentColonyOf`; Opus spot review |
| PR 3.1 tiles, cache, mosaic, tap conversion | **Opus** | *Escalated:* the tap-to-position maths and the size-per-form rule are where a wrong pin happens silently, and it adds the dashboard's first outbound fetch and first cache exception | Test 17 with **mutation probes** (scale, cache header); the header test unchanged; real-phone check (SYC-287); adversarial review |
| PR 3.2 Feeding sites pages, read-only | Sonnet | Reads and pages | Tests 16, read-record test with **mutation probe**; browser check at 375, 390 px and desktop |
| PR 3.3 add, move, retire, colony | Sonnet | Form routes with conditional updates, the PR 4 pattern | Tests 7, 9, 13 with **mutation probes**; Opus spot review of `makePrivateIfPublic` and the concurrency guard; browser check of an end-to-end add |
| PR 3.4 entry points | Haiku | Two buttons on existing pages | Its tests; session model reads the diff; browser check |
| PR 4.1 a guardian's view | **Opus** | *Escalated:* a missed filter leaks another guardian's sites with every test green; the work is finding every place, not writing the filter | Test 21 with a **mutation probe at every row of the §7.3 table**; the source test on `visibleColonyIds`; adversarial review told to hunt for screens not in the table |
| PR 4.2 a guardian's actions | Sonnet | Calls roles helpers; placed checks | Tests 15, 21, T16, T30 with **mutation probes**; Opus spot review of the target lookups |
| PR 4.3 Recent guardian changes | Haiku | One list from an existing reader | Its tests; session model reads the diff |
| PR 5.1 forgetting a name | Sonnet | One function over four tables | Test 23's full-table search with **mutation probes**; Opus spot review |
| PR 6.1 public endpoint | **Opus** | *Escalated:* the one public door to the most sensitive data; a leak is silent | Tests 1–4, 6 with **mutation probes**; the "every place" list above; adversarial review told to find a public route the canary missed |
| PR 6.2 make public | **Opus** | *Escalated:* code issuing, the 10 m rule and the automatic make-private hooks are silent-failure sites | Tests 5, 8, 9, 10, 13, 22 with **mutation probes**; adversarial review |
| PR 6.3 app layer and card | Sonnet | Standard React Native and web work against a fixed shape | Tests 18, 19, 25 with **mutation probes**; browser check at 390 px and desktop |
| Repetitive HTML rows and seed fixtures | Haiku | Boilerplate against a fixed shape | Typecheck and the PR's own tests; session model reads the diff |
| Adversarial review of each PR | Sonnet, in its own worktree, never shared; **Opus** for 1.1, 3.1, 4.1, 6.1, 6.2 | Equal tier to the builder | Findings folded in and listed in each PR; session model checks each against the code |
| Production steps | Session model | Production data, not delegated | Rollout probes |

## Crash-proofing for the build

Each PR is built in its own worktree off fresh `origin/main`, with **one commit per numbered item** and a `CHECKPOINT.md` (what's done, what's next) updated after each commit. **Every agent prompt restates "commit after each item".** Agents never spawn nested agents. If a build is interrupted, where it got to is filed on SYC-209 before stopping.

## Linear

| Ticket | Where it is built |
|---|---|
| SYC-209 | This plan |
| SYC-255 | PR 0.1 |
| SYC-245 | PR 0.2 (Decision 2) |
| SYC-263 | PR 1.1 (column), 3.3 (form), roles 4.2 (saved list). Comment added: now optional, positions allowed |
| SYC-256 | PR 1.1 (redaction path), 5.1 (the function); the button is SYC-208's |
| SYC-257 | Settled by roles Decision 12; comment added |
| **SYC-287** (new) | Real-phone tap check, blocks PR 3.1 |
| **SYC-288** (new) | Later: our own tile set |
| **SYC-289** (new) | Later: public sites with no named guardian |
| SYC-53 | Comment: K7 (its PR 3.4 should wait for PR 6.2), T16 and T30 named here |
| SYC-4, SYC-283 | The card's and guardian pages' Greek and French |

## Review

An independent Sonnet critic reviewed this plan in its own worktree on 12 Oct 2026, against the spec, the roles spec and plan (`b32da55`), the data spine, `DECISIONS.md` and the code on `main`. It found **no blockers** and no way a site could become public before Slice 6. It found ten major and ten minor issues. The session model checked the key ones in the code (`teamCorrections.ts:184–197` writes the form's value; `buildWelfareAlert` is synchronous, called at `outbox.ts:292`; life status is decided in `resolve.ts:419`) before folding them in.

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Major | Tile addresses, map links and form addresses would put positions in browser history and the hosting provider's edge logs | K13: opaque tile references; every map action is a POST form with hidden fields; a test over every team page; "Every place" item 5 |
| 2 | Major | "Near a feeding site" in the alert email tells the mail provider where a site is; the email builder is synchronous | The email silently drops links; the check runs in the outbox; a failed check still sends the alert, without links (PR 0.2) |
| 3 | Major | Slice 4 missed roles PRs 1.3, 2.1 and 2.2, and nobody owned the Decision 14 line on the roles pages | Prerequisites listed; `movedAwayNotices` is this plan's, called by the roles pages; no guardian invited before 4.1 and 4.2 |
| 4 | Major | After roles PR 0.5, a guardian would pass the record-based check on Slice 2–3 pages that show team-only content | Slices 2–3 call `can()` with no target (fails closed) until PR 4.1 switches targets and filters on together |
| 5 | Major | Forgetting a name: whole-word matching misses Greek endings; `public_label` missed; public sites kept without a guardian; placeholder names clash | Stem matching with a preview; `public_label` added; make-private on clearing; numbered placeholder; test 23 extended |
| 6 | Major | A guardian change while the make-public page is open could record consent for the old guardian | The page carries the guardian name; the colony row is checked `FOR SHARE`; test 13 case and probe (K8) |
| 7 | Major | A SQL copy of "is this cat alive" would drift from the resolver | K12: the count uses `resolveLifeStatus`, never leaves the request; probe added |
| 8 | Major | PR 6.2's preview needs the strings package that 6.3 created | The package is created in 6.2, with a bundling check |
| 9 | Major | 360 px phones don't fit the 171 px mosaic | Five width bands from 320 px; displayed size tested at each |
| 10 | Major | "Mark wrong" on a colony would take the replacement value from the form | Worked out on the server; "newest" defined; probe added |
| 11–20 | Minor | Decision 14's 30 days is invented; zoom 12–18 too coarse and the tile count wrong; ids countable by POST; history kinds and the exactly-one check unprobed; label rule sources undefined; `updated_at` precision; missing limiter, header, island-box and error-cache tests; production campaign setting; real positions in session transcripts; guardian-page loose ends | 30 days kept and flagged as this plan's choice; zoom 12–19 with corrected counts; identical answers for every method; kinds listed and probed; sources defined; exact text comparison; tests and probes added; a release check; a marked test colony on production; the button, the public-only "Add cats" view and the history window for reassigned sites added to 4.1 |

**Checked and confirmed correct by the critic:** every file and line claim it checked; that only `rename_colony` and `set_site_public` exist today; that strict links to `people.id` are safe (`severPerson` leaves rows in place); every spec decision listed in the brief (team half before launch, guardian powers, the bands, 72 hours and seven days, English-only team pages, the code rules, Decision 11, the three preconditions); the migration and PR order; that nothing in Slices 1–5 can set `is_public`; every spec test mapped; and the wording rules.
