# SYC-2: coat, markings and health on cats

**Status: approved by Samuel, 12 October 2026, with every recommendation taken (Decisions A1, B1, C1, D1, E1). SYC-161 is scheduled as urgent so the spotter slice is not held up. Nothing is built yet.**
**Spec:** `docs/specs/coat-markings-and-health.md`, approved by Samuel on 12 October 2026 (PR #104, merged as `91b32be`). This plan builds it as written. Its decisions (SYC2-D1 to D10) are final and are not reopened here. Where the spec and the code on `main` disagree, "Where the spec and the code disagree" says so and either asks or names the fix.
**Builds on:** `cat-record-data-spine.md` (observations, the resolver, the public payload), `choose-a-different-cat.md` (§4.7 the colour list and filter, §8.4 the sentence SYC2-D10 narrows), `add-details-later.md` (the answers endpoint and the details card), `roles-and-invites.md` (the four capability names and the guardian role), `team-access-and-welfare-queue.md` (the dashboard and the welfare route), and `DECISIONS.md`. The format follows `syc-119-choose-a-different-cat.md`, `data-spine.md` and the SYC-53 plan (`syc-53-roles-and-invites.md`, PR #116).
**Linear:** SYC-2 (this plan). Touches SYC-161, SYC-5, SYC-52, SYC-53, SYC-209, SYC-152, SYC-185, SYC-1, SYC-62, SYC-283, SYC-244, SYC-243, SYC-242, SYC-241 and SYC-42.
**Checked against:** `origin/main` at `586763a` (12 October 2026); open PRs #101, #107, #111 and #117; the SYC-53 plan (PR #116, branch `claude/syc-53-plan` at `fd766c5`, with its adversarial review `syc-53-roles-and-invites-review.md`); the SYC-209 plan (PR #118, branch `claude/syc-209-plan` at `dcaa71c`); and Linear SYC-2 with all five of its comments, plus the tickets above. Every "exists today" claim names the file it was read in.

**Amended 16 October 2026 (SYC-398, `docs/specs/coat-colours-and-pattern.md`).** A coat is now any of five colours plus one pattern. PR 3.1's Appearance section and Colour check list, and PRs 4.1 to 4.3 (the answers endpoint, the details card, the cat-alog filter), are amended where marked below. Wherever a bullet says "one or two colours", the eight codes, or chips with *Not sure*, read the spec's version.

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
| **Slice 4: spotters** (after SYC-161, Decision A) | Spotters confirm or correct colours after their points and on the details card. The cat-alog gets its colour filter |
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

**None. The spec's claim holds.** Every column the new kinds need is free text or `jsonb`, so new kinds, a new authority-scope shape and the `guardian` and `management` roles need code changes only. Colour, markings, vaccinations and notes are observations; the Colour check list, the hand-pick flag and the donor count are queries over observations and `sighting_matches`. If a slice ever finds it needs a migration, it takes the next free number when it is generated after rebasing on the latest `main` (SYC-53's and SYC-209's plans both add migrations, expected from `0015`), never a number chosen by hand.

---

## Where the spec and the code disagree

| # | The spec says | The code on `main` says | What this plan does |
|---|---|---|---|
| **C1** | §14: Slice 1 needs SYC-161 for the machine's colour. §7.2: the colour filter in "Find the cat" sits on the resolved colour | **No machine reading and no colour filter exist.** Both are SYC-119's Slice C (SYC-161), not yet built. That slice also planned a `coat` payload field, a "people always win" rule and a cache-key bump, all three of which the SYC-2 spec replaced | **Decision A** |
| **C2** | §4.2, §10.2: a statement only replaces the same device's own statement, with a test | `writeObservation` does not check whose row is superseded | Slice 1 adds the check in `writeObservation` itself for public rows of `coat` and `markings`, and the resolver ignores any cross-device supersession it finds anyway |
| **C3** | §10.3: the spotter write is "per-device rate limited" | The answers route has no rate limiter | Slice 4 adds a per-device limiter to the answers route, covering the existing answers too |
| **C4** | §10.1 (`coat-markings-and-health.md:420`): a guardian's statement carries `authorityScope: guardian_of_this_cat` | The SYC-53 plan's Decision B recommends `colony:<id>` for every guardian statement, and keeps `guardian_of_this_cat` for "This is my cat" (SYC-130) | Slice 5 uses whatever Samuel decides for SYC-53's Decision B. **Who edits the SYC-2 spec's line:** if Samuel has decided B before D-SYC2 merges, D-SYC2 makes the edit (spec §10.1 and the data spine's appended block); otherwise SYC-53's docs PR (its D1, or the D5 its review proposes) does. D-SYC2 adds a pointer sentence either way. Agreed by comment on PR #116 |
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

**Decided (Samuel, 12 October 2026): option A1, as recommended.**

**The question.** Two pieces of approved work both touch "a cat's colour". The auto-colour work (SYC-161, Slice C of the approved SYC-119 plan) reads each cat's colour from its main photo and adds the colour chips to "Find the cat". This plan adds people's colours, the rules for which answer wins, and the colour on the cat's page. The SYC-2 spec assumed the machine readings would already exist. They don't, and SYC-119's plan for Slice C still describes the older rule ("people always win"), a second colour field and a cache-key change that would empty phones' offline catalogues. Somebody has to go first.

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **A1. This plan's rules, public line and team screens first; then SYC-161; spotters' questions after SYC-161 (recommended)** | Slices 1–3 build the colour rules, put `coat` and `markings` on every cat and give the team their screens. SYC-161 then adds the machine reading, the backfill and the "Find the cat" chips on top. Slice 4 (spotters) waits until SYC-161 is live, as the spec's §14 order intended | One set of rules and one field, built once by the work that owns them. No cache-key change ever ships. The team can describe cats straight away. Spotters get the spec's one-tap "Ginger · Tabby, right?" from their first day, never an empty question | Slice 4 waits on SYC-161, which is not yet scheduled; if SYC-161 slips, spotters can't contribute until it lands | Colours appear first for cats the team describes, then for every cat once the machine reads them, then spotters confirm or correct |
| A2. As A1, but spotters' questions ship without waiting for SYC-161 | Slice 4 ships as soon as the team slice is live | Spotters contribute sooner | Until SYC-161, the line after the points asks with empty chips instead of a one-tap Yes. Every public colour on an undescribed cat is one spotter's tap (rule 4 fills the gap), and none of those cats reach the Colour check list, because "spotters over the machine" needs a machine reading. When SYC-161 lands, the machine's reading outranks those single taps (rule 3), so many cats' public colours change at once, as the rules say they should | A question after the reward that needs several taps; then a wave of colour changes when the machine arrives |
| A3. SYC-161 goes first | Build SYC-119's Slice C (reader, backfill, chips), corrected to the SYC-2 rules, then this plan | Every cat has a colour from day one of this plan | SYC-161 has to build the colour rules itself, or ship an interim rule this plan then replaces. Both plans edit the same resolver function and payload field, so work is done twice | Colours for every cat first; people's corrections follow |
| A4. Fold SYC-161 into this plan as a slice | This plan owns the reader and the chips too | One plan, one owner | SYC-119's approved plan loses a slice it already sequenced, and this plan grows by a model-calling background job with its own cost cap | The same as A1, in one stream of work |

**Recommendation: A1.** The rules for which colour wins are this spec's, so building them before anything writes machine readings means nothing is ever shown under the wrong rule, and holding the spotter questions until the machine has read colours keeps the spec's intended experience (a one-tap "right?") and its §14 order for spotters. The cost is time: spotters' questions wait for SYC-161, which Samuel has made urgent so the wait is short. A comment on SYC-161 tells its builder to reuse `resolveCoat` and the `coat` field, drop the cache bump, and import `COAT_COLOURS`.

### Decision B: where the "N cats vaccinated this year" number goes before the donations work exists

**Decided (Samuel, 12 October 2026): option B1, as recommended.**

**The question.** The spec puts the number "on the donate screen" (SYC-1) and in the charity's reports (SYC-62). Neither exists yet. The Help tab already shows the campaign and the donate buttons.

| Option | Benefits | Risks | What donors notice |
|---|---|---|---|
| **B1. Build the number now and show it on the Help tab, under the campaign (recommended)** | Donors see what vaccines achieved as soon as five cats are counted. One quiet sentence, no new screen. SYC-1 and SYC-62 reuse the same endpoint later | The Help tab is not yet a "donate screen" in the spec's sense; if SYC-1 redesigns it, the sentence moves with it | "23 cats vaccinated this year" under the campaign |
| B2. Build the endpoint now, show it nowhere until SYC-1 | Nothing on screen changes until the donations work is designed | The number is computed and never seen; donors who fund vaccines see nothing for months | Nothing |
| B3. Wait for SYC-1 and SYC-62 entirely | Nothing built early | The slice sits unbuilt with nothing blocking it | Nothing |

**Recommendation: B1.** The rules (distinct cats, this calendar year, nothing below five, number and year only) are fixed by the spec and don't depend on where the sentence sits. The reports half waits for SYC-62, which gets a requirement comment.

### Decision C: closing the old care route to free-text notes

**Decided (Samuel, 12 October 2026): option C1, as recommended.**

**The question.** The old shared-password route (`POST /cats/:catId/updates`) can post a free-text `general` note onto a cat's **public** care timeline and push it to followers. The spec says no health or vaccination detail may ever go that way, and that `general` is retired "when the route is retired, or sooner". The whole route's retirement is already its own ticket (SYC-185), waiting until staff can record sterilisation and adoption on the dashboard. Software can't tell a health note from any other free text, so the only real guard is to stop accepting `general`.

| Option | Benefits | Risks | Who notices |
|---|---|---|---|
| **C1. Refuse `general` now; keep `desexed` and `adopted` until SYC-185 (recommended)** | Closes the only path by which a health detail could reach the public timeline and a push. The route keeps its insurance value for the two structured types. One small PR | Anyone still using the route for a free-text note loses it. Before merging, Claude checks the production timeline for any `general` row in the last 90 days; if there is one, the PR stops and asks Samuel | Nobody, if the check finds no recent use |
| C2. Retire the whole route now (SYC-185) | Simplest end state | Removes the insurance the team-access decisions deliberately kept until the dashboard does sterilisation and adoption everywhere; that is SYC-185's call, not this plan's | Whoever holds the shared secret |
| C3. Leave the route alone; rely on the written rule and SYC-185 | No code | The rule depends on whoever holds the password remembering it; one note about a sick cat goes to every follower's phone | Nobody, until it goes wrong |

**Recommendation: C1.** Old app builds already show an unknown timeline type as a plain message, so nothing on phones breaks.

### Decision D: the pictures on the colour and marking chips

**Decided (Samuel, 12 October 2026): option D1, as recommended.**

**The question.** The spec gives every chip "a small picture and the word", and requires a picture of *Torn or notched ear* beside Syros Cats' ear-tip photo, so nobody confuses the two. Nineteen pictures are needed (eight colours, eleven markings).

| Option | Benefits | Risks | What people notice |
|---|---|---|---|
| **D1. Simple drawn pictures, one consistent set made by Claude as part of Slice 4, reviewed by Samuel in the browser check (recommended)** | Consistent, clear at chip size, no rights to clear, ready when the code is. Colours can be plain swatches (as `choose-a-different-cat.md` §4.7 already says) | Drawings are less vivid than photos; *colourpoint* and *odd eyes* need care to read at 40 px | Clean, matching little drawings on every chip |
| D2. Real photos from Syros Cats, as for the ear tip (SYC-79) | True to life | Nineteen good, consistent photos is a lot to ask a volunteer team; it blocks Slice 4 on their time | Real cats on the chips, if the photos come |
| D3. Words only, no pictures | Nothing to draw | Breaks the spec (§9) and works worse for tourists reading another language | Words only; harder for visitors in another language |

**Recommendation: D1**, with the torn ear drawn and shown beside the real ear-tip photo. If Syros Cats later send photos, swapping a picture is a one-file change.

### Decision E: how two colours are written on the cat's page

**Decided (Samuel, 12 October 2026): option E1, as recommended.**

**The question.** English reads naturally as "Ginger tabby". Greek and French make colour words agree with the noun and often change their order, so a sentence-builder for every pair is a grammar engine in three languages.

| Option | Benefits | Risks | What people notice |
|---|---|---|---|
| **E1. Join with a dot in every language: "Ginger · Tabby · White paws" (recommended)** | No grammar to get wrong; the same shape in all three languages; matches the chips | Slightly less natural than "Ginger tabby" in English | "Ginger · Tabby · White paws", the same in every language |
| E2. Natural phrases, written out for each of the colour pairs in each language | Reads naturally | About twenty pairs × 3 languages, each needing Johnny's check (SYC-283); easy to get subtly wrong | "Ginger tabby", or its natural Greek and French |

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
| **Slice 3: the team** | 3.1 Appearance and the Colour check list · 3.2 vaccinations and health notes | 2.1 (both: its leak tests must exist before any vaccination or note is stored) | The team |
| **Slice 4: spotters** | 4.1 the answers endpoint learns appearance · 4.2 the colour line after the points and the details card · 4.3 the cat-alog's colour filter | 3.1 live; SYC-161 live (Decision A1) | Spotters |
| **Slice 5: guardians** | 5.1 a guardian's appearance and health notes | 3.1, 3.2, and SYC-53's PRs 0.2, 0.5, 2.1 and 2.2 | Guardians and the team |
| **Slice 6: donors** | 6.1 the vaccinated-this-year number | 2.1, 3.2 | Donors |
| **Slice 7: the old care route** | 7.1 refuse `general` (Decision C) | Nothing in this plan; can go any time after the docs | Nobody |

Slices 3.2, 6 and 7 do not depend on the colour rules and can be built in parallel with Slices 3.1 and 4 once their own "needs first" are merged. **Nothing that stores a vaccination or a note, or adds a public endpoint, merges before 2.1**, because 2.1 carries the named-field leak test and the "rabies" test. SYC-161 (the machine reading and the "Find the cat" chips) slots in after 2.1 (Decision A1), and needs nothing from Slices 3–7.

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
| `docs/superpowers/plans/syc-119-choose-a-different-cat.md` Slice C | A note (Decision A1) that the colour rules, the `coat` payload field and the chip component come from SYC-2, that "people beat the machine" is narrowed (SYC2-D10), and that the cache key is not bumped |
| `coat-markings-and-health.md` | Only if Samuel's answers change something it says (Decision A narrows §14's dependency on SYC-161 to the spotter slice; Decision E fixes §5.2's example) |

**Collisions, and how they are avoided.**
- **The SYC-53 docs PRs** D1 (`cat-record-data-spine.md` §6.5, §4.2, §10.1 vocabulary, §10.5, §4.5, §3.2, §6.7) and D3 (`DECISIONS.md`, a new Part 2n). D-SYC2 touches §10.1 only by **appending its own paragraph** after the existing kinds comment, and does not touch the role vocabulary lines D1 rewrites. Its `DECISIONS.md` Part takes the next free letter when it merges, never a letter chosen in advance.
- **The SYC-209 plan** (PR #118) amends §10.5 and §6.7 (and `team-access-and-welfare-queue.md` §3.2). D-SYC2 touches none of them. The two sessions agreed by message on 12 October to keep two docs PRs in disjoint sections; whichever merges second rebases. If the SYC-209 session prefers one combined docs PR, that changes only who opens it.
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
  - `{ retracted: true }` is refused from `public`, refused unless `supersedesId` is set, and **refused unless the row it supersedes is the same kind and that kind is `coat` or `markings`**, for every role. A retraction can never remove a `sterilised`, `vaccinated`, `team_note` or any other row.
- **One normaliser, used by every writer.** `normaliseColours()` turns `black` + `white` into `black_and_white`; the answers route (4.1) and the team and guardian statement functions (3.1, 5.1) all call it, so a team Correct with both ticked is stored silently, as spec §4.2 says. The validator's refusal of the raw pair is only the backstop.
- **Who may write which kind**, enforced in `writeObservation`, not left to callers: `coat` and `markings` from `public`, `staff`, `management` and (once SYC-53's PR 2.2 makes it reachable) `guardian`; `vaccinated` refused from `public`, `guardian` and `system` (the import exception is added when `records-import.md` is built, not now); `team_note` refused from `public` and `system`. `vet` is refused for `coat` and `markings`. `management` and `guardian` stay unreachable here until SYC-53's PRs 0.2 and 2.2 add them to `REACHABLE_ROLES`; this PR writes the rules against the role names so those PRs only flip reachability.
- **A device only supersedes its own row (C2).** For `public` writes of `coat` and `markings`, `writeObservation` refuses a `supersedesId` that points at a row with a different `deviceId` or a different kind (`NOT_YOUR_ROW`). Team supersessions are unchanged (they go through `lockActiveObservation`).
- **Not evidence of life.** The four kinds are added to the resolver's named exclusion comment, and a test asserts none of them moves `lastSeenAt` or life status.
- **No route writes any of these yet.** The answers route, the team routes and the guardian routes come in Slices 3–5.

**Tests.** Every validator branch, including: a person's `coat` with `modelVersion` refused, a machine `coat` without it refused; `black` + `white` refused; five marks from `public` refused, five from `staff` accepted; `[]` accepted; `vaccinated` from `public` and `guardian` refused; an `other` vaccine with no name refused; `team_note` from `public` refused; `{ retracted: true }` from `public` refused. **T-own-row:** device A's write superseding device B's `coat` row is refused. **Mutation probe:** delete the device comparison → red. **T-retract-kind:** a staff `{ retracted: true }` pointing at a `sterilised`, `vaccinated` or `team_note` row is refused. **Mutation probe:** drop the kind check → red. **T-life:** a cat whose only recent rows are the four new kinds keeps its old `lastSeenAt` and life status. **Mutation probe:** add `markings` to the evidence list → red.

### PR 1.2: the resolver (spec §4.2, §10.2)

Three pure functions in `resolve.ts`, added to `CatSnapshot` (which stays a team-side structure; the public payload copies out only the value in PR 2.1):

- **`resolveCoat(rows, machineRows)`** → `Resolved<CoatColour[]>` plus `checkReasons`. The five rules of spec §4.2 in order: authority (newest by `observedAt`) → two voices per colour → the machine's reading → the newest single spotter filling a gap → not sure.
- **`resolveMarkings(rows)`** → `Resolved<Mark[]>` plus `checkReasons`. Authority is the whole list; marks with two voices dated after the standing authority statement (Decision G) are added and flagged; otherwise two voices per mark; spotters only add; `cantTell` and a later `[]` from a device that had ticked marks withdraw nothing.
- **`resolveVaccinated(rows)`** → the dates and vaccines the team recorded, newest first, or nothing. No negative state. Team-only.
- **One shared voice-counting helper** used by both: tidy (drop superseded, retracted and empty answers; normalise `black` + `white`); one voice per `deviceId` (newest row wins; a redacted row is a voice of its own); a cross-device supersession found in the data is ignored, so the row it pointed at still counts; two voices only count as two with **different `photoId`s and different Athens calendar days** (`Europe/Athens`, not UTC); `prompted` rows never count towards two.
- **Authority follows Decision G** (Samuel, 13 October 2026; the SYC-53 plan's `authorityLevel`, built in its PR 0.2): the highest level present wins, then the newest at that level. For colour and markings **a cat guardian (level 2) outranks the team (level 1)**, and **vets, imported records and owners count for nothing** (an appearance carve-out wrapped around `authorityLevel`). `resolveCoat` and `resolveMarkings` take the ranking as a parameter: until SYC-53's PR 0.2 merges, a team-only ranking (staff, and `admin`/`management`) is passed; whichever of 1.2 and 0.2 merges second wires in `authorityLevel` with the carve-out. Guardian rows are inert until SYC-53's PR 2.2 makes `guardian` reachable. A team or guardian Confirm (`agreesWith`, no photo) is an authority statement with the same value.
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
| A `vet`, `import` or owner row on coat or markings counts for nothing | Use `authorityLevel` without the appearance carve-out → red |
| A guardian's older statement beats the team's newer one; the newest wins within a level | Rank guardian and team equally → red |
| Two camps (two for ginger, two for black, nobody named both) → the newer camp, with `tied_camps` | Return both colours → red |
| *Ginger · Tabby* and *Ginger* agree on *Ginger*; *Tabby* not shown | Compare whole sets → red |
| Spotters only add: an omission, a later `[]` and `cantTell` remove nothing | Let a device's newest row replace its marks → red |
| Marking one of three spotters' marks wrong leaves the other two | Retract by kind instead of by row → red |
| Two voices dated after the standing team or guardian list show the mark and set `markings_reopened` | Ignore marks once an authority list exists → red |
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
- **T-rabies.** The words "rabies", "cat flu" and "enteritis" (and their Greek and French) appear in no public payload, no string in `lib/i18n.ts`, and nothing in the generated client (`lib/api-client-react`, `lib/api-zod`). **Mutation probe:** add `vaccinated` to `serialiseCat` → red.
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
  - **Confirm**: the known parts of the resolved coat as a team statement (SYC-398: a part not known is left not stated, and Confirm is not offered when neither part is known) with `agreesWith` the newest supporting row, no photo, reason fixed ("Looks right").
  - **Correct**: the whole new value (for markings, the whole list), with a required reason. **On a cat whose answer is a guardian's statement, Correct overrules her** (Decision G, Samuel 13 October 2026): in one transaction it marks wrong **every** guardian statement of that kind that stands on the cat, not just the newest (`{ retracted: true }`, through `supersedeStatement`), then writes the team's value, and the overrule appears on the recent guardian changes list. Without this, a team Correct would be outranked and change nothing on the page. Correct is a form (SYC-398): five colour checkboxes with swatches and pattern radio buttons including *Not stated*, with no *Not sure* (Samuel, 14 October 2026; `writeObservation` refuses a team or guardian `{ notSure: true }` coat), so Mark wrong is the one way to undo a coat. A statement states colours, a pattern or both; a part left blank is not stated and falls to the next rule.
  - **Mark wrong**: `{ retracted: true }` superseding exactly one row (a whole statement, both parts), through the existing `supersedeStatement` and `lockActiveObservation`, with a required reason.
- **Routes** (Origin, then session and `set_appearance`, then body, as PR #99 did): `POST /api/team/cats/:id/appearance/confirm` and `…/appearance/correct`. **Mark wrong reuses the existing `POST /api/team/statements/:id/wrong`** (`routes/teamCorrections.ts:324`) and `supersedeStatement`: for a `coat` or `markings` row it writes `{ retracted: true }` instead of today's supersede value, and its capability pre-gate gains `set_appearance`. No second "mark wrong" route. The chip pickers are plain checkboxes and radio buttons, no script (DECISIONS Part 2k).
- **The Appearance section** on the team cat page, next to "Correct the record", drawn from the snapshot and the raw rows. A standing guardian statement that contradicts a team statement shows as a visible disagreement, with *Correct* to overrule it (as the SYC-53 plan does for sterilisation).
- **The Colour check list.** `GET /api/team/colour-check` (HTML and JSON, like `/team/likely`), behind `set_appearance`: every cat with any `checkReasons` (now including "spotters disagree on the pattern" and "colour and pattern from different sources"), plus the **hand-pick reason**: the spotter's own answer on that sighting, read through the translation, shares no colour with the cat's resolved colours, or both patterns are known and differ (no spotter answer, no flag; no new model call). Main photo, newest first, Confirm and Correct on each row. A nav entry, "Colour check". **To keep it "a few minutes a week"** (spec §5.3), the page lists cats with any reason other than `no_authority` first, and puts the `no_authority` cats (colour only the machine's, or not known, and never described) in one collapsed group at the bottom with its count ("Not yet described by the team: 214 cats"). Before SYC-161 that group is most of the cat-alog; it is still listed, as the spec says, but never in the way of the cases that matter. A cat whose only gap is a pattern nobody has said is not in this group on its own (Samuel, 16 October 2026: once someone has said a colour, it stands until corrected).
- **Language.** The dashboard is English today; if SYC-53's PR 1.0 has merged, the new strings go into its three-language catalogue.

**Tests.** A team member's Confirm writes one statement linked by `agreesWith` with no photo; Correct needs a reason; Mark wrong removes exactly one row from the count (re-using 1.2's probe); a non-holder gets refused at each route (today: anyone not `staff`); a second Mark wrong on the same row returns "already"; **form and JSON write identical rows**. **T-overrule:** a team Correct on a guardian-described cat changes the public answer and writes one retraction per standing guardian row plus one statement, in one transaction; the cases include two guardians' standing rows, and one guardian's Confirm and Correct both standing. The guardian rows are seeded directly (`guardian` is not reachable in `writeObservation` until SYC-53's PR 2.2); the "shows on the recent guardian changes list" assertion lands with PR 5.1 or SYC-53's PR 2.2, whichever merges second. **Mutation probes:** skip the retraction → the public answer stays the guardian's → red; retract only the newest guardian row → red. Colour check: each reason puts a cat on the list and clearing it takes it off; `no_authority` cats sit in the collapsed group and never above a cat with another reason; a hand pick whose spotter said ginger on a cat resolved black is listed, and one with no spotter answer is not. **Mutation probe:** compare against the cat's machine reading instead of the spotter's answer → red. The existing route walk (`team.walk.test.ts`) gains the new routes. **Browser check** at ~390 px and desktop.

### PR 3.2: vaccinations and health notes on the cat (spec §6.3, §6.4)

- `capabilityFor()` maps `vaccinated` to `set_vaccination` and `team_note` to `add_health_note`; both join `DIRECT_KINDS`.
- **Vaccination** form on the team cat page (date, then rabies / cat flu and enteritis / another by name, no brand field), `POST /api/team/cats/:id/vaccinations`, behind `set_vaccination`. A wrong entry is corrected by the existing supersede route under `set_vaccination`. The page lists recorded vaccinations, newest first, with how long ago.
- **Health notes**: `POST /api/team/cats/:id/health-notes` behind `add_health_note`; shown on the cat page only to holders of `view_health_notes`, newest first, with author and date. The spotters' own "Anything you noticed?" notes stay where they are.
- **Not in the public API description.** The team routes are server-drawn forms; nothing about vaccination is added to `lib/api-spec/openapi.yaml`, so the generated public client never carries a vaccine name (T-rabies scans the generated client too).
- **Welfare reports untouched.** The report note (`add_team_note`) stays on the report; a cat note never appears on a report and a report note never becomes a cat note.

**Tests (spec §10.6 "Vaccinated", "Health notes", "Welfare separation").** A vaccination with no vaccine refused; an `other` with no name refused; recorded dates show; nothing about vaccination in any public payload (T-rabies re-run); a `team_note` is readable only with `view_health_notes` (**mutation probe:** gate the read on `view_exact_location` → red); a `team_note` survives deletion of a welfare report on the same cat; a welfare report writes no `team_note`; **the "needs help" link still renders on the public page of a cat with a health note** (**mutation probe:** hide the link when any note exists → red). **Browser check.**

---

## Slice 4: spotters

**In plain English.** After the points for a new cat, a spotter sees one quiet line: *"Agatha looks Ginger · Tabby, right?"* (or, when the machine couldn't tell, *"This cat looks… Pick a colour"*), with Yes, Change and Skip. Skipping costs nothing. On the "add details" card for a cat they spotted in the last 30 days, they can be asked about the colour or the markings, beside their own photo, one question per sighting. Ticking a mark that could be an injury shows "Does it look hurt? Tell Syros Cats." The cat-alog gets a colour filter. Nothing is asked before the points, and nothing is saved for later when there's no signal: the line and the card only appear online.

### PR 4.1: the answers endpoint learns appearance (spec §5.1, §10.3)

- `AnswerSightingQuestionsBody` gains `coat` (`{ colours, pattern? } | { notSure: true }` plus `prefillAccepted: boolean`; a pattern *Can't tell* is sent as no pattern; SYC-398) and `markings` (`{ marks } | { nothingSpecial } | { cantTell }`, at most 4 marks).
- **Written as `public`**, `observedAt` the sighting's time, **`photoId` the sighting's photo** (so the different-photos rule has something to compare), `sightingId` set. `prefillAccepted` writes `provenance: prompted` with `suggestedValue` and `suggestionSource` (the reading it agreed with); anything else is `volunteered`. Colours are written as tapped, with no normalising (Black and White are two colours). A colour `notSure` is recorded and withdraws that device's earlier answer, both parts; a markings `cantTell` is recorded and changes nothing.
- **Under the existing (device, cat) lock**, re-checked inside it: one appearance question per sighting (a second answer for the same sighting is refused, `ALREADY_ANSWERED`); a device's later `markings` answer on another sighting **adds** a new row and supersedes nothing; a changed `coat` answer supersedes only that device's own row (1.1's check is the backstop).
- **Refused after the team has ruled** (`APPEARANCE_CHECKED`): a changed answer from a device that had already answered once an authority statement stands; a new `coat` answer once an authority colour stands. The app shows "Syros Cats have checked this one."
- **An appearance refusal never loses the other answers.** Appearance is judged on its own: when it is refused (`APPEARANCE_CHECKED` or `ALREADY_ANSWERED` for appearance), the ear tip, food and water and note in the same request are still written, and the 200 response says `appearance: "checked" | "already" | "saved"`. Only a refusal of the whole request (device, window, unresolved sighting) fails it, as today.
- **Refused** for a deceased or merged cat, outside the 30-day window, and for a sighting that isn't resolved (existing rules).
- **Rate limit (C3).** A per-device limiter on the answers route (same pattern as `rateLimit.ts`'s limiters), covering all answers.
- **Open sightings** gain `open.appearance: "coat" | "markings" | null`: colour if the cat's colour is not `confirmed`, else markings if it has none, else nothing; null once this sighting has an appearance answer.
- **The naming call carries no appearance data** (unchanged; a test asserts it).

**Tests.** A prompted Yes is stored `prompted` with its suggestion; a different answer `volunteered`; the photo id is the sighting's. **T-double-tap:** two concurrent writes from one device for one cat leave one voice. **Mutation probe:** drop the lock re-check → red. **T-checked:** a device's changed answer after a team statement is refused. **Mutation probe:** skip the check → red. **T-partial:** an appearance answer refused as `checked`, sent with an ear-tip answer, still stores the ear tip and returns `appearance: "checked"`. **Mutation probe:** throw on the appearance refusal → red. Five marks refused; `nothingSpecial` from a device that ticked marks earlier withdraws nothing; the rate limiter returns 429 past its limit; the naming route rejects a `coat` field.

### PR 4.2: the colour line and the details card (spec §5.1, §8, §9)

- **`components/AppearanceQuestion.tsx`**, used in both places. Colour swatches (drawn, with the word; tap every colour you can see), pattern pictures (*Plain · Stripes · Patches* and *Can't tell*), *Not sure*, and the drawn cat that redraws with each tap (`coat-colours-and-pattern.md` §3); marking chips (picture and word, at most 4; "Nothing special"; "Can't tell"). Whenever the marking chips show, the drawn *Torn or notched ear* sits beside `EAR_TIP_EXAMPLE_PHOTO` (Decision D, spec §3.3). Ticking any of *torn ear*, *kinked tail*, *short tail*, *missing eye*, *three legs* or *odd eyes* shows `NeedsHelpLink` with "Does it look hurt? Tell Syros Cats." Questions use the cat's name or "this cat", never a pronoun.
- **The result screen** (`app/review.tsx`): for a **new cat only**, one line after the points and badges, above the existing questions block: pre-filled from the cat's `coatColours` and `coatPattern` when it has them (the line asks for the pattern alone if only the colours are known), else empty chips. Yes / Change / Skip; it does not come back on that screen. Sent with the same `answerSightingQuestions` call as the other answers.
- **The details card** (`MoreToAdd`): when a sighting's `open.appearance` is set, the sheet shows that one question **beside that sighting's own photo**. If the sighting's photo is hidden, the question is not offered for that sighting (there is nothing to compare against). Hidden offline, like the rest of the card (unchanged).
- **Never queued.** Nothing here touches the offline queue.
- **Pictures** (Decision D): small drawings in `assets/images/appearance/`, one file each: the five colour swatches, the three patterns, the markings, and the drawn cat (SYC-398; Samuel judges them in the browser check).

**Tests.** The line renders only for a new cat and only after the points; Skip sends nothing; Yes on a pre-filled guess sends `prefillAccepted: true`. **T-hurt:** the "needs help" link renders whenever each of the six chips is ticked, and not for the other five. **Mutation probe:** drop one code from the list → red. The torn-ear picture renders beside the ear-tip photo whenever marking chips render. **T-offline:** with the app offline, neither the card nor the question renders. No question string contains a gendered pronoun in any language (a word-list test). **Browser check** at ~390 px and desktop in all three languages, with a seeded new-cat flow and a seeded open sighting.

### PR 4.3: the cat-alog's colour filter (spec §7.3, §8)

- Two rows of colour and pattern chips on the cat-alog, alongside All / Near me / Has a home (`coat-colours-and-pattern.md` §5): *All* by default in each row, any chip counts within a row, cats whose part is not known (`coatColours: []`, `coatPattern: null`, or a cached copy without the fields) always shown under "Not known", and the "N more cats in other colours or patterns. Show all." line. Filtering runs over the cached catalogue, so it works offline. **No "Needs vet" filter, ever (SYC2-D7); no sterilised filter; no markings filter.**
- The chip component is shared so SYC-161's "Find the cat" chips reuse it (Decision A1).

**Tests.** "Not known" cats stay visible under any filter (**mutation probe:** filter them out → red); several colours combine; the filter works with the network off over a cached catalogue; a source test fails if a filter key named for health or sterilisation is added. **Browser check** in all three languages.

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

- **Routes** under `/api/team/my/cats/:id/…` (SYC-53's path rule for a person's own pages): `appearance/confirm`, `appearance/correct`, `statements/:obsId/wrong`, `health-notes` (read and write). Each uses **the same functions as Slice 3**, behind `requireTeam(capability, catTarget)`, with the target looked up from the cat, never from the request.
- **The resolver rule is already in PR 1.2** (Decision G: a guardian's statement outranks the team's; the newest wins within a level); it does nothing until `guardian` is reachable in `writeObservation`. This PR only adds the routes and screens. The server sets `observedAt` on every guardian route and ignores any `observedAt` the client sends (the SYC-53 plan's rule). A guardian's statement that contradicts a standing team statement is marked as contradicting on the recent guardian changes list.
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

---

## Where each of the spec's tests is built

Spec §10.6, line by line.

| Spec test group | PR | | Spec test group | PR |
|---|---|---|---|---|
| Colour: the five rules, ties, camps, normalising, voices, photos, days, prompted, machine order | 1.2 | | Health notes: refused from public, never public, read gate, survives report deletion | 1.1 (write), 3.2 (read), 5.1 (guardian) |
| Colour: one device once at read time; device superseding another refused | 1.2 (read), 1.1 (write) | | Privacy: no note, report, confidence or author in any public payload, by name | 2.1 (T-leak) |
| Colour: two concurrent writes from one device leave one voice | 4.1 | | Welfare separation: the "needs help" link survives a note; reports write no condition | 3.2 |
| Colour: guardian statement stands; team confirmation is a team statement | 5.1, 3.1 | | Welfare separation: "Does it look hurt?" on each of the six chips | 4.2 (T-hurt) |
| Markings: all of §10.6's list | 1.2 | | Old care route: nothing about health or vaccination in `cat_updates` | 7.1 |
| Retraction: removes only its target; refused from a spotter | 1.1, 1.2, 3.1 | | Cache: a v2 cache read by the new client, no key change | 2.1 (T-cache) |
| Vaccinated: refused from public and guardian; no negative; not evidence of life; `other` needs a name | 1.1, 1.2 | | Languages: every label in three languages; no raw code; no gendered pronoun | 2.1, 4.2 |
| Vaccinated: absent from every public payload; "rabies", "cat flu", "enteritis" in no public string | 2.1 (T-rabies), re-run in 3.2 and 6.1 | | Offline: the colour filter on a cached catalogue; the question never offline | 4.3, 4.2 |
| Vaccinated: the donor count rules | 6.1 | | Browser check at ~390 px and desktop, three languages | every UI PR |

---

## Every place the rules must hold

A mutation probe only proves a test guards a place someone already thought of. These are **all** the readers of the two invariants, enumerated so each PR's reviewer can hunt for one that isn't listed.

**Invariant 1: vaccinations and health notes never reach the public.** Every reader that could carry a cat's fields outside the team:
1. `serialiseCat` and every route that calls it: `GET /cats`, `GET /cats/:id`, the paged catalogue the app caches (PR 2.1, T-leak).
2. The sighting result returned to the review screen, and the open-sightings response (PR 4.1: a test that neither carries `vaccinated` or `team_note`).
3. Push notifications (`lib/notificationFanout.ts`) and the evening round-up (data spine PR 9): they read the cat's name and status only; PR 1.2's "not notifiable" test plus a source test that neither file imports the new resolver fields.
4. Emails (the sterilisation news job, data spine §9): PR 1.2's snapshot-comparison test.
5. The old care timeline (`cat_updates`): PR 7.1.
6. The guardian's view outside her colonies (SYC-53 PR 2.1's T4) and inside them except through the `view_health_notes` block (PR 5.1).
7. The matching prompt (`lib/matching.ts`): **appearance never feeds the matcher (SYC2-D8)**; a source test in PR 1.2 fails if `matching.ts` reads `coat`, `markings` or the snapshot's new fields.
8. The donor count endpoint (PR 6.1: keys `year` and `count` only).
9. The public website and any server-drawn public page: none render cat fields today; the PR 2.1 reviewer confirms with a grep for `serialiseCat` and `CatWithStats` callers.

**Invariant 2: only authority, or two independent spotters, can overturn a machine reading.** Every writer and reader:
1. `writeObservation` (PR 1.1: roles per kind, own-row supersession).
2. The answers route (PR 4.1: lock, re-check, refusal after a ruling).
3. Team and guardian routes (PRs 3.1, 5.1: capability with a target from the record).
4. `resolveCoat` and `resolveMarkings` (PR 1.2: the read-time voice rules, independent of every writer).
5. Any future backfill or import: `writeObservation` refuses a `backfill:` suggestion source today, and the resolver counts voices at read time, so a new writer cannot make one device count twice.
6. The Colour check list (PR 3.1) and the guardian changes list (SYC-53 PR 2.2), which show the team the cases the rules admit.

---

## Rollout

1. **D-SYC2** merges (docs only).
2. **1.1 then 1.2** publish; nothing visible. After each, confirm `/api/healthz` shows the new commit before moving on (the EU deploy can sit in "promoting").
3. **2.1** publishes. Probe a cat's payload on production (Slice 2's "After deploy"). Phones keep their cached catalogue.
4. **3.1 and 3.2** publish. The team describes a handful of cats as an acceptance test, ideally Jacky or Susan, with Samuel checking the public page shows the line and nothing about health.
5. **4.1, 4.2, 4.3** publish after SYC-161 is live (Decision A1), in that order (the app must never send a field the server refuses). The app part ships with the next web publish and store build.
6. **6.1** and **7.1** publish whenever ready after their "needs first"; 7.1's production check runs first.
7. **5.1** publishes after SYC-53's PRs 0.2, 0.5, 2.1 and 2.2 are live.
8. **SYC-161** (Decision A1, urgent) can start any time after 2.1.

Every probe is run by Claude, not Samuel.

---

## Where this collides with other work

| Work | What overlaps | How it's handled |
|---|---|---|
| **SYC-53 plan** (PR #116) | The four capability names (its PR 0.5); roles vocabulary (0.2); guardian pages and statements (2.1, 2.2); its docs PRs D1 and D3 edit the data spine and `DECISIONS.md` | Slice 5 waits for 0.2, 0.5, 2.1, 2.2. PR 3.1 adds the four names granted to staff; whichever of 3.1 and 0.5 merges second rebases. D-SYC2 appends to §10.1 without touching D1's vocabulary lines. C4 and C7 are raised on SYC-53 by comment. This plan does not edit the SYC-53 plan |
| **SYC-209 plan** (another session) | The team cat page; data-spine amendments | Docs: agreed by message, two docs PRs in disjoint sections. Code: SYC-209 adds colony and feeding-site sections to the team cat page; PR 3.1 adds an Appearance section and 3.2 a Vaccination and Health notes section. Each is a separate `<section>` in `catPages.ts`; whichever merges second rebases |
| **SYC-161 / SYC-119 Slice C** | `resolveCoat`, the `coat` field, the colour chips | Decision A |
| **PR #111** (SYC-44 "Report an issue") | "Wrong information about this cat" reaches the team | No overlap in code; a wrong colour reported that way is corrected by the team in PR 3.1 |
| **PR #107** (SYC-130 "This is my cat") | `DECISIONS.md`, the data spine §4.2, and the `guardian_of_this_cat` scope | Disjoint sections; C4 |
| **SYC-43 part 2 PR 6** (hide and restore a photo, being built) | Hidden photos | The details card skips the appearance question for a sighting whose photo is hidden (PR 4.2); a hidden photo still counts as a `photoId` for voices |
| **SYC-152** ("Matched by hand" list) | The hand-pick colour flag | On the Colour check list now (C10); SYC-152 gets a comment |
| **SYC-185** (retire the care route) | `POST /cats/:catId/updates` | PR 7.1 removes only `general`; SYC-185 retires the rest |
| **Code PRs #109 and #115** | None | — |

---

## What this plan does not do

| Not here | Where it lives |
|---|---|
| Reading colour from photos, the backfill, the "Find the cat" colour chips | SYC-161 (Decision A) |
| Markings read by the model; a markings filter | SYC-243 |
| A structured condition list | SYC-242 |
| Sex, age and pregnancy | SYC-241 |
| A public vaccination line of any kind; "Needs vet"; a sterilised filter | Never (SYC2-D6, D7) / after SYC-198 |
| Re-vaccination reminders | Not in the spec |
| Importing vaccination records | SYC-49 and `records-import.md`, once approved; `writeObservation` then accepts `provenance: import` for `vaccinated` |
| The donations backend and the funder reports | SYC-1, SYC-62 |
| Points for appearance | SYC-38, if ever wanted |
| Roles, invitations, colony screens | SYC-53, SYC-209 |

---

## What works with no signal

Precisely, as spec §8 says: **reading** appearance works offline for cats in the last cached catalogue (the cat page line, the picker card line and the cat-alog colour filter); a stale cache can show an old colour until the next fetch. **Writing** never does: the colour line after the points only appears after an online naming, the details card is hidden offline, nothing is added to the offline queue, and every team and guardian screen is online only.

---

## Model delegation

Session model for this plan: **Opus 5.5**, chosen by the brief because the plan changes how cat facts are trusted and touches the public payload and the offline cache, so a wrong order means rework across the data spine. For the build, each package goes to the cheapest tier that can do it safely; every step up is justified on its row. **No package uses Fable**: the design decisions are made in the approved spec and this plan; what remains is careful implementation and review, which Opus covers.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| D-SYC2 docs PR | Sonnet | Transcribing approved spec text into named sections | Session model checks every line against spec §10, §15 and the canonical facts in `CLAUDE.md` ("cat guardian", "spotter", €50–60) |
| 1.1 kinds, validators, write rules | Sonnet | Clear spec, an existing validator pattern | Every validator branch tested; **mutation probes** on own-row supersession and evidence of life; Opus spot review of `writeObservation` |
| 1.2 the resolver | **Opus** | *Escalated:* counting voices, photos, Athens days, prompted taps and authority order is where a wrong-but-green answer hides, and it decides what everyone sees | The 15 **mutation probes** in PR 1.2's table; the "every place the rules must hold" list handed to the reviewer; Opus adversarial review in its own worktree |
| 2.1 payload, words, display line | Sonnet | Field copy, codegen, strings, one small component | T-leak, T-rabies, T-cache each with a **mutation probe**; browser check; Opus spot review of `serialiseCat` |
| 2.1 Greek and French drafts | Sonnet | Language quality matters more than for boilerplate | The spec's drafts used verbatim; Johnny's check (SYC-283) |
| 3.1 Appearance, Confirm / Correct / Mark wrong, Colour check | Sonnet | Follows PR #99's correction pattern and the Likely list | Route tests incl. form/JSON parity; hand-pick **mutation probe**; browser check; Opus spot review of the retract path |
| 3.2 vaccinations and health notes | Sonnet | Forms over 1.1's reviewed rules | Read-gate and needs-help **mutation probes**; T-rabies re-run; Opus spot review |
| 4.1 answers endpoint | **Opus** | *Escalated:* concurrency under the (device, cat) lock and the refusal-after-ruling ordering; the details-card spec's own review found this class of bug | T-double-tap and T-checked **mutation probes**; Opus adversarial review in its own worktree |
| 4.2 the colour line and details card | Sonnet | Standard UI on an existing component | T-hurt and T-offline with **mutation probes**; browser check in three languages at ~390 px and desktop |
| 4.2 chip pictures (Decision D1) | Sonnet | Nineteen small consistent drawings | Samuel sees them in the browser check before the PR opens |
| 4.3 cat-alog colour filter | Haiku | One filter over cached data, rules fixed | "Colour not known" **mutation probe**; offline test; session model reviews the diff |
| 5.1 guardian routes and health-note block | **Opus** | *Escalated:* a placed capability with a record-derived target; a leaked note or a cross-colony write is silent | Target and health-block **mutation probes**; SYC-53's route walk; Opus adversarial review |
| 6.1 donor count | Sonnet | One query, one sentence | Distinct-cat, Athens-year and threshold **mutation probes**; production probe |
| 7.1 refuse `general` | Haiku | One enum change and a test | Production read-only count first; **mutation probe**; session model reviews the diff |
| Seeded fixtures and HTML row markup across slices | Haiku | Boilerplate against a fixed shape | Typecheck plus the PR's own tests; session model reviews |
| Adversarial review of each PR | Same tier as the builder (Sonnet for Sonnet-built, Opus for Opus-built), **each in its own worktree, never shared** | A reviewer proving a test can fail mutates the tree | Findings folded in and listed in each PR; the session model checks each against the code |
| Production probes and the 7.1 read-only count | Session model | Production data and credentials; not delegated | The "After deploy" steps |

## Crash-proofing for the build

Every PR is built in its own worktree off fresh `origin/main`, never the primary checkout. **Commit after each item**, and keep a `CHECKPOINT.md` in the worktree root (what's done, what's next), updated after each commit, so any session can resume from the last commit. Every agent prompt restates "commit after each item" word for word. Agents don't spawn nested agents. A progress note goes to Samuel at each merged PR.

---

## Linear

**Each PR closes or advances:**

| PR | Closes | Advances |
|---|---|---|
| D-SYC2 | | SYC-2, SYC-161, SYC-5 (descriptions updated) |
| 1.1, 1.2 | | SYC-2, SYC-52 (`reported` reachable for appearance) |
| 2.1 | | SYC-2, SYC-283 and SYC-244 (strings ready to check) |
| 3.1, 3.2 | **SYC-5** (vaccination records, team-only, as the spec re-scoped it) | SYC-2 |
| 4.1–4.3 | | SYC-2 |
| 5.1 | | SYC-2, SYC-53 |
| 6.1 | | SYC-2, SYC-1, SYC-62 |
| 7.1 | | SYC-185 |

**SYC-2 closes when Slices 1–4, 6 and 7 have merged** (everything but the guardian slice; Slice 4 waits for SYC-161), or when 5.1 merges if Samuel prefers to keep it open for guardians.

**Filed by this plan (12 October 2026), as comments on existing tickets after deduping with `list_issues`.** No new tickets were needed: every follow-up the plan implies already has a ticket.
1. **SYC-161**: under Decision A1, reuse `resolveCoat`, the `coat` field and the chip component; narrowed rule; no cache bump; import `COAT_COLOURS`.
2. **SYC-5**: re-scoped by the spec (team-only, no `cat_update_type` value, no public timeline row); closed by PR 3.2.
3. **SYC-53**: Slice 5's dependency on PRs 0.2, 0.5, 2.1, 2.2; C4 (scope shape follows Decision B; who edits the SYC-2 spec line, also on PR #116); C7 (health notes as a separate block, so its T4 lists it as allowed, and its route walk T1 lists `/api/team/my/cats/:id/appearance/*`, `statements/:id/wrong` and `health-notes`); guardian precedence follows its review's Decision G.
4. **SYC-52**: `reported` is produced for colour and markings only (C5).
5. **SYC-152**: show the hand-pick colour flag in "Matched by hand" (C10).
6. **SYC-1** and **SYC-62**: the donor count's rules and the one-sentence requirement (Decision B).
7. **SYC-185**: PR 7.1 removes `general` ahead of the route's retirement (Decision C).
8. **SYC-49**: importing vaccinations needs `writeObservation` to accept `provenance: import` for `vaccinated`.
9. **SYC-283** and **SYC-244**: the coat and marking strings land in PR 2.1.

---

## Review outcome

An independent Sonnet critic checked this plan against the approved spec and the code on 12 October 2026, read-only. It found no blockers, four major findings and four minor ones. All eight were accepted and folded in:

| # | Finding | How it was handled |
|---|---|---|
| 1 | A team or guardian retraction could supersede any row, including `sterilised`, `vaccinated` or `team_note` | PR 1.1: a retraction must target the same kind, and only `coat` or `markings`, for every role; T-retract-kind with a mutation probe |
| 2 | Before SYC-161, the Colour check list's "no authority" reason would list nearly every cat | PR 3.1: those cats sit in one collapsed, counted group at the bottom; every other reason comes first |
| 3 | Decision A1 (then) understated what spotters would see without machine readings, and missed an option | Decision A rewritten: the recommendation now holds the spotter slice until SYC-161 is live, keeping the spec's one-tap "right?" and its §14 order; the old A1 is kept as A2 with its risks stated |
| 4 | An appearance refusal could drop the ear-tip answer sent in the same request | PR 4.1: appearance is judged on its own and the other answers are still saved; T-partial with a mutation probe |
| 5 | Today's authority check accepts `vet` and imported rows | PR 1.2: excluded at read time for colour and markings, with a mutation probe |
| 6 | 3.2 and 6.1 could merge before 2.1's leak tests exist | Both now need 2.1 first, stated in the order table |
| 7 | Only the answers route normalised black plus white | One `normaliseColours()` used by every writer (PR 1.1) |
| 8 | Decisions D and E lacked a "what people notice" column | Added |

The critic also noted that a team vaccination route described in the public API file would put "rabies" into the generated client; PR 3.2 keeps those routes out of `openapi.yaml`, and T-rabies scans the generated client.

### Pre-merge pass (12 October 2026, after Samuel's approval)

A second independent Sonnet pass checked the approved plan for internal consistency and against the sibling plans (#116, #118). No blockers. Fixed: guardian-versus-team precedence now follows the SYC-53 review's proposed Decision G; the owner of the SYC-2 spec's guardian-scope line is named (C4); "Mark wrong" reuses the existing `/team/statements/:id/wrong` route instead of adding a second; sibling plan references updated to PRs #116 and #118; leftover "A1 or A2" hedges removed; the resolver rule for guardians is owned by PR 1.2 and switched on by 5.1; the mutation-probe count corrected to 14; what closes SYC-2 now accounts for Slice 4 waiting on SYC-161.

### Decision G applied to appearance (Samuel, 13 October 2026)

The approved roles plan (#116) ranks who wins as vet > owner > cat guardian > team, newest only within a level, and binds SYC-2's colour and markings to it. Samuel confirmed it for appearance, with the carve-outs the SYC-2 spec already implies: vets, imported records and owners have no standing on colour or markings (owners until SYC-130 decides). He considered letting the photo-reading model referee guardian–team disagreements and chose not to: people decide, and the machine stays below them (in keeping with §4.2 rule 1, where a later machine reading never overrides a person's statement). To keep the team in control, **Correct** on a guardian-described cat overrules her in one step (PR 3.1, T-overrule). The spec, the data spine and `DECISIONS.md` Part 2n were updated in the same PR as this note.
