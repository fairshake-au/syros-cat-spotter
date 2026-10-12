# SYC-2: coat, markings and health on cats

**Status: draft for Samuel's approval. Nothing is built yet.** Five questions below need Samuel's answer before the build starts (see "Decisions for Samuel"). Each has a recommendation.
**Spec:** `docs/specs/coat-markings-and-health.md`, approved by Samuel on 12 October 2026 (PR #104, merged as `91b32be`). This plan builds it as written. Its decisions (SYC2-D1 to D10) are final and are not reopened here. Where the spec and the code on `main` disagree, "Where the spec and the code disagree" says so and either asks or names the fix.
**Builds on:** `cat-record-data-spine.md` (observations, the resolver, the public payload), `choose-a-different-cat.md` (§4.7 the colour list and filter, §8.4 the sentence SYC2-D10 narrows), `add-details-later.md` (the answers endpoint and the details card), `roles-and-invites.md` (the four capability names and the guardian role), `team-access-and-welfare-queue.md` (the dashboard and the welfare route), and `DECISIONS.md`. The format follows `syc-119-choose-a-different-cat.md`, `data-spine.md` and the SYC-53 plan (`syc-53-roles-and-invites.md`, on branch `claude/syc-53-plan`, not yet merged).
**Linear:** SYC-2 (this plan). Touches SYC-161, SYC-5, SYC-52, SYC-53, SYC-209, SYC-152, SYC-185, SYC-1, SYC-62, SYC-283, SYC-244, SYC-243, SYC-242, SYC-241 and SYC-42.
**Checked against:** `origin/main` at `586763a` (12 October 2026); open PRs #101, #107 and #111; the SYC-53 plan branch at `e21a16e`; the SYC-209 plan worktree (no commits yet when this was written); and Linear SYC-2 with all five of its comments, plus the tickets above. Every "exists today" claim names the file it was read in.

---

## In plain English

Today a cat on the map has a photo, a name, a place and its sterilised line. Nobody can say what it looks like, and the team has nowhere to record a vaccination or a note about a cat's health.

When this plan is built:

- **Everyone** sees a cat's colour and markings on its page, quietly, next to its place: *Ginger · Tabby · White paws · Kinked tail*. The same short line appears on each card in "Find the cat", so a spotter can compare. The cat-alog gets a colour filter. Nothing on any public screen ever says anything about a cat's health or vaccinations.
- **Spotters** who find a new cat see one optional line after their points: *"Agatha looks Ginger · Tabby, right?"* with Yes, Change and Skip. Later, the "add details" card on a cat they spotted in the last 30 days can ask about colour or markings, one question per sighting. Ticking a mark that could be an injury (a torn ear, a kinked tail, one eye, three legs, a short tail, odd eyes) shows "Does it look hurt? Tell Syros Cats." right there.
- **The team** gets an Appearance section on each cat's dashboard page (confirm, correct, or mark one statement wrong), a small "Colour check" list of cats worth a second look, a place to record vaccinations (rabies, the core cat flu and enteritis vaccine, or another by name), and team-only health notes on the cat.
- **Cat guardians**, once the roles work lets them in, do the same for cats in their own colonies. What they say about colour and markings stands at once, and the team sees it in the recent guardian changes list. They can read and add health notes on their own cats but cannot record vaccinations.
- **Donors** see one number on the Help tab once at least five cats have been vaccinated this calendar year: *"23 cats vaccinated this year"*. It names no cat and no vaccine.
- **The old shared-password care route** can no longer be used to post free-text care notes to a cat's public timeline (Decision C), so no health or vaccination detail can reach the public or a follower's push that way.

**Nothing is asked before the points**, appearance never feeds the matcher, and nothing about appearance waits in the offline queue.

### What Samuel, the team and spotters notice, step by step

| Step | What changes for people |
|---|---|
| **The docs PR** | Nothing. The data spine, `choose-a-different-cat.md` and `DECISIONS.md` say what the approved spec says |
| **Slice 1: the record** | Nothing visible. The record can hold colour, markings, vaccinations and health notes, and works out each cat's colour and markings |
| **Slice 2: what the public sees** | Cats show their colour and markings on their page and in "Find the cat". At first only cats the team has described have any |
| **Slice 3: the team** | The team describes cats, records vaccinations, writes health notes, and works through the Colour check list |
| **Slice 4: spotters** | Spotters describe cats after their points and on the details card. The cat-alog gets its colour filter |
| **Slice 5: guardians** | Guardians describe cats in their colonies and read and write their health notes |
| **Slice 6: donors** | The vaccinated-this-year number appears on the Help tab once it reaches five |
| **Slice 7: the old care route** | Nobody notices. One way of writing free text to the public timeline is closed |

**Why the team comes before spotters.** The brief that commissioned this plan listed the spotter screens before the team screens. The approved spec's §14 orders them the other way ("so there is somebody to confirm"), and one of SYC2-D1's four conditions depends on it. That condition is that any cat whose colour or markings spotters move is put in front of the team on the Colour check list. If spotters could write before that list exists, the condition would be broken for as long as the gap lasted. The spec wins, so the team slice ships first.

---

## What exists today, and what this plan needs

| Area | Today on `main` | Read in |
|---|---|---|
| Observation kinds | `life_status`, `sterilised`, `ear_tip`, `food_and_water`, `note`, `name`, `colony`, `welfare_report`, `welfare_outcome`, `coat`. An unknown kind is refused (`UNKNOWN_KIND`). Kinds are code, not a database enum | `artifacts/api-server/src/lib/observations.ts:33-44` |
| The `coat` value | `{ colours, modelVersion }`. **`modelVersion` is required on every value**, so a person's statement is refused. 1–2 colours from `COAT_COLOURS` (the eight from `choose-a-different-cat.md` §4.7); `not_sure` alone | `observations.ts:97-106`, `:274-300` |
| Who may write | `REACHABLE_ROLES` = `public`, `staff`, `admin`, `system`. `guardian` and `management` are refused (`UNREACHABLE_ROLE`). `prompted` is already a valid provenance. `machine` only from `system:vision` | `observations.ts:56-84` |
| Superseding a row | `writeObservation` stores `supersedesId` and checks nothing about it. **One device superseding another device's row is not refused at write time**; only the callers keep to their own rows | `observations.ts:346`; `routes/sightings.ts:161` |
| The table | `kind`, `role_at_time`, `authority_scope` and `provenance` are all free `text` with no check constraint. The only check is "exactly one of device or account, unless redacted". Append-only trigger | `lib/db/src/schema/observations.ts` |
| Migrations | Highest is `0014_photo_visibility.sql` | `lib/db/migrations/` |
| The resolver | `resolveSterilised`, `resolveLifeStatus`, `resolveCat`. Nothing for coat, markings or vaccination. The `reported` confidence is in the type but **never produced**. Evidence of life comes from `sterilised`, sighting-free `ear_tip`, standing `welfare_report` and resolved sightings; `coat`, `note`, `name`, `colony` and `food_and_water` are excluded by name | `artifacts/api-server/src/lib/resolve.ts:16`, `:79`, `:273-511` |
| Loading observations | `loadCatRecords` loads **every** observation for the cats, with no list of kinds; each resolver function picks its own | `observations.ts:~480` |
| The public payload | `serialiseCat` builds `CatWithStats` field by field: id, name, description, photo, position and precision, counts, discoverer, owner, `hasHome`, `lifeStatus`, `notSeenSince`, `sterilised { value, confidence, clippedTipSightings }`. **No colour or markings** | `artifacts/api-server/src/lib/catHelpers.ts:72`, `:146` |
| Payload tests | Snapshot files `routes/__snapshots__/cats.publicDetail.p3-2.txt` and `publicPayload.p6.txt`; `publicPayload.blur.test.ts` checks coordinates. **No test lists forbidden field names** | `routes/cats.publicDetail.test.ts:148`, `routes/publicPayload.p6.test.ts:205` |
| Machine coat colour (SYC-161) | **Not built.** The kind, the colour list and the `system:vision` author exist, but nothing writes a reading. SYC-161 is SYC-119's planned Slice C | Grep of `api-server/src`; `syc-119-choose-a-different-cat.md` "Slice C" |
| Colour filter in "Find the cat" | **Not built.** `CatPicker.tsx` says "Not in this slice: the colour chips". Cards show photo, name, SYR number and the deceased line | `artifacts/cat-spotter/components/CatPicker.tsx` |
| The cat-alog | Filters `all`, `nearby`, `homed`. A comment says the design's health filters were not built | `artifacts/cat-spotter/app/(tabs)/cats.tsx:49` |
| The offline catalogue | Key `cat-spotter/cats-cache/public/v2`. The retired key is deleted without being read. Cached cats are `JSON.parse`d and cast, with no field validation, so an extra field is kept and a missing one breaks nothing. A test fails if any other file names a cache key | `artifacts/cat-spotter/lib/catalogue.ts:14`; `lib/__tests__/catalogue.test.ts` |
| The new-cat result screen | `app/review.tsx` success branch: tick, "New cat registered", name, SYR code, points, badges, then the questions block (`SightingQuestions`: ear tip, food and water, note), then the buttons | `artifacts/cat-spotter/app/review.tsx:284-372` |
| The details card | `MoreToAdd` on the cat page, hidden offline or with no open sightings; the sheet reuses `SightingQuestions` | `components/MoreToAdd.tsx:37-43`, `:121-129`; `app/cat/[id].tsx:240` |
| The answers endpoint | `POST /sightings/:id/answers`: device and secret checked, sighting must be resolved, 30-day window, ear tip once per (device, cat) with `changeEarTip` and `EAR_TIP_CHECKED`, **advisory lock on (device, cat)**. Accepts only `earTip`, `foodAndWater`, `note`. **No rate limiter on this route.** Rows carry the sighting's time as `observedAt` | `artifacts/api-server/src/routes/sightings.ts:114`, `:905` |
| Open sightings | `GET /profiles/:deviceId/cats/:catId/open-sightings`, with an `open` flag per sighting; the photo is null when hidden | `routes/sightings.ts:1081` |
| Capabilities | Twelve names; `can()` grants all of them to `staff` and ignores the target. **None of the four SYC-2 names** | `artifacts/api-server/src/lib/capabilities.ts` |
| Team corrections | `capabilityFor()` maps only life status, sterilised and ear tip. `recordTeamStatement` accepts only `life_status` and `sterilised`, writes `roleAtTime: "staff"`, and keeps the reason inside the value. Routes are Origin, then session and capability, then body; a form post gets a 303, JSON otherwise; reason 1–500 characters. "Looks right" writes an `agreesWith` with no photo | `lib/teamCorrections.ts:44`, `:113`, `:166`; `routes/teamCorrections.ts:48`, `:180-507` |
| The team cat page | Drawn by the server with no scripts; "Correct the record" is a list of `<details>` forms, each behind `may(capability)`. The "Probably sterilised" list (`GET /team/likely`) is the model for a Colour check list | `lib/teamPages/catPages.ts:~476`; `lib/likelyReview.ts:60`; `lib/teamPages/likelyPage.ts` |
| Hand-pick flags | Computed for the Likely list from `sighting_matches.choice = 'hand_pick'`. The team's "Matched by hand" list is SYC-152, not built | `lib/likelyReview.ts:60-164` |
| Welfare-report notes | `POST /team/reports/:publicId/note` behind `add_team_note`. Untouched by this plan | `routes/teamReports.ts:235` |
| The old care route | `POST /cats/:catId/updates`, shared `OWNER_SECRET`, types `desexed`, `adopted`, `general`; writes `cat_updates` (the public care timeline) and sends pushes. Kept as insurance until SYC-185 | `routes/notifications.ts:21`; openapi `CreateCatUpdateBody` |
| Donating | No donate screen; the Help tab shows the campaign from `GET /campaign` (environment settings) and opens an external page | `app/(tabs)/help.tsx`; `api-server/src/lib/campaign.ts` |
| Translations | One flat dictionary per language in `lib/i18n.ts`; a test requires identical keys and placeholders in `en`, `el` and `fr`, no empty values, and French "tu". No colour or marking words yet | `artifacts/cat-spotter/lib/i18n.ts`; `lib/__tests__/i18n.test.ts` |
| Ear-tip example photo | `assets/images/ear-tip-example.jpg` (SYC-79), exported as `EAR_TIP_EXAMPLE_PHOTO` | `artifacts/cat-spotter/lib/earTipExample.ts` |
| "This cat needs help" | `components/report/NeedsHelpLink.tsx`, on the cat page | `app/cat/[id].tsx:222` |

### Migrations

**None. The spec's claim holds.** Every column the new kinds need is free text or `jsonb`, so new kinds, a new authority-scope shape and the `guardian` and `management` roles need code changes only. Colour, markings, vaccinations and notes are observations; the Colour check list, the hand-pick flag and the donor count are queries over observations and `sighting_matches`. If a slice ever finds it needs a migration, it takes the next free number when it is generated after rebasing on the latest `main` (SYC-53's own migrations are expected at `0015` and after), never a number chosen by hand.

