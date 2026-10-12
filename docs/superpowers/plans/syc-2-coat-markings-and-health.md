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

---

## How it ships: the order

Foundations first: the documents, then the record and its rules, then what the public sees, then the team, then spotters, then guardians, then donors, then the old route. Every PR is built in **its own worktree off fresh `origin/main`**, is **one PR**, and can merge alone and leave `main` safe. "Review and merge" uses `/ship`: an independent adversarial review in **its own worktree** (never shared with the builder or another reviewer), findings folded in, CI green, merge, Linear synced, worktree removed.

| Step | PRs | Needs first | Who notices |
|---|---|---|---|
| **Docs** | D-SYC2: the data spine, `choose-a-different-cat.md` §8.4, `DECISIONS.md` | PR #104 merged (done); Samuel's answers to Decisions A–E | Nobody |
| **Slice 1: the record** | 1.1 the new kinds and the write rules · 1.2 the resolver | Docs merged | Nobody |
| **Slice 2: what the public sees** | 2.1 the payload, the words, the cat page and picker cards | 1.2 | Everyone, once a cat has a colour or marks |
| **Slice 3: the team** | 3.1 Appearance and the Colour check list · 3.2 vaccinations and health notes | 1.1 (3.2), 2.1 (3.1) | The team |
| **Slice 4: spotters** | 4.1 the answers endpoint learns appearance · 4.2 the colour line after the points and the details card · 4.3 the cat-alog's colour filter | 3.1 live | Spotters |
| **Slice 5: guardians** | 5.1 a guardian's appearance and health notes | 3.1, 3.2, and SYC-53's PRs 0.2, 0.5, 2.1 and 2.2 | Guardians and the team |
| **Slice 6: donors** | 6.1 the vaccinated-this-year number | 3.2 | Donors |
| **Slice 7: the old care route** | 7.1 refuse `general` (Decision C) | Nothing in this plan; can go any time after the docs | Nobody |

Slices 3.2, 6 and 7 do not depend on the colour rules and can be built in parallel with Slices 2–4 once their own "needs first" are merged. SYC-161 (the machine reading and the "Find the cat" chips) slots in after 2.1 under Decision A1, and needs nothing from Slices 3–7.

**Rollback** for every slice is a revert. Observations already written stay valid and are simply not read (spec §14). Nothing is deleted and nothing needs a migration to undo.

---

## Before any code: the docs PR (spec §10, §15)

**PR D-SYC2**, docs only, written from the spec's text word for word plus Samuel's answers to this plan's decisions. **It merges before PR 1.1**, because the code should never be ahead of the approved documents.

| File | What changes (spec section) |
|---|---|
| `cat-record-data-spine.md` §10.1 | The kinds `markings`, `vaccinated` and `team_note` and their values; `coat` gains the person's value and `{ retracted: true }`; `modelVersion` required only on a machine reading; who may write which kind; prompted and volunteered; `agreesWith` with no photo (spec §10.1, word for word). If SYC-53's Decision B is B1, the guardian scope is written `colony:<id>` rather than `guardian_of_this_cat` |
| `cat-record-data-spine.md` §10.2 | A new subsection, "Colour and markings": spec §4.2's rules word for word, and §10.2's details (voices, redacted rows, retraction, `observedAt` order, the confidence rungs, never crosses attributes, not notifiable) |
| `cat-record-data-spine.md` §3.4 | One sentence: `coat`, `markings`, `vaccinated` and `team_note` are not evidence of life |
| `cat-record-data-spine.md` §10.7 | `Cat` and `CatDetail` gain `coat` (a list; `[]` means not known) and `markings` (a list). The single wire shape for "not known" |
| `choose-a-different-cat.md` §8.4 | "A person's reading always beats the machine's" becomes the narrowed sentence (SYC2-D10). "One or two values, or 'not sure'" becomes the `coat: []` shape |
| `DECISIONS.md` | A new Part, dated 12 October 2026, carrying spec §15's entries, plus this plan's Decisions A–E as answered; a Part 3 ownership row (vocabulary and what is public: this spec; kinds and resolver: the data spine) |
| `coat-markings-and-health.md` | Only if Samuel's answers change something it says (Decision A changes §14's dependency on SYC-161; Decision E fixes §5.2's example) |

