# SYC-209: feeding sites and colonies on the dashboard

**Status: draft for Samuel's approval. Nothing is built yet.** Three questions need Samuel's answer before the build starts (see "Decisions for Samuel"); each has a recommendation.
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
| **K2** | §11.1: `made_public_by` becomes a link to people; spine ask 5: `colonies.created_by` is a link to people | Both are `text` today. The roles plan (C7) writes the creator's id into `created_by` as text | Both become strict links to `people.id` in **one** checked migration (PR 1.2), refusing with a list if any value isn't a person's id. Production holds no colonies created through a screen, so this is expected to be empty. The roles plan's `createColonyWithPlacement` then writes a real link |
| **K3** | §11.1: "the plan's first step is a count" on production | db-ops has no read-only query command | The migration itself refuses with a list if a public, labelless or non-uuid row exists (test 24). The count is still run first, read-only, through the Neon tools, in the same "ask" mode window as the snapshot (Rollout) |
| **K4** | §3: on a 390 px phone the map is 2×2 tiles of 179 px | At 375 px (iPhone SE and mini) 358 px of tiles leaves no right margin. The tap test confirmed no sideways scroll at 375 px, but the gutter disappears | The page draws two mosaics, 179 px and 171 px, and a CSS width rule shows one. **Each form posts its own size** in its address, so the server always knows the scale it was tapped at. No script |
| **K5** | §7.5: "forget this guardian" is a team power unless the roles spec says otherwise | The roles spec §17.4 point 1 says it is **management only**; its plan leaves the button to SYC-208's plan | This plan builds the function that blanks the name in every feeding-site and colony store, with test 23 (Slice 5). The management-only button is SYC-208's |
| **K6** | §2.6: the Colonies page lists "Recent guardian changes" | The roles catalogue names its capability `view_guardian_changes` | Uses `view_guardian_changes` |
| **K7** | §7.3: a guardian asks for a site to be public; the team decides on the §4.3 page | The roles plan's PR 3.4 ("Needs an OK") approves by calling SYC-209's make-public page, which is **after launch** (spec Decision 2). If 3.4 ships first, a guardian can ask and nobody can act | Recommend 3.4 waits for this plan's PR 6.2. Raised as a comment on SYC-53, not by editing that plan |
| **K8** | §11.2: every write to a site is conditional on `updated_at` | `colonies` has no `updated_at`, and the spec adds no colony columns | Colony renames are already safe (the folded-name unique index refuses a clash, and both renames are in the history). Guardian-name edits use last-write-wins with both in the history. No colony column is added |
| **K9** | §11.3: rate-limited "like the other public reads" | Only photos have a read limiter, and limits are counted per server (SYC-105) | The public sites list and the code lookup get their own limiter, `feedingSpotLimiter`, shaped like `photoLimiter`. SYC-105's per-server caveat applies unchanged |
| **K10** | §6: "the Help tab's campaign text (`lib/campaign.ts`)" in the app | The file is in the API server, and its default title names the Vaporia colony | Changed in PR 6.3, with the "no public string names a colony" test (test 25) |
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

**Not yet tested: Safari (WebKit) and Firefox (Gecko).** This machine has no Xcode simulator and no WebKit or Firefox test browser, so those two engines need a download (Decision 3). Chrome on Android is the same engine as tested, with touch emulation. Real phones are checked again on the development site in PR 3.1, as test 17 requires.

---

## Decisions for Samuel

Three, all about *how* or *when* to build what is approved. None reopens a decision in the spec.

### Decision 1: do the team's colonies and private map wait for the roles foundations?