---

## Where the spec and the code disagree

| # | The spec says | The code on `main` says | What this plan does |
|---|---|---|---|
| **C1** | §14: Slice 1 needs SYC-161 for the machine's colour. §7.2: the colour filter in "Find the cat" sits on the resolved colour | **No machine reading and no colour filter exist.** Both are SYC-119's Slice C (SYC-161), not yet built. That slice also planned a `coat` payload field, a "people always win" rule and a cache-key bump, all three of which the SYC-2 spec replaced | **Decision A** |
| **C2** | §4.2, §10.2: a statement only replaces the same device's own statement, with a test | `writeObservation` does not check whose row is superseded | Slice 1 adds the check in `writeObservation` itself for public rows of `coat` and `markings`, and the resolver ignores any cross-device supersession it finds anyway |
| **C3** | §10.3: the spotter write is "per-device rate limited" | The answers route has no rate limiter | Slice 4 adds a per-device limiter to the answers route, covering the existing answers too |
| **C4** | §10.1: a guardian's statement carries `authorityScope: guardian_of_this_cat` | The SYC-53 plan's Decision B recommends `colony:<id>` for every guardian statement, and keeps `guardian_of_this_cat` for "This is my cat" (SYC-130) | Slice 5 uses whatever Samuel decides for SYC-53's Decision B. Nothing in this plan needs its own answer. If B1 (`colony:<id>`) is chosen, the docs PR's §10.1 text says so |
| **C5** | §10.2: `reported` "is the fourth rung the resolver already reserves; if SYC-52 has not made it reachable, this spec asks SYC-52 to" | `reported` is never produced | Slice 1 produces it for colour and markings only. Nothing else changes rung. A comment on SYC-52 records it |
| **C6** | §10.4, §10.6: "the public-payload leak list the data spine already tests" | There is no list of forbidden field names, only snapshots and the coordinate test | Slice 2 writes the named-field test the spec describes, for the new fields by name, and adds `vaccinated` and every health-note field to it |
| **C7** | §5.4, §6.4: guardians read team-only health notes on cats in their own colonies, and whether they see spotters' notes is controlled by `view_health_notes` | The SYC-53 plan's PR 2.1 builds a guardian cat view whose serialiser "has no field for … team notes" | Not a conflict in substance: that sentence is about welfare-report notes. Slice 5 adds health notes and spotters' notes to her cat page as a **separate block behind `view_health_notes`**, never through the guardian serialiser. A comment on SYC-53 asks that plan to say so, so its T4 field-by-field test lists the block as allowed |
| **C8** | §6.3: the donor count appears "on the donate screen" (SYC-1) | There is no donate screen. Donating lives on the Help tab, and SYC-1 (the donations backend) is in the Backlog | **Decision B** |
| **C9** | §6.4 rule 6: the care route's `general` type "is retired for team use when the shared-password care route is retired, or sooner" | The route is live, kept as insurance until SYC-185 | **Decision C** |
| **C10** | §5.3, §7.2: a hand pick whose colour disagrees is flagged "on the Colour check list and in the Matched by hand review" | "Matched by hand" is SYC-152, not built | Slice 3 puts the flag on the Colour check list. A comment on SYC-152 asks it to show the same flag when it is built |
| **C11** | §5.2: the cat page shows "**Ginger tabby** · White paws" | Nothing decides how two colours are written together in Greek and French, where adjectives agree with the noun | **Decision E** |
| **C12** | §3.3, §9: each chip has "a small picture and the word"; *Torn or notched ear*'s picture sits beside the ear-tip example photo | No chip pictures exist; only the ear-tip photo | **Decision D** |