**Collisions, and how they are avoided.**
- **The SYC-53 docs PRs** D1 (`cat-record-data-spine.md` §6.5, §4.2, §10.1 vocabulary, §10.5, §4.5, §3.2, §6.7) and D3 (`DECISIONS.md`, a new Part 2n). D-SYC2 touches §10.1 only by **appending its own paragraph** after the existing kinds comment, and does not touch the role vocabulary lines D1 rewrites. Its `DECISIONS.md` Part takes the next free letter when it merges, never a letter chosen in advance.
- **The SYC-209 plan** (being written in another session) amends §10.5 and §6.7 (and `team-access-and-welfare-queue.md` §3.2). D-SYC2 touches none of them. The two sessions agreed by message on 12 October to keep two docs PRs in disjoint sections; whichever merges second rebases. If the SYC-209 session prefers one combined docs PR, that changes only who opens it.
- **PR #107** (SYC-130 "This is my cat") edits `DECISIONS.md` and the data spine's §4.2. No overlap with D-SYC2's sections.

**Also in this step (Linear, not files):** SYC-161's and SYC-5's descriptions are updated as spec §10.7 asks, once the docs PR merges (the comments filed now point at it).

---

## Slice 1: the record (nobody sees anything)

**In plain English.** The app learns to remember what people say a cat looks like, which vaccinations the team gave it, and the team's private notes about its health, and to work out from all of that what colour and markings to show. Nothing on any screen changes yet. When this slice is live, the record can hold everything the later slices need, and the rules that decide what the public will see are tested in isolation.

### PR 1.1: the new kinds and the write rules (spec §10.1, §10.3)