**The question.** The team's half (Slices 2 and 3) uses capability names that don't exist yet, such as `create_colony` and `add_feeding_site`. The roles plan creates them, with strict checks, in its PR 0.5, which comes after four other roles PRs and a change to the sign-in Worker. Should colonies and the private map wait for that?

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **1A. Don't wait (recommended)** | Slices 2 and 3 add the names they use to today's list, held by the team only, exactly as `can()` works today ("does this person hold the team role?"). Each route already looks up its colony from the record and passes it to `can()`, so when PR 0.5 makes `can()` strict, the routes are already right | The spec says so (§7.2: "nothing in the team's half waits for it"). Colonies are ready for launch even if roles slip. **Safe:** until the roles PRs 0.3, 0.4, 0.5 and the Worker change are live, nobody but the team can sign in at all | Two plans edit `capabilities.ts`: whichever merges second rebases (a few lines). PR 0.5's route walk must list this plan's routes; if they merged first, 0.5 adds their rows |
| 1B. Wait for PR 0.5 | Slices 2 and 3 start after the roles foundations are live | One way of checking permissions from the start; no rebase | Colonies and the map wait on six roles PRs and the Worker. If roles slip, the team launches with no colonies and no map, which spec Decision 2 put before launch |

**Recommendation: 1A.** Guardians (Slice 4) wait for the roles foundations either way.

**What people notice.** With 1A, the team gets colonies and the map sooner. With 1B, they get them later. Nobody else notices either way.

### Decision 2: removing the links that send exact positions to Google (SYC-245)

**The question.** Today the team's cat page, the welfare queue and the welfare alert email each have an "Open map" link. It opens Google Maps (and in the email also Apple Maps) at the exact spot. Cats are mostly seen where they are fed, so these links tell Google where feeding spots are. The spec says "Make a feeding site here" can't ship until these links are gone, **or** until they are dropped for any position within 50 m of a feeding site (its fallback).

| Option | What the team gets | Benefits | Risks |
|---|---|---|---|
| A. Remove all three links | Exact positions shown as plain text, and (from Slice 3) on our own map | Nothing exact goes to a map company, ever | Someone rushing to a cat in trouble loses one-tap directions in their phone's maps app. They can copy the numbers, which sends the same position to the same company anyway, just more slowly |
| **B. Mixed (recommended):** remove the link on the cat page (replaced by our own map in Slice 3); keep it in the welfare queue and alert email, **except** within 50 m of any feeding site | Directions still work for welfare call-outs, which are about one cat in trouble, not about a feeding spot | The cat page, where sites are made, never leaks. A welfare report near a known feeding spot shows "Near a feeding site: see the dashboard map" instead of the link | A report away from a known site still goes to Google when tapped, including at a spot that *later* becomes a site. That is the spec's own accepted fallback |
| C. The 50 m rule everywhere, including the cat page | Links stay for most positions | Least change for the team | A sighting is usually what *becomes* a site, so on the cat page the link has often already been tapped before anyone makes a site there. That is the leak the spec is about |

**Recommendation: B.** It puts the strict rule where sites are created, and keeps directions for welfare call-outs, where a minute matters.

**What people notice.** On a cat's page, "Open map" becomes "Show on our map" once Slice 3 is live (plain text until then). In the queue and the alert email, nothing changes except near a feeding site.

### Decision 3: finishing the tap test in Safari and Firefox

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
| `feeding_site_people_links` | 1.2 | `feeding_sites.made_public_by` and `colonies.created_by` from text to a strict link to `people.id` | **No:** a type change. Stops with a list if any value isn't a person's id |
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

Written for the recommended option B; if Samuel picks A or C, the same PR changes accordingly.