---

## Decisions for Samuel

Five decisions. **A is the weighty one**; B to E are small and could be answered together.

### Decision A: who builds the cat's colour first, this plan or the auto-colour work (SYC-161)?

**The question.** Two pieces of approved work both touch "a cat's colour". The auto-colour work (SYC-161, Slice C of the approved SYC-119 plan) reads each cat's colour from its main photo and adds the colour chips to "Find the cat". This plan adds people's colours, the rules for which answer wins, and the colour on the cat's page. The SYC-2 spec assumed the machine readings would already exist. They don't, and SYC-119's plan for Slice C still describes the older rule ("people always win"), a second colour field and a cache-key change that would empty phones' offline catalogues. Somebody has to go first.

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **A1. This plan goes first; SYC-161 builds on it (recommended)** | This plan's Slices 1 and 2 build the colour rules and put `coat` and `markings` on every cat. SYC-161 then only adds the machine reading, the backfill and the "Find the cat" chips, using the rules and field already there | One set of rules and one field, built once by the work that owns them. No cache-key change ever ships. The team can describe cats straight away. SYC-161's own plan gets smaller | Until SYC-161 ships, the colour line after the points has no guess to offer, so it asks with empty chips ("This cat looks… Pick a colour") instead of "Ginger · Tabby, right?". "Find the cat" has no colour chips until then, though its cards show markings | Colours appear first for cats the team describes, then for spotters' answers, then for every cat once the machine reads them |
| A2. SYC-161 goes first, as the spec's §14 assumed | Build SYC-119's Slice C (reader, backfill, chips), corrected to the SYC-2 rules, then this plan | Every cat has a colour from day one of this plan; the "right?" line always has a guess | SYC-161 has to build the colour rules itself, or ship an interim "the machine's word" rule that this plan then replaces. The two plans edit the same resolver function and the same payload field, so work is done twice or rebased twice | Colours appear for every cat first; people's corrections follow |
| A3. Fold SYC-161 into this plan as one of its slices | This plan owns the reader and the chips too | One plan, one owner | SYC-119's approved plan loses a slice it already sequenced, and this plan grows by a model-calling background job with its own cost cap and tests | The same as A1, in one stream of work |