- **`OBSERVATION_KINDS`** gains `markings`, `vaccinated`, `team_note`. **`MARKS`** (the eleven codes from spec §3.2) is defined once, next to `COAT_COLOURS`, and exported; nothing else defines either list.
- **Validators** in `observations.ts`:
  - `coat`: `{ colours }` (1–2 of the eight; `not_sure` alone; **`black` + `white` is rejected**, so the only stored form is `black_and_white`, normalised by the caller); `modelVersion` **required when `provenance` is `machine`, refused otherwise**; or `{ retracted: true }`.
  - `markings`: `{ marks }` (distinct codes from `MARKS`; at most 4 from `public`, any number otherwise; `[]` allowed); `{ cantTell: true }`; or `{ retracted: true }`.
  - `vaccinated`: `{ vaccines, clinic? }` with 1–3 distinct entries from `rabies`, `cat_flu_enteritis` or `{ other: name }` (a typed name, trimmed, 2–60 characters); `observedAt` is the date given.
  - `team_note`: `{ text }`, 1–2,000 characters (the welfare note's limit).
  - `{ retracted: true }` is refused from `public`, and refused unless `supersedesId` is set.
- **Who may write which kind**, enforced in `writeObservation`, not left to callers: `coat` and `markings` from `public`, `staff`, `management` and (once SYC-53's PR 2.2 makes it reachable) `guardian`; `vaccinated` refused from `public`, `guardian` and `system` (the import exception is added when `records-import.md` is built, not now); `team_note` refused from `public` and `system`. `vet` is refused for `coat` and `markings`. `management` and `guardian` stay unreachable here until SYC-53's PRs 0.2 and 2.2 add them to `REACHABLE_ROLES`; this PR writes the rules against the role names so those PRs only flip reachability.
- **A device only supersedes its own row (C2).** For `public` writes of `coat` and `markings`, `writeObservation` refuses a `supersedesId` that points at a row with a different `deviceId` or a different kind (`NOT_YOUR_ROW`). Team supersessions are unchanged (they go through `lockActiveObservation`).
- **Not evidence of life.** The four kinds are added to the resolver's named exclusion comment, and a test asserts none of them moves `lastSeenAt` or life status.
- **No route writes any of these yet.** The answers route, the team routes and the guardian routes come in Slices 3–5.

**Tests.** Every validator branch, including: a person's `coat` with `modelVersion` refused, a machine `coat` without it refused; `black` + `white` refused; five marks from `public` refused, five from `staff` accepted; `[]` accepted; `vaccinated` from `public` and `guardian` refused; an `other` vaccine with no name refused; `team_note` from `public` refused; `{ retracted: true }` from `public` refused. **T-own-row:** device A's write superseding device B's `coat` row is refused. **Mutation probe:** delete the device comparison → red. **T-life:** a cat whose only recent rows are the four new kinds keeps its old `lastSeenAt` and life status. **Mutation probe:** add `markings` to the evidence list → red.

### PR 1.2: the resolver (spec §4.2, §10.2)

Three pure functions in `resolve.ts`, added to `CatSnapshot` (which stays a team-side structure; the public payload copies out only the value in PR 2.1):

- **`resolveCoat(rows, machineRows)`** → `Resolved<CoatColour[]>` plus `checkReasons`. The five rules of spec §4.2 in order: authority (newest by `observedAt`) → two voices per colour → the machine's reading → the newest single spotter filling a gap → not sure.
- **`resolveMarkings(rows)`** → `Resolved<Mark[]>` plus `checkReasons`. Authority is the whole list; marks with two voices dated after the newest authority statement are added and flagged; otherwise two voices per mark; spotters only add; `cantTell` and a later `[]` from a device that had ticked marks withdraw nothing.
- **`resolveVaccinated(rows)`** → the dates and vaccines the team recorded, newest first, or nothing. No negative state. Team-only.
- **One shared voice-counting helper** used by both: tidy (drop superseded, retracted and empty answers; normalise `black` + `white`); one voice per `deviceId` (newest row wins; a redacted row is a voice of its own); a cross-device supersession found in the data is ignored, so the row it pointed at still counts; two voices only count as two with **different `photoId`s and different Athens calendar days** (`Europe/Athens`, not UTC); `prompted` rows never count towards two.
- **Authority** comes from the shared role list (`TEAM_ROLES` from SYC-53's PR 0.2 if merged; today's `AUTHORITATIVE_ROLES` otherwise), plus `guardian` rows with a colony scope once SYC-53's PR 2.2 is live. A team or guardian Confirm (`agreesWith`, no photo) is an authority statement with the same value.
- **Confidence (C5):** authority `confirmed`; two voices `likely`; the machine or a single gap-filling spotter `reported`. This is the first place `reported` is produced; nothing else changes rung.
- **`checkReasons`**, the Colour check conditions (spec §5.3), as data so Slice 3 only reads them: `no_authority` (colour is the machine's alone or not sure), `spotters_over_machine`, `tied_camps`, `markings_reopened`, `markings_changed_recently` (spotter agreement in the last 30 days). The hand-pick reason is computed in Slice 3, because it needs `sighting_matches`.
- **Not notifiable.** The email job's snapshot comparison (data spine §9.3) ignores the new snapshot fields; a test proves a colour change queues nothing.
- **Never crosses attributes.** `resolveSterilised` and `resolveLifeStatus` are not passed the new kinds.

**Tests: every case in spec §10.6 under "Colour", "Markings", "Retraction" and the resolver half of "Vaccinated".** The ones that guard a silent failure get **mutation probes** (the counting rules are exactly where a wrong-but-green result hides):

| Test | Mutation probe |
|---|---|
| One device counts once, even with two live rows | Count rows instead of devices → red |
| Two devices, same photo → one voice | Drop the photo comparison → red |
| Two devices, same Athens day (23:30 and 00:30 UTC on one Athens day, and the reverse across Athens midnight) → one voice | Compare UTC days → red |
| A prompted "Yes" never counts towards two, including a prompted tap on a spotter-filled value | Treat `prompted` as `volunteered` → red |
| One spotter never overturns a real machine reading (SYC2-D10) | Let rule 4 run before rule 3 → red |
| A later machine reading never beats an earlier team or guardian statement | Order authority by `createdAt` against the machine → red |
| Two camps (two for ginger, two for black, nobody named both) → the newer camp, with `tied_camps` | Return both colours → red |
| *Ginger · Tabby* and *Ginger* agree on *Ginger*; *Tabby* not shown | Compare whole sets → red |
| Spotters only add: an omission, a later `[]` and `cantTell` remove nothing | Let a device's newest row replace its marks → red |
| Marking one of three spotters' marks wrong leaves the other two | Retract by kind instead of by row → red |
| Two voices dated after the newest team list show the mark and set `markings_reopened` | Ignore marks once an authority list exists → red |
| A cross-device supersession in the data does not remove the other device's row | Honour every `supersedesId` → red |
| A redacted row is one voice; a deletion between two voices still leaves two | Drop redacted rows → red |

Plus the plain cases: each rule alone and in conflict; a person's *Not sure* never wins; `black` + `white` equals `black_and_white`; two gap-filling spotters with different colours show the newest; an empty team list clears the marks; a team list of five; the team correcting after two spotters agree wins.

---

## Slice 2: what the public sees

**In plain English.** Every cat's page shows its colour and markings next to its place, in the reader's language: *Ginger · Tabby · White paws · One eye*. Each card in "Find the cat" shows the same line, so a spotter can compare the cat in front of them. Cats nobody has described show nothing, and nothing says how sure the app is. Phones that already have the cat-alog saved keep it; nothing is wiped on update. At first only cats the team has described have anything to show; that grows from Slice 3.

### PR 2.1: the payload, the words, the cat page and picker cards (spec §5.2, §7.2, §9, §10.4)

- **Server.** `serialiseCat` copies `coat` (the resolved value, `[]` when not known or `not_sure`) and `markings` (the resolved list) out of the snapshot. Nothing else: no confidence, author, count, model version or date. **Not `vaccinated`.** The loader in `catHelpers.ts` passes the new snapshot fields through. `lib/api-spec/openapi.yaml` gains both fields on `Cat` and `CatDetail` as optional; `pnpm --filter @workspace/api-spec run codegen` regenerates the client and the zod types. The snapshot files change, as expected.
- **App words.** `lib/i18n.ts` gains, in `en`, `el` and `fr`: the eight colour labels, the eleven chip labels, the four public display words that differ from the chip (`missing_eye` shows "One eye"; the other three keep their chip words, per spec §5.2), and keys for Slice 4's questions so the dictionary lands once. Greek and French are the spec's drafts, marked in a comment for Johnny (SYC-283).
- **App screens.** `lib/appearance.ts` turns codes into the display line (Decision E: joined with " · "; colours first, then marks in the spec's order; nothing when both are empty). The cat page shows it beside the location tag; each `CatPicker` card shows it under the name. A cat without the fields (an old cache, an old server) shows nothing.
- **The offline catalogue (spec §8, §10.4).** **The key stays `cats-cache/public/v2`.** No code in `catalogue.ts` changes.

**Tests.**
- **T-leak (C6), named fields.** `GET /cats` and `GET /cats/:id`: the `coat` and `markings` objects carry exactly a list each; no key named `vaccinated`, `vaccines`, `team_note`, `teamNote`, `healthNotes`, `checkReasons`, `modelVersion`, `confidence` (inside the new fields), `supportingObservationIds` or `conflicts` appears anywhere in the response. **Mutation probe:** serialise the whole `Resolved` object for coat → red.
- **T-rabies.** The words "rabies", "cat flu" and "enteritis" (and their Greek and French) appear in no public payload and no string in `lib/i18n.ts`. **Mutation probe:** add `vaccinated` to `serialiseCat` → red.
- **T-cache.** A v2 cache written in the shape today's build writes (no `coat`, no `markings`) is read by the new client and every cat renders with no appearance line. **And a guard for the future:** a test fails if `CATS_CACHE_KEY` changes while `catalogue.ts` has no read of the previous key as a fallback (the spec's rule for any later bump). **Mutation probe:** change the key to v3 → red.
- **T-words.** Every code in `COAT_COLOURS` and `MARKS` has a label in all three languages (the server lists are imported into the app test through the generated types, so a new code without a label fails); nothing renders a raw code; the existing parity test covers keys and placeholders.
- **T-no-health-words.** No public string contains "healthy", "sick", "diseased" or "unvaccinated" in any language (spec §9).
- **Browser check** at ~390 px and desktop, in `en`, `el` and `fr`, against a development database seeded with team statements on three cats (two colours plus marks; one colour; none).

**After deploy (Claude):** once `/api/healthz` shows the new commit, `curl` a described cat and an undescribed cat on production and check the two fields and the absence of everything else.

---

## Slice 3: the team

**In plain English.** On each cat's dashboard page, the team sees an Appearance section: the colour and markings the public sees, and every statement underneath (each spotter's suggestion, any machine reading, any team or guardian statement), who made it and when. They can confirm it in one tap, correct it, or mark one statement wrong. A small "Colour check" list in the top bar shows the cats worth a second look. The team can also record a vaccination and write private health notes on the cat. None of this is visible to the public.

### PR 3.1: Appearance and the Colour check list (spec §4.4, §5.3, §10.3)

- **Capabilities.** `set_appearance`, `set_vaccination`, `view_health_notes` and `add_health_note` are added to `CAPABILITIES`, granted to `staff` exactly as the existing twelve are today (spec §10.5). If SYC-53's PR 0.5 has merged first, the names are already in its catalogue and this step is a no-op; whichever merges second rebases. Only `set_appearance` is used by this PR.
- **Statements.** `capabilityFor()` maps `coat` and `markings` to `set_appearance`; `recordTeamStatement`'s `DIRECT_KINDS` gains them; `SUPERSEDE_CAPABILITIES` gains `set_appearance`. Three writes, one function each, called by both the form and JSON routes:
  - **Confirm**: the resolved value as a team statement with `agreesWith` the newest supporting row, no photo, reason fixed ("Looks right").
  - **Correct**: the whole new value (for markings, the whole list), with a required reason.
  - **Mark wrong**: `{ retracted: true }` superseding exactly one row, through `lockActiveObservation`, with a required reason.
- **Routes** (Origin, then session and `set_appearance`, then body, as PR #99 did): `POST /api/team/cats/:id/appearance/confirm`, `…/appearance/correct`, `POST /api/team/observations/:id/retract`. The chip pickers are plain checkboxes and radio buttons, no script (DECISIONS Part 2k).
- **The Appearance section** on the team cat page, next to "Correct the record", drawn from the snapshot and the raw rows.
- **The Colour check list.** `GET /api/team/colour-check` (HTML and JSON, like `/team/likely`), behind `set_appearance`: every cat with any `checkReasons`, plus the **hand-pick reason**: the cat chosen by hand is resolved to colours that share none with the spotter's own `coat` answer on that sighting (no spotter answer, no flag; no new model call). Main photo, newest first, Confirm and Correct on each row. A nav entry, "Colour check".
- **Language.** The dashboard is English today; if SYC-53's PR 1.0 has merged, the new strings go into its three-language catalogue.

**Tests.** A team member's Confirm writes one statement linked by `agreesWith` with no photo; Correct needs a reason; Mark wrong removes exactly one row from the count (re-using 1.2's probe); a non-holder gets refused at each route (today: anyone not `staff`); a second Mark wrong on the same row returns "already"; **form and JSON write identical rows**. Colour check: each reason puts a cat on the list and clearing it takes it off; a hand pick whose spotter said ginger on a cat resolved black is listed, and one with no spotter answer is not. **Mutation probe:** compare against the cat's machine reading instead of the spotter's answer → red. The existing route walk (`team.walk.test.ts`) gains the new routes. **Browser check** at ~390 px and desktop.

### PR 3.2: vaccinations and health notes on the cat (spec §6.3, §6.4)

- `capabilityFor()` maps `vaccinated` to `set_vaccination` and `team_note` to `add_health_note`; both join `DIRECT_KINDS`.
- **Vaccination** form on the team cat page (date, then rabies / cat flu and enteritis / another by name, no brand field), `POST /api/team/cats/:id/vaccinations`, behind `set_vaccination`. A wrong entry is corrected by the existing supersede route under `set_vaccination`. The page lists recorded vaccinations, newest first, with how long ago.
- **Health notes**: `POST /api/team/cats/:id/health-notes` behind `add_health_note`; shown on the cat page only to holders of `view_health_notes`, newest first, with author and date. The spotters' own "Anything you noticed?" notes stay where they are.
- **Welfare reports untouched.** The report note (`add_team_note`) stays on the report; a cat note never appears on a report and a report note never becomes a cat note.

**Tests (spec §10.6 "Vaccinated", "Health notes", "Welfare separation").** A vaccination with no vaccine refused; an `other` with no name refused; recorded dates show; nothing about vaccination in any public payload (T-rabies re-run); a `team_note` is readable only with `view_health_notes` (**mutation probe:** gate the read on `view_exact_location` → red); a `team_note` survives deletion of a welfare report on the same cat; a welfare report writes no `team_note`; **the "needs help" link still renders on the public page of a cat with a health note** (**mutation probe:** hide the link when any note exists → red). **Browser check.**

---

## Slice 4: spotters

**In plain English.** After the points for a new cat, a spotter sees one quiet line: *"Agatha looks Ginger · Tabby, right?"* (or, before the machine reads colours, *"This cat looks… Pick a colour"*), with Yes, Change and Skip. Skipping costs nothing. On the "add details" card for a cat they spotted in the last 30 days, they can be asked about the colour or the markings, beside their own photo, one question per sighting. Ticking a mark that could be an injury shows "Does it look hurt? Tell Syros Cats." The cat-alog gets a colour filter. Nothing is asked before the points, and nothing is saved for later when there's no signal: the line and the card only appear online.

### PR 4.1: the answers endpoint learns appearance (spec §5.1, §10.3)

- `AnswerSightingQuestionsBody` gains `coat` (`{ colours } | { notSure } | { cantTell }` plus `prefillAccepted: boolean`) and `markings` (`{ marks } | { nothingSpecial } | { cantTell }`, at most 4 marks).
- **Written as `public`**, `observedAt` the sighting's time, **`photoId` the sighting's photo** (so the different-photos rule has something to compare), `sightingId` set. `prefillAccepted` writes `provenance: prompted` with `suggestedValue` and `suggestionSource` (the reading it agreed with); anything else is `volunteered`. `black` + `white` is normalised before writing. `notSure` and `cantTell` are recorded and change nothing.
- **Under the existing (device, cat) lock**, re-checked inside it: one appearance question per sighting (a second answer for the same sighting is refused, `ALREADY_ANSWERED`); a device's later `markings` answer on another sighting **adds** a new row and supersedes nothing; a changed `coat` answer supersedes only that device's own row (1.1's check is the backstop).
- **Refused after the team has ruled** (`APPEARANCE_CHECKED`): a changed answer from a device that had already answered once an authority statement stands; a new `coat` answer once an authority colour stands. The app shows "Syros Cats have checked this one."
- **Refused** for a deceased or merged cat, outside the 30-day window, and for a sighting that isn't resolved (existing rules).
- **Rate limit (C3).** A per-device limiter on the answers route (same pattern as `rateLimit.ts`'s limiters), covering all answers.
- **Open sightings** gain `open.appearance: "coat" | "markings" | null`: colour if the cat's colour is not `confirmed`, else markings if it has none, else nothing; null once this sighting has an appearance answer.
- **The naming call carries no appearance data** (unchanged; a test asserts it).

**Tests.** A prompted Yes is stored `prompted` with its suggestion; a different answer `volunteered`; the photo id is the sighting's. **T-double-tap:** two concurrent writes from one device for one cat leave one voice. **Mutation probe:** drop the lock re-check → red. **T-checked:** a device's changed answer after a team statement is refused. **Mutation probe:** skip the check → red. Five marks refused; `nothingSpecial` from a device that ticked marks earlier withdraws nothing; the rate limiter returns 429 past its limit; the naming route rejects a `coat` field.

### PR 4.2: the colour line and the details card (spec §5.1, §8, §9)

- **`components/AppearanceQuestion.tsx`**, used in both places. Colour chips (swatch and word; pick one or two, or *Not sure*); marking chips (picture and word, at most 4; "Nothing special"; "Can't tell"). Whenever the marking chips show, the drawn *Torn or notched ear* sits beside `EAR_TIP_EXAMPLE_PHOTO` (Decision D, spec §3.3). Ticking any of *torn ear*, *kinked tail*, *short tail*, *missing eye*, *three legs* or *odd eyes* shows `NeedsHelpLink` with "Does it look hurt? Tell Syros Cats." Questions use the cat's name or "this cat", never a pronoun.
- **The result screen** (`app/review.tsx`): for a **new cat only**, one line after the points and badges, above the existing questions block: pre-filled from the cat's `coat` when it has one, else empty chips. Yes / Change / Skip; it does not come back on that screen. Sent with the same `answerSightingQuestions` call as the other answers.
- **The details card** (`MoreToAdd`): when a sighting's `open.appearance` is set, the sheet shows that one question **beside that sighting's own photo**. If the sighting's photo is hidden, the question is not offered for that sighting (there is nothing to compare against). Hidden offline, like the rest of the card (unchanged).
- **Never queued.** Nothing here touches the offline queue.
- **Pictures** (Decision D): nineteen small drawings in `assets/images/appearance/`, one file each.

**Tests.** The line renders only for a new cat and only after the points; Skip sends nothing; Yes on a pre-filled guess sends `prefillAccepted: true`. **T-hurt:** the "needs help" link renders whenever each of the six chips is ticked, and not for the other five. **Mutation probe:** drop one code from the list → red. The torn-ear picture renders beside the ear-tip photo whenever marking chips render. **T-offline:** with the app offline, neither the card nor the question renders. No question string contains a gendered pronoun in any language (a word-list test). **Browser check** at ~390 px and desktop in all three languages, with a seeded new-cat flow and a seeded open sighting.

### PR 4.3: the cat-alog's colour filter (spec §7.3, §8)

- Colour chips on the cat-alog, alongside All / Near me / Has a home: *All* by default, several colours allowed, cats with `coat: []` always shown under "Colour not known", and the "N more cats in other colours. Show all colours." line. Filtering runs over the cached catalogue, so it works offline. **No "Needs vet" filter, ever (SYC2-D7); no sterilised filter; no markings filter.**
- The chip component is shared so SYC-161's "Find the cat" chips reuse it (Decision A1).

**Tests.** "Colour not known" cats stay visible under any filter (**mutation probe:** filter them out → red); several colours combine; the filter works with the network off over a cached catalogue; a source test fails if a filter key named for health or sterilisation is added. **Browser check** in all three languages.

---

## Slice 5: guardians (after the roles work)

**In plain English.** A cat guardian, on her own cats' pages, sees the same Appearance section the team sees and can confirm, correct or mark wrong. What she says stands at once; it is not queued for anyone's OK, and the team sees it in their list of recent guardian changes. She can read and add the private health notes on cats in her colonies, including the notes spotters leave. She cannot record vaccinations, and she sees nothing of this for cats outside her colonies. Her Colour check list shows only her colonies' cats.

**Needs first, from the SYC-53 plan (names as in that plan on branch `claude/syc-53-plan`):**

| SYC-53 PR | What this slice uses from it |
|---|---|
| **0.2** one list of roles | `TEAM_ROLES` and `actingRole()`, so a guardian's statement is written with `roleAtTime: guardian` and a management member's with `management` |
| **0.5** the capability catalogue | The four names with the holders in roles spec §6.2 (guardians: `set_appearance`, `view_health_notes`, `add_health_note` placed on their colonies; never `set_vaccination`); strict `can()` with a target; targets from the record (a cat's colony is its newest colony statement) |
| **2.1** her cat pages | `GET /api/team/my/cats/:id` and `lib/guardianCatView.ts`, where her Appearance and health-note sections go |
| **2.2** what she says about a cat | `guardian` made reachable in `writeObservation`; the colony scope on her statements (`colony:<id>` if Decision B1); `listGuardianChanges()`, which lists every statement written as `guardian`, so her appearance statements appear in "Recent guardian changes" with no extra code |

The first **real** guardian also needs SYC-209's "create a colony" PR (SYC-53's Decision D). This slice can merge before that; it simply has nobody to serve.

### PR 5.1: a guardian's appearance and health notes (spec §4.3, §5.4, §6.4)

- **Routes** under `/api/team/my/cats/:id/…` (SYC-53's path rule for a person's own pages): `appearance/confirm`, `appearance/correct`, `observations/:obsId/retract`, `health-notes` (read and write). Each uses **the same functions as Slice 3**, behind `requireTeam(capability, catTarget)`, with the target looked up from the cat, never from the request.
- **The resolver** counts a `guardian` `coat` or `markings` statement with a colony scope as authoritative (spec §4.2 rule 1). Her authority is checked **when she writes**, by the route; the colony is kept on the statement for ever, as SYC-53 decided for sterilisation. A later move of the cat to another colony does not unwrite what she said.
- **Her cat page** (SYC-53's 2.1) gains the Appearance section and, **as a separate block behind `view_health_notes`, never through `guardianCatView`'s serialiser (C7)**, the cat's health notes and the spotters' "Anything you noticed?" notes on that cat.
- **Her Colour check list**: `GET /api/team/my/colour-check`, the same list filtered in the query to cats whose newest colony statement is one of hers.
- **Strings** in her language through SYC-53's PR 1.0 catalogue; Greek and French wait for Johnny (SYC-283) like the rest of her pages.

**Tests.** A guardian's correction on her own cat stands at once (`confirmed`) and appears in `listGuardianChanges()`; on a cat outside her colonies, every route refuses (the quiet 403) and her page shows the public view only. **Mutation probe:** take the colony from the request path → red. She is refused `set_vaccination` at the route and at `writeObservation`. **Mutation probe:** grant guardians `set_vaccination` in the catalogue → red (SYC-53's T24 also catches it). Health notes: readable on her cat, not on another colony's cat, never on her public view. **Mutation probe:** render the block for any guardian → red. A cat in no colony is touched only by island-wide holders. The SYC-53 route walk (T1) gains the new routes. **Browser check** at ~390 px and desktop with a seeded colony.

---

## Slice 6: donors

**In plain English.** Once Syros Cats have recorded vaccinations for at least five different cats this calendar year, the Help tab shows one sentence under the campaign: *"23 cats vaccinated this year"*. It counts each cat once, however many vaccines it had. It never names a cat, a colony or a vaccine. Below five, nothing is shown at all.

### PR 6.1: the vaccinated-this-year number (spec §6.3, Decision B)

- **`GET /api/stats/vaccinated`** → `{ year, count }`, with `count: null` below 5. The count is distinct canonical cats (a merged cat counts once, as its surviving cat) with at least one standing `vaccinated` observation whose `observedAt` falls in the current **Athens** calendar year. Superseded rows don't count. Deceased cats vaccinated this year still count (they were vaccinated). `Cache-Control: public, max-age=300`. No list, no dates, no colony, no vaccine.
- **The Help tab** shows the sentence when `count` is not null; a key in all three languages with a `{count}` placeholder (the number is always five or more, so the plural form is fixed).
- **Reports**: nothing built here. SYC-62 gets the requirement (one sentence, no breakdown by cat or colony) as a comment.

**Tests (spec §10.6).** Distinct cats: a cat vaccinated twice, or against two diseases, counts once; a cat with nothing recorded doesn't count; a vaccination dated 31 December last year (Athens) doesn't count and 1 January does (**mutation probe:** compare UTC years → red); 4 cats → `null`, 5 → 5 (**mutation probe:** threshold `> 5` → red); the response has exactly the keys `year` and `count`; a superseded entry doesn't count; T-rabies holds over the new endpoint and string. **Browser check** of the Help tab at ~390 px and desktop, with the count above and below five.

**After deploy (Claude):** `curl` the endpoint on production; with no vaccinations yet it must return `count: null`.

---

## Slice 7: the old care route (Decision C)

**In plain English.** Nobody notices. The old shared-password route can still mark a cat as desexed or homed until the dashboard replaces it (SYC-185), but it can no longer post a free-text note to a cat's public timeline, so no health or vaccination detail can reach the public or a follower's phone that way.

### PR 7.1: refuse `general` on `POST /cats/:catId/updates` (spec §6.4 rule 6)

- **Before writing code (Claude, read-only):** count `cat_updates` rows of type `general` created in the last 90 days on production, through db-ops. If any exist, stop and show Samuel what they were before going further.
- `CreateCatUpdateBody.updateType` becomes `desexed | adopted`; a `general` request gets a 422 with a plain message. The response enum keeps `general` and `sighting` so old timeline rows still read. No new `cat_update_type` value is added for vaccination, ever (spec §10.7).
- `threat_model.md` and the route's comment say why.

**Tests.** `general` is refused and writes no `cat_updates` row and sends no push (**mutation probe:** accept `general` again → red); `desexed` and `adopted` behave exactly as before (existing tests); a source test asserts no code path writes `vaccinated`, `team_note` or anything from `MARKS` into `cat_updates`.

**After deploy (Claude):** `curl` the route on production with the secret and `general` → 422; no timeline row appears.