- **Cat page** (`catPages.ts`, `place()`): the "Open map" link is removed. Positions show as text (`37.4452, 24.9423`, team-only as today). PR 3.4 adds "Show on our map".
- **Welfare queue** (`queuePage.ts`) and **alert email** (`alertEmail.ts`): the Google and Apple links stay, except when the position is within 50 m of any feeding site, in which case the line reads "Near a feeding site: see the dashboard map". There are no sites until Slice 3, so nothing visible changes yet; the check is written now so it can't be forgotten. Distance is computed in the query against `feeding_sites` (retired sites included, since the spot is still a known place).
- **Tests.** The cat page contains no `google.com/maps` and no `maps.apple.com` (a source test over `lib/teamPages` too, so a new page can't add one). With a site seeded 30 m from a report, the queue line and the email have no outbound link; at 80 m they do. The existing assertions in `team.queuePage.test.ts:148` and `reports.test.ts:501–502` are kept for the "far" case. **Mutation probes:** put the link back on the cat page → red; change 50 to 0 → red.

---

## Slice 1: the records (nobody sees anything)

**In plain English.** The database learns to hold everything the screens will need: a site's public label and code, a "how to find it" line, whether it is retired, and a permanent history of every change, which can be blanked if a guardian asks to be forgotten. Every existing site stays private. Nobody sees any change.

### PR 1.1: site columns, the history and the read log (migration `feeding_sites_and_history`)

**The migration, in one transaction, stopping with a list and changing nothing if a check fails:**

1. **Refuse** if any `feeding_sites` row has `is_public = true`, printing the ids (spec §11.1: the new rules would fail on deploy). A public row must be made private by hand first. Production is expected to have none (the count, Rollout step 1).
2. Add to `feeding_sites`: `public_label` text; `directions` text; `public_id` text unique; `last_public_lat`, `last_public_lng`; `guardian_aware` boolean; `retired_at`, `retired_by` (uuid → `people.id`); `updated_at` (not null, default now). Checks: `is_public` needs `public_label` and `public_id`; `is_public` and `retired_at` never both set; the two `last_public_*` columns set together or not at all.
3. Create `feeding_site_old_codes` (`site_id` → `feeding_sites.id`, `public_id` unique, `retired_at`, `reason` check in `moved`, `retired`). A code can never be in both tables (a trigger on insert into either refuses a code the other holds).
4. Create `mapping_events` exactly as spec §11.1: `subject_kind` check `site`/`colony`, `subject_id`, `kind` (a check listing every event of spec §8), `person_id` (uuid, strict link), `actor_system` (check in `system:seed`, `system:migration`), `at`, `before` jsonb, `after` jsonb, `note`, `guardian_aware`, `redacted_at`, `redaction_reason`. **Exactly one of `person_id` and `actor_system` is set** (check). A trigger copied from the `observations` trigger: no insert may arrive redacted; no delete; the **only** update sets `redacted_at` and a non-empty `redaction_reason` and blanks `before`, `after` and `note` (to `{}`, `{}` and null), with every other column unchanged. A truncate guard uses the shared `append_only_no_truncate()`. Index on (`subject_kind`, `subject_id`, `id` desc).
5. Create `site_page_reads` (`person_id` strict link, `site_id`, `at`). No position column.
6. Add `redacted_at`, `redaction_reason` to `colony_name_history`, with the same one-update trigger (blanking `name` and `normalised_name` to a fixed placeholder; it has no other free text).
7. Write one `mapping_events` row per existing site: `kind = 'existing'`, `actor_system = 'system:migration'`, `after` = name, position, colony. Every existing site stays private, with no label and no code.

**Code.** The schema in `lib/db/src/schema/colonies.ts` (columns, checks, indexes; triggers live only in the migration, per the README). `system:seed` and `system:migration` join the app-written authors list. A small `lib/mappingEvents.ts` with one writer, `recordMappingEvent(tx, …)`, which **requires a transaction** (it takes the caller's `tx`, never the pool), so a change and its history row always commit together.

**Tests.** Test 11 (the database half): the history trigger refuses delete, truncate, an insert already redacted, and every update except a redaction that blanks exactly `before`, `after` and `note`. **Mutation probe:** let the trigger allow `kind` to change → red. Test 10 (the database half): `is_public` with `retired_at` is refused. Test 24: on a seeded copy, a public row, a public row with no label and a retired-and-public row each stop the migration with the id listed; existing sites each get exactly one `system:migration` event; every event has exactly one of `person_id` and `actor_system`. Up/down/up passes.

### PR 1.2: strict links to people (migration `feeding_site_people_links`)

Its own step, as spec §11.1 asks, because it changes a column's type.

- **Refuse with a list** if any `feeding_sites.made_public_by` or `colonies.created_by` is not null and isn't the id of a row in `people`.
- Convert both to `uuid`, with a strict link to `people.id`. Rollback converts back to text.
- **Tests.** Test 24 (rest): a non-uuid value, and a uuid that isn't a person, each stop the migration with the id listed; valid values convert unchanged. Up/down/up passes.