**Recommendation: A1.** The rules for which colour wins are this spec's, and building them before anything writes machine readings means nothing is ever shown under the wrong rule. The cost is cosmetic and temporary: no pre-filled guess, and no colour chips in "Find the cat", until SYC-161 lands. If A1 is chosen, a comment on SYC-161 (filed by this plan, see "Linear") tells its builder to reuse `resolveCoat` and the `coat` field, drop the cache bump, and import `COAT_COLOURS`.

### Decision B: where the "N cats vaccinated this year" number goes before the donations work exists

**The question.** The spec puts the number "on the donate screen" (SYC-1) and in the charity's reports (SYC-62). Neither exists yet. The Help tab already shows the campaign and the donate buttons.

| Option | Benefits | Risks | What donors notice |
|---|---|---|---|
| **B1. Build the number now and show it on the Help tab, under the campaign (recommended)** | Donors see what vaccines achieved as soon as five cats are counted. One quiet sentence, no new screen. SYC-1 and SYC-62 reuse the same endpoint later | The Help tab is not yet a "donate screen" in the spec's sense; if SYC-1 redesigns it, the sentence moves with it | "23 cats vaccinated this year" under the campaign |
| B2. Build the endpoint now, show it nowhere until SYC-1 | Nothing on screen changes until the donations work is designed | The number is computed and never seen; donors who fund vaccines see nothing for months | Nothing |
| B3. Wait for SYC-1 and SYC-62 entirely | Nothing built early | The slice sits unbuilt with nothing blocking it | Nothing |

**Recommendation: B1.** The rules (distinct cats, this calendar year, nothing below five, number and year only) are fixed by the spec and don't depend on where the sentence sits. The reports half waits for SYC-62, which gets a requirement comment.

### Decision C: closing the old care route to free-text notes

**The question.** The old shared-password route (`POST /cats/:catId/updates`) can post a free-text `general` note onto a cat's **public** care timeline and push it to followers. The spec says no health or vaccination detail may ever go that way, and that `general` is retired "when the route is retired, or sooner". The whole route's retirement is already its own ticket (SYC-185), waiting until staff can record sterilisation and adoption on the dashboard. Software can't tell a health note from any other free text, so the only real guard is to stop accepting `general`.

| Option | Benefits | Risks | Who notices |
|---|---|---|---|
| **C1. Refuse `general` now; keep `desexed` and `adopted` until SYC-185 (recommended)** | Closes the only path by which a health detail could reach the public timeline and a push. The route keeps its insurance value for the two structured types. One small PR | Anyone still using the route for a free-text note loses it. Before merging, Claude checks the production timeline for any `general` row in the last 90 days; if there is one, the PR stops and asks Samuel | Nobody, if the check finds no recent use |
| C2. Retire the whole route now (SYC-185) | Simplest end state | Removes the insurance the team-access decisions deliberately kept until the dashboard does sterilisation and adoption everywhere; that is SYC-185's call, not this plan's | Whoever holds the shared secret |
| C3. Leave the route alone; rely on the written rule and SYC-185 | No code | The rule depends on whoever holds the password remembering it; one note about a sick cat goes to every follower's phone | Nobody, until it goes wrong |

**Recommendation: C1.** Old app builds already show an unknown timeline type as a plain message, so nothing on phones breaks.

### Decision D: the pictures on the colour and marking chips

**The question.** The spec gives every chip "a small picture and the word", and requires a picture of *Torn or notched ear* beside Syros Cats' ear-tip photo, so nobody confuses the two. Nineteen pictures are needed (eight colours, eleven markings).

| Option | Benefits | Risks |
|---|---|---|
| **D1. Simple drawn pictures, one consistent set made by Claude as part of Slice 4, reviewed by Samuel in the browser check (recommended)** | Consistent, clear at chip size, no rights to clear, ready when the code is. Colours can be plain swatches (as `choose-a-different-cat.md` §4.7 already says) | Drawings are less vivid than photos; *colourpoint* and *odd eyes* need care to read at 40 px |
| D2. Real photos from Syros Cats, as for the ear tip (SYC-79) | True to life | Nineteen good, consistent photos is a lot to ask a volunteer team; it blocks Slice 4 on their time |
| D3. Words only, no pictures | Nothing to draw | Breaks the spec (§9) and works worse for tourists reading another language |

**Recommendation: D1**, with the torn ear drawn and shown beside the real ear-tip photo. If Syros Cats later send photos, swapping a picture is a one-file change.

### Decision E: how two colours are written on the cat's page

**The question.** English reads naturally as "Ginger tabby". Greek and French make colour words agree with the noun and often change their order, so a sentence-builder for every pair is a grammar engine in three languages.

| Option | Benefits | Risks |
|---|---|---|
| **E1. Join with a dot in every language: "Ginger · Tabby · White paws" (recommended)** | No grammar to get wrong; the same shape in all three languages; matches the chips | Slightly less natural than "Ginger tabby" in English |
| E2. Natural phrases, written out for each of the colour pairs in each language | Reads naturally | About twenty pairs × 3 languages, each needing Johnny's check (SYC-283); easy to get subtly wrong |

**Recommendation: E1.** It is what the picker cards and the spec's §7.2 already use for markings.

### Also needed from Samuel, not decisions

- **Johnny's check of the Greek and French** (SYC-283, overlapping SYC-244) before Slice 4 shows the chips to spotters in those languages. The strings land in Slice 2; Slice 4 can ship in English, Greek and French with the drafts marked for his review, as the spec allows ("checked in testing"), or wait. The plan assumes ship-and-check, as Samuel answered on 12 October.
- **SYC-53's Decision B** (C4 above) settles the guardian scope shape for Slice 5.

