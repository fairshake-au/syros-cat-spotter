# SYC-402: "Tell the cats apart", the matching game (implementation plan, for Samuel's approval)

**Linear:** SYC-402 (the game), with SYC-408 (two fields on the match record), SYC-409 (two capability rows), SYC-56 (the test set this feeds), SYC-150 (team re-files a sighting; not built here), SYC-59 (merge; not built here), SYC-404 and SYC-403 (photo versions), SYC-53 (guardian pages), SYC-4 (native review of strings).
**Status:** draft for Samuel's approval, 16 October 2026. An independent Sonnet review ran on this draft (§ "Review outcome"). Nothing here is built.
**Design (approved, not reopened here):** `docs/specs/matching-game.md`, **approved by Samuel on 16 October 2026** ("Approved — accept the D8 narrowing and D4 as written, Phase 4"), decisions SYC402-D1 to D8 and its §15 answers · its review `docs/specs/reviews/matching-game-review.md` · `roles-and-invites.md` §6.2 (owns the capability names) · `cat-record-data-spine.md` (owns `cat_identity` and the public-position grid) · `choose-a-different-cat.md` §4.6 (owns the match record) · `DECISIONS.md` (wins).
**Checked against:** `origin/main` at `2d6e636` (16 October 2026, after #191, #195 and #201 merged); the launch plan `docs/superpowers/plans/mvp-launch-31-oct.md` (PR #172, feature freeze Wed 28 Oct, final publish Thu 29 Oct); open PRs #194, #196, #197; Linear SYC-402 (all comments), SYC-408, SYC-409, SYC-404, SYC-150, SYC-59. Every "exists today" claim names the file it was read in.
**Timing:** **Phase 4 · Intelligence and income.** Nothing in this plan touches the 31 October launch. The first PR can merge in the first merge window **after** the launch publish settles (week of 3 November); the game switches on for players only when §"Rollout" step 6 is reached, which needs weeks of real spotting first. Earliest realistic switch-on: **early December 2026**.

---

## In plain English

**What a spotter sees, when it's all built.** A card on Home, **Help tell cats apart**. Tap it: two photos, three buttons, *Same cat · Different cats · Can't tell*. Five of those make a round; every fifth round is three line-ups ("Which of these is this cat?" with *None of them*). After each answer the card turns over with the cats' names and, for a hard pair, *"Our photo-matching tool found these two hard."* One number grows on Home and on the profile: cats you've helped tell apart, counted when three people agree. Two badges. It plays without signal from the deck the phone already holds; answers are sent when signal returns.

**What the Syros Cats team sees.** A new dashboard page, **Matching to check**: pairs the players think are one cat, sightings the players think are filed under the wrong cat, pairs they disagree about, and pairs nobody can tell apart. The team decides each with one tap and can tick "use as a check" to make a pair one of the quiet attention checks. Before the game opens, the same page in *seed* mode is where the team decides the first 20–30 check pairs. A guardian sees, on her own page, only the rows where both cats are in her colonies, and decides those.

**What Samuel gets.** A labels export for SYC-56 (`db-ops export-game-labels`), each label with its photo ids, who decided it and the matcher's score band and model version, so the 0.4 threshold can finally be measured against something.

**What never happens.** No cat is changed by the game. No position, score or hidden photo reaches a phone. No points, no leaderboard movement.

**The order, in one line.** First the two match-record fields (so pool 1 has exact photos from the day the game opens), then the server's tables, deck job and decision engine behind a switch that's off, then the photo size parameter, then the app (pairs, then line-ups, then offline), then the count and badges, then the team page, then the export, then the switch.

---

## Where the spec and the code on `main` disagree

The spec's decisions stand. These are places where carrying them out needs the plan to say something the spec didn't, because the code has moved on or the spec left it open.

| # | What the spec says | What is true on `main` | What this plan does |
|---|---|---|---|
| C1 | §3.4: the badge "arrives through the in-app inbox" | `notifications` rows are tied to a cat update: `cat_update_id integer NOT NULL` (`lib/db/src/schema/notifications.ts:43-51`). There is no free-text inbox item | **Decision 1** |
| C2 | §4.3: a size parameter on `GET /photos/:id` | `routes/photos.ts` has the one route and no resizing; `sharp` is already a dependency of the api-server (`package.json:27`, used by the colour reader). SYC-404 ("Photo versions") and SYC-403 (small and medium versions for report photos) are in the backlog and would build exactly this | PR 3.1 builds the parameter on the same mechanism SYC-403/404 use if either has merged by then, else builds the smallest version of it and SYC-404 inherits it (Decision 3) |
| C3 | §10.3: two capability rows "to be approved with this spec" | `lib/capabilities.ts` has the catalogue as data, and `capabilities.catalogue.test.ts` **parses §6.2 of `roles-and-invites.md`** so the two can't drift. A row added to the spec without the code (or the reverse) fails CI | PR 0.1 edits both in one PR (SYC-409) |
| C4 | §10.2: `compared_photo_ids` and `model_version` on `sighting_matches` | Neither exists (`lib/db/src/schema/sightingMatches.ts`). `computeMatchCandidates` reads `cat.primaryPhotoId` raw (`routes/sightings.ts:262-274`) and `VISION_MODEL` is a constant in `lib/visionModel.ts` | PR 1.1 (SYC-408). Until it's live, the deck job's pool 1 uses the fallback the spec allows (§4.2: compare against the cat's current main photo and drop pairs older than its last change) |
| C5 | §4.1 pool 1: "scored under 0.25, or outside the top three, so no score is stored" | `rankedForRecord` stores the top three at ≥ 0.1 (`routes/sightings.ts:296-300`); a `hand_pick` with `miss_kind = 'matcher_miss'` may or may not have a score | The deck job treats "no stored score" as band `unscored` and the label carries it (§7.1 of the spec needs the band) |
| C6 | §9: "a new queue item type, `game_answer`, in the existing store" | `createQueueStore<T extends { localId }>` is generic (`lib/queueStore.ts:175`); `ReportQueueContext.tsx:155` is the second user. `offlineQueue.ts`'s sync rules are sighting-specific and mark any 4xx as permanent | PR 4.3 adds a `GameQueueContext` on the report queue's pattern, with its own storage key and a sync driver whose only permanent error is a 4xx other than 429 |
| C7 | §4.3: "one deck an hour" per device | `rateLimit.ts` has per-route limiters keyed by IP; the per-device limiter exists for sightings (`sightings.matchHardening` tests, "the per-device limit refuses the 21st request") | PR 2.2 reuses the per-device limiter with its own window |
| C8 | §7.2: the guardian's rows "on her own page" | `routes/teamMy.ts` has `/team/my` and `/team/my/colonies` (SYC-53 PR 1.3, merged) | PR 6.2 adds a section to `/team/my/colonies`, not a new page |
| C9 | §6.3: "a cat in no colony is the team's" | `placeCats` (`lib/colonyCats.ts`) answers which colony a cat is in; `can()` is strict: a placed capability with no colony target means island-wide (`lib/capabilities.ts` header) | `decide_photo_pair` is checked with **both** cats' colonies as targets; either missing → the team only |
| C10 | §4.2: the deck job runs "nightly, and after each team decision, hide, restore or removal" | No job scheduler in the api-server; the colour reader's trial runs are started from a GitHub workflow (`coat-readings.yml`); the push round-up runs on a timer in-process (`pushRoundupRunsTable`) | The deck job is a function called (a) in-process on a 6-hour timer like the round-up, (b) at the end of every team decision, hide, restore and removal route, and (c) by `db-ops rebuild-game-deck` for a manual run. "Nightly" becomes "every six hours": cheaper to reason about than a clock |
| C11 | §10.4: settings in `app_settings` | Exists since #195 (`lib/db/src/schema/matchWait.ts`; `lib/appSettings.ts` knows three keys and their shapes; `db-ops set-setting`) | PR 2.1 adds the `game_*` keys to the same reader with shapes and defaults. No dashboard page for them (SYC-383 covers that later) |

---

## Decisions for Samuel

Three, each with a recommendation. The rest are small calls (below), which stand unless he objects.

### Decision 1: How a game badge is announced (C1)

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Extend the inbox** *(recommended)* | Migration `inbox_items`: `cat_update_id` becomes nullable and the row gains `kind` (`cat_update` / `badge`) and `message` (text, nullable). The inbox list renders a badge row with the badge's translated name | The inbox is where people already look; "New badge: Sharp eyes" lands the same way a "spotted again" does; one small migration | Touches a table read by every notifications request; the app's inbox renderer needs one new branch (an old app shows the row with a blank message, so the message is also put in `cat_updates`-shaped fields as a fallback until the app updates) |
| B. Profile only | No announcement. The badge appears on the profile with the others the next time it's opened | Nothing to build beyond §5 | The one moment the game pays off goes unmarked |
| C. A push | Use the existing push path | Loudest | Pushes are a daily round-up for exactly the reason that they shouldn't be per-event (SYC-218); a badge push breaks that rule |

**Recommendation: A.**

### Decision 2: Who seeds the check pairs, and when (spec §15.4)

| Option | Benefits | Risks |
|---|---|---|
| **A. Samuel, in seed mode, before switch-on** *(recommended)* | Thirty minutes; he knows what a clear-cut pair looks like for this purpose; no team time before the game has proven itself | The pairs reflect one person's eye |
| B. Syros Cats, in seed mode | The people who know the cats | Asks for team time on a feature they haven't seen work |
| C. Both: Samuel seeds 20, the team adds as they decide contested pairs | Grows naturally | Same as A at the start |

**Recommendation: A** (C follows naturally once the page is in use).

### Decision 3: The photo size parameter (C2)

| Option | Benefits | Risks |
|---|---|---|
| **A. Build on SYC-404 if merged, else the smallest `?w=` on the existing route** *(recommended)* | No second resizing path; `sharp` is already there | If SYC-404 lands later with a different shape, this parameter is migrated to it (one PR) |
| B. Wait for SYC-404 | One path, once | The game waits on a ticket with no date |
| C. Embed thumbnails in the deck response | No route change | Bypasses `photoVisibility.ts`, the only builder of a public photo address, which has a test enforcing that (review finding 19) |

**Recommendation: A.**

### Small calls this plan makes (object to any, otherwise they stand)

1. **A switch.** `game_enabled` (default `false`) in `app_settings`. The Home card and the reward-screen line don't render, and `GET /api/game/deck` answers `404`, until it's `true`. Every PR below merges with the switch off.
2. **Both formats before switch-on.** Samuel chose pairs and line-ups from the start (D2). PR 4.1 ships pairs, PR 4.2 line-ups; the switch turns on only after both are live.
3. **Migration names, not numbers.** `match_compared_photos` (PR 1.1), `game_tables` (PR 2.1), `inbox_items` (PR 5.1, under Decision 1 A). Numbers are claimed when each is generated, on top of the history at that moment (`lib/db/migrations/README.md`), because SYC-209, SYC-53 and SYC-2 are each adding migrations this fortnight.
4. **The decision engine is one pure function.** `decideGamePair(judgements, now, settings) → { state, answer?, reason }` implements the spec's §6.1 table exactly and is tested row by row, including the uncounted and Can't-tell cases. The route calls it; nothing else decides.
5. **Labels are a view, not a table.** `game_labels` is a Postgres view over decided `game_pairs` (pools 1 and 2), and the export reads the view. Nothing is copied.
6. **The team's "same cat" mark writes a note**, `game_pairs.decided_note = 'same_cat_for_merge'`, and nothing else. SYC-59 reads it when it exists.
7. **Seed mode is the same page.** `/api/team/matching?mode=seed` shows random neighbour pairs (pool 2) and easy pairs with the three buttons plus "use as a check"; it's the ordinary page with a different source.

---

## How it ships: the order

| Step | PR | Migration | Depends on | Switch |
|---|---|---|---|---|
| 0 | 0.1 Catalogue rows + capabilities (SYC-409) | — | — | — |
| 1 | 1.1 Match record fields (SYC-408) | `match_compared_photos` | — | — |
| 2 | 2.1 Game tables, settings, deck job | `game_tables` | 1.1 | off |
| 3 | 2.2 Game routes and the decision engine | — | 2.1 | off |
| 4 | 3.1 Photo size parameter | — | — | — |
| 5 | 4.1 App: deck store, pairs round, Home card, reward line | — | 2.2, 3.1 | off |
| 6 | 4.2 App: line-ups | — | 4.1 | off |
| 7 | 4.3 App: offline queue and deck check | — | 4.1 | off |
| 8 | 5.1 Count, badges, inbox item | `inbox_items` (Decision 1 A) | 2.2 | off |
| 9 | 6.1 Team: Matching to check, seed mode | — | 2.2 | — |
| 10 | 6.2 Guardian section on My colonies | — | 6.1, 0.1 | — |
| 11 | 7.1 Labels view and export | — | 2.2 | — |
| 12 | Seed, then switch on | — | all | **on** |

PRs 1.1 and 3.1 are useful on their own (SYC-408 serves SYC-56 and SYC-303; 3.1 serves SYC-404) and can merge in any window after launch. Everything else merges in order.

---

## Slice 0: docs and the catalogue

### PR 0.1: the two capability rows (SYC-409; spec §10.3; C3)

- `roles-and-invites.md` §6.2: add `review_photo_pairs` (island-only; team ✓, management ✓, guardian —) and `decide_photo_pair` (placed; All / All / Own), word for word from the spec.
- `lib/capabilities.ts`: the two catalogue entries.
- `DECISIONS.md`: a new Part recording SYC402-D1–D8 and the 16 October approval, in the house style (one paragraph per decision, the spec as the source).
- **Tests:** `capabilities.catalogue.test.ts` passes (it parses the spec table). T0-1: `can(guardian, 'decide_photo_pair', colonyA)` true for her colony, false for another; `can(guardian, 'review_photo_pairs')` false; `can(staff, 'review_photo_pairs')` true.

## Slice 1: the match record

### PR 1.1: `compared_photo_ids` and `model_version` (SYC-408; spec §10.2; C4)

- Schema: `comparedPhotoIds: jsonb` (`Record<catId, photoId>`), `modelVersion: text`, both nullable. Migration `match_compared_photos`, additive, with the rollback block.
- `computeMatchCandidates`: record the photo id it actually sent per cat (today `cat.primaryPhotoId`; after SYC-303 is decided, whatever it sends) and `VISION_MODEL`. Written in the same upsert as `comparedCatIds` (`routes/sightings.ts:362`), on both the first run and the dedupe-hit re-run.
- **Tests:** T1-1 the record holds the photo id sent for each compared cat; T1-2 the model version; T1-3 a cat whose photo row is missing is neither in `comparedCatIds` nor in `comparedPhotoIds` (review F5 precedent); T1-4 **mutation probe:** swap the cat's main photo after matching and show the record still names the photo that was sent. `migrate:check` and the rollback test.

## Slice 2: the server

### PR 2.1: tables, settings and the deck job (spec §4, §10.1, §10.4; C5, C10, C11)

- Schema (`lib/db/src/schema/game.ts`): `game_pairs`, `game_lineups`, `game_judgements` (unique `(device_id, pair_id)`; `device_id` nullable for unlinking), `game_lineup_answers`, `game_devices`, exactly the columns in spec §10.1 plus `decided_note`. Check constraints on `pool`, `status`, `answer`, `decided_by`. Migration `game_tables`.
- Settings (`lib/appSettings.ts`): `game_enabled` (false), `game_round_mix` ({close: 3, neighbour: 1, check_or_easy: 1}), `game_deck_size` ({pairs: 20, lineups: 3}), `game_daily_cap` (5), `game_score_band` ([0.25, 0.6]), `game_retire_days` (90), `game_queue_cap_per_day` (10), `game_fresh_device_days` (7), `game_care_threshold` (0.6), `game_care_min_checks` (5). Each with a shape check and the default.
- `lib/game/deck.ts`: `rebuildDeck()`. Pools exactly as spec §4.1; exclusions exactly as §4.2, in this order: visibility (`hiddenPhotoIds`, `catDisplayPhotoIds`), sighting eligibility (`resolved` with `choice in ('suggested','hand_pick','new_cat')`, not `matcherFailed`), compared-photo check (C4 fallback until 1.1 data exists), `cat_identity` merge retirement, closeness rule on **published** positions (the grid function the public cat payload already uses), open reports (`issue_reports` with `photo_id` and no outcome), retired/paused pairs. Line-ups per §4.4 with random candidate order fixed at build time and the `new_cat` "None" cases marked weak. Cap at a few hundred live pairs, usefulness-ordered.
- Triggers (C10): a 6-hour in-process timer with a `game_deck_runs` row for the lock, the same shape as `push_roundup_runs`; a call at the end of each team decision/hide/restore/remove route; `db-ops rebuild-game-deck`.
- **Tests:** T2-1 each pool produces only pairs that satisfy every §4.2 rule (one test per rule, each with a **mutation probe** that disables the rule and shows the forbidden pair appear); T2-2 a hidden sighting photo never enters any pool; T2-3 a privacy-removed photo (SYC-246's `remove_photo` state) never enters; T2-4 a pair whose compared photo is no longer the cat's main photo is dropped, not swapped; T2-5 two cats merged through `cat_identity` retire their pair; T2-6 the closeness rule: two cats with exact positions 400 m apart but published cells 1.2 km apart produce **no** pair; T2-7 a pair with an open report is paused and returns when the report closes; T2-8 line-up candidate order is random and not score-ordered (statistical over 200 builds); T2-9 the job is idempotent (two runs, same deck); T2-10 the lock: two concurrent runs, one works.

### PR 2.2: the routes and the decision engine (spec §4.3, §4.5, §6; C6, C7)

- `GET /api/game/deck` (device secret required; per-device limiter, one per hour; `404` while `game_enabled` is false): the next 20 pairs and 3 line-ups this device hasn't answered, filtered **again** through `hiddenPhotoIds` at request time, with photo addresses from `publicPhotoUrl` plus `?w=720`, public names, the reveal lines, and for each item a `revealsSettled` flag computed at request time. Records `last_deck_fetched_at`.
- `POST /api/game/answers` (device secret; batch of up to 50): for each, first-wins per `(device, pair)`, retired/paused → `{ accepted: false, reason }`, daily cap counted per Athens day (`athensDay`, from #195) → `{ accepted: false, reason: 'daily_cap' }`; otherwise insert with `counted` from the device's care state at that moment; then `decideGamePair` for the pair; on a decision, credit (§8) and the badge check (PR 5.1). Always `200`.
- `GET /api/game/deck/check?ids=`: which of these photo ids are now hidden or removed (`410` for a removed photo's address is the photo route's job, PR 3.1).
- `lib/game/decide.ts`: the pure function for spec §6.1's table; `lib/game/care.ts`: the care score from `game_devices`, re-marking live judgements uncounted on a drop.
- **Tests:** T2-11 every row of the §6.1 state table, one test each, including 2 Same + 1 Can't tell (still live), 3 Can't tell + 1 Same (nobody can tell), 3–2 (queue), 4–1 (decided), 90 days (undecided); T2-12 uncounted judgements never move a pair and never contest it; T2-13 a device below 60 % after five checks is uncounted, its live judgements re-marked, decided pairs untouched; T2-14 first-wins (second answer `accepted: false`, row unchanged); T2-15 the daily cap by Athens day across the DST change; T2-16 a hidden-at-request-time photo is filtered from the deck response even if the deck job hasn't run; T2-17 `404` while the switch is off; T2-18 a decision where every counted device is under seven days old is flagged `fresh_devices`; T2-19 the queue cap of ten contested rows a day; T2-20 **mutation probes** on the decision function: flip "no counted disagreement" to "majority" and show the 2–1 case wrongly decides; T2-21 the device secret is required on both routes (SYC-92's pattern); T2-22 no route ever returns a position, a score, or a `sighting_matches` field (snapshot of the response shape, the `publicPayload.p6` pattern).

## Slice 3: photos

### PR 3.1: the size parameter (spec §4.3; C2; Decision 3)

- `GET /api/photos/:id?w=720`: `sharp` resize on the longest side, JPEG, cached with the same headers as the full photo (`private, max-age=31536000, immutable`, from the SYC-44 plan's Decision 1). Only `w ∈ {720}` accepted (one size, so the cache can't be asked for a thousand variants); anything else is ignored. A hidden or removed photo answers exactly as today (`404` / `410`).
- **Tests:** T3-1 the resized bytes are ≤ 720 px on the long side; T3-2 a hidden photo at `?w=720` is `404`; T3-3 an unknown `w` serves the full photo; T3-4 the header test from SYC-44 still passes on the resized response.

## Slice 4: the app

### PR 4.1: the deck store, the pairs round, the Home card and the reward line (spec §3.1, §3.2, §3.4, §3.5, §3.7, §9)

- `lib/gameDeck.ts`: fetch, store (AsyncStorage on native, Cache API + a small index on web; photos downloaded while on signal), expiry at 24 h, "under half full" refill rule, wipe on "Delete my data".
- `app/game.tsx`: the round (five pairs), the reveal, the end-of-round count, the empty-deck state, the daily-cap state, "Something wrong with this photo?" → the existing report flow with the photo id.
- Home card (`index.tsx`, below nearby cats, one row); the reward-screen line (`review.tsx`, bottom, only on the screen a live send opened, never on a queued review).
- Strings in en/el/fr; SYC-4 native review ticket comment.
- **Tests:** T4-1 the card and line render only when `game_enabled` is true in the loaded settings; T4-2 a round shows exactly the deck's next five unanswered pairs; T4-3 the reveal never renders a number; T4-4 the empty-deck and daily-cap copy; T4-5 the report link carries the photo id; T4-6 "Delete my data" wipes the deck and index; T4-7 the deck is not written into the cat-alogue cache key (structural guard).

### PR 4.2: line-ups (spec §3.3, §4.4)

- The line-up round (three), random order as delivered, the reveal with the spotter's choice, "None of them".
- **Tests:** T4-8 one tap sends one `lineup_answer`, never three pair judgements; T4-9 "None" sends one answer with `chosen: null`; T4-10 the rendered order equals the delivered order (never re-sorted).

### PR 4.3: the offline queue and the deck check (spec §9; C6)

- `GameQueueContext` on `createQueueStore<PendingGameAnswer>` with its own storage key; sync on the same triggers as the report queue (timer, NetInfo, AppState); `accepted: false` → done; network failure → retry; 4xx other than 429 → permanent; items older than 30 days dropped.
- On every launch with signal: `GET /api/game/deck/check` for the deck's photo ids; delete hidden/removed items before any card renders.
- The provisional tally ("5 answered · 5 waiting to send").
- **Tests:** T4-11 an answer saved offline is sent on reconnect in order; T4-12 `accepted: false` clears the item without an error; T4-13 a hidden photo is removed from the local deck on launch before render; T4-14 **mutation probe:** a `409` is permanent, a `429` retries; T4-15 the tally counts queued and sent separately and never shows a "decided" number from the phone.

## Slice 5: the count and the badges

### PR 5.1: `pairsDecided`, two badges, the inbox item (spec §3.4, §8; C1; Decision 1)

- `getProfileStats`: one indexed count of credited judgements (`game_judgements.credited_at IS NOT NULL`), added to `ProfileStats`; `pairsDecided` in the profile payload and the OpenAPI spec (`lib/api-spec/openapi.yaml`, orval regenerated).
- `badges.ts`: `sharp_eyes` (10), `cat_detective` (50); strings in three languages.
- Credit written by the decision path in PR 2.2 (counted judgements on the deciding side, pools 1 and 2 only, never removed).
- Under Decision 1 A: migration `inbox_items`; the badge row written when the badge first appears for a device (checked in the decision path, not on profile read); the inbox renders it.
- **Tests:** T5-1 credit only to counted, deciding-side judgements in pools 1–2; T5-2 a later team override leaves credit in place; T5-3 the two badges from stats; T5-4 one inbox row per badge per device, ever; T5-5 the old inbox renderer tolerates the new row (fallback fields); T5-6 `getProfileStats` adds one query (counted with the existing query-count test pattern).

## Slice 6: the team's side

### PR 6.1: Matching to check, and seed mode (spec §7.2; C10)

- `routes/teamMatching.ts` + `lib/teamPages/matchingPage.ts`: `/api/team/matching` (nav key `matching`, label "Matching to check"), under `review_photo_pairs`. Sections in the spec's row order; each row: both photos (via `publicPhotoUrl`, which is already the only builder), public names, the players' counts, three actions (decide Same / decide Different / ask for a better photo), "use as a check", "retire". Decisions go through one function `decidePairAsTeam(pairId, answer, person, { useAsCheck })` that writes `decided_by`, the person, the note, and calls the deck job. `?mode=seed` sources random pool-2 and pool-4 pairs instead.
- Posts follow `teamCorrections.ts`: Origin, session and capability, then body; 303 back; 400 names fields only.
- **Tests:** T6-1 the page needs `review_photo_pairs`; T6-2 a decision retires the pair unless "use as a check"; T6-3 a check pair stays live and is never credited; T6-4 the "same cat" mark writes the note and changes no cat (structural: no write to `cats`, `cat_identity` or `sightings` in the route); T6-5 seed mode shows only pools 2 and 4; T6-6 the page shows no position and no score (snapshot); T6-7 the row for a sighting-vs-cat pair needs two decided pairs or the team's look (the cat-level rule).

### PR 6.2: the guardian's section (spec §6.3, §7.2; C8, C9)

- On `/team/my/colonies`: "Matching to check in your colonies": rows where **both** cats are in her colonies, with the same three actions under `decide_photo_pair` checked against both colonies; rows with one cat outside show read-only with "Syros Cats decide this one".
- **Tests:** T6-8 both-cats rule; T6-9 one-cat-outside is read-only; T6-10 a cat in no colony never appears for her; T6-11 her decision is recorded with her person id and `decided_by = 'guardian'`.

## Slice 7: the export

### PR 7.1: the labels view and `db-ops export-game-labels` (spec §7.1)

- View `game_labels`: decided pairs from pools 1–2 with photo ids, answer, decided_by, device count, youngest device age, lowest care score, fresh-devices flag, score band, model version, source sighting. The export writes CSV to the workflow's artefacts, nothing to a phone.
- **Tests:** T7-1 the view excludes pools 3–4, undecided and retired; T7-2 the `fresh_devices` flag is present and the export carries it; T7-3 the export contains no device ids.

---

## Where each of the spec's rules is enforced

| Rule | Where | Test |
|---|---|---|
| Hidden, removed, private photos never shown | deck job (T2-2, T2-3) **and** deck route at request time (T2-16) **and** phone deck check (T4-13) | three layers, each tested |
| Never a position, score or area word | response snapshots (T2-22, T6-6); reveal renders no number (T4-3) | |
| Closeness no finer than the public map | deck job on published positions (T2-6) | |
| One answer per device per pair | unique index + first-wins (T2-14) | |
| Line-up never manufactures "Different" | the phone sends one choice (T4-8); the server derives labels only per §3.3 (T2-11) | |
| The §6.1 table | `decideGamePair` (T2-11, T2-20) | |
| No cat changed by the game | structural guard on the team route (T6-4); no game code imports the cat/sighting writers | |
| No points, no leaderboard | no game code touches `profiles.points` (structural guard in T5-1) | |
| The switch | `404` and no cards while off (T2-17, T4-1) | |

---

## Rollout

1. **PR 1.1 and 3.1** in the first post-launch windows (week of 3 Nov). Migrate production (`db-ops migrate`, in "ask" mode), publish.
2. **PRs 0.1, 2.1, 2.2** over the following week; migrate; publish. The deck job runs with the switch off; `db-ops list-settings` shows the game keys. **Probe:** `db-ops rebuild-game-deck` on production and read the pool sizes from the run row (nothing public changes).
3. **PRs 4.1, 4.2, 4.3** as app releases (web first, store builds as the launch plan's November store track allows). Nothing shows while the switch is off.
4. **PR 5.1** (migrate), **6.1**, **6.2**, **7.1**.
5. **Seed** (Decision 2): 20–30 check pairs in seed mode.
6. **Switch on** when pool 1 has at least 100 live close-call pairs (read from the run row), the check pairs are seeded, and the Greek and French strings have had native review: `db-ops set-setting game_enabled true`. Expected: early December.
7. **First SYC-56 report** when the export has 200 close-call labels.

Rollback: `game_enabled false` hides everything at once with no release. Each migration has its rollback block; `game_tables` is additive and can stay.

---

## Where this collides with other work

- **SYC-209, SYC-53, SYC-2 migrations** (this fortnight): migration numbers are claimed at generation time, never in this plan (small call 3).
- **SYC-404 / SYC-403 photo versions:** Decision 3.
- **SYC-303** (hidden main photo sent to the matcher): PR 1.1 records whatever photo is sent, so when SYC-303 changes which photo that is, the record follows with no change here.
- **SYC-150** (team re-files a sighting): the "re-file" button on the Matching to check row is greyed with "not yet" until SYC-150 ships; the row still records the team's "keep" or "ask for a photo".
- **SYC-59** (merge): reads `decided_note = 'same_cat_for_merge'`.
- **SYC-383** (settings page on the dashboard): the game keys appear there when it's built; until then `db-ops set-setting`.
- **`review.tsx`** is being edited by the match-wait PR 2 (feeding nudge) this fortnight; PR 4.1 rebases over it.

## What this plan does not do

- Build a merge (SYC-59) or a re-file action (SYC-150).
- Tune the 0.4 threshold (SYC-56, once it has labels).
- Add any device-marking for guardians in the app (D4 accepted as written).
- Show a provisional "likely" count on the phone (D8 narrowing accepted).
- Add a settings page for the game keys (SYC-383).

## What works with no signal, precisely

- Playing the deck the phone already holds, pairs and line-ups, with the full reveal.
- Saving answers; they are sent in order when signal returns.
- A provisional tally of answered and waiting.
- **Not** offline: fetching a new deck; the decided count; badges; removing a photo hidden since the last launch with signal (it goes at the next launch with signal).
- The dashboard doesn't work offline, as today.

## Model delegation

Session model for this plan: **Opus 5.5** (inherited by the chip). For the build, each PR goes to the cheapest tier that can do it, with the reason stated wherever it goes up.

| PR | Model | Why this tier | Assurance |
|---|---|---|---|
| 0.1 | Haiku | Copying approved rows word for word; the catalogue test checks them | Session model diffs against the spec |
| 1.1 | Sonnet | One additive migration and one upsert change on a well-tested path | T1-1…T1-4 with the mutation probe; Opus spot review of the dedupe-hit path |
| 2.1 deck job | **Opus** | *Escalated:* every privacy rule in the spec is enforced here first, and a missed exclusion is a silent privacy failure with every test green | T2-1…T2-10, one mutation probe per rule; independent Opus review in its own worktree told to get a hidden or far-apart pair into a deck |
| 2.2 routes and engine | Sonnet, engine reviewed by Opus | The engine is a pure function with a row-by-row table; the routes follow existing patterns | T2-11…T2-22 with mutation probes |
| 3.1 | Sonnet | One route parameter on an existing library | T3-1…T3-4 |
| 4.1, 4.2 | Sonnet | Screen work on existing patterns | T4-1…T4-10; browser check at 390 px and desktop, en/el/fr |
| 4.3 | Sonnet | Follows the report queue's pattern exactly | T4-11…T4-15 with the mutation probe |
| 5.1 | Sonnet | Small, well-specified; the migration under Decision 1 A is additive | T5-1…T5-6 |
| 6.1, 6.2 | Sonnet | Server-rendered HTML following `teamCorrections.ts` | T6-1…T6-11; structural guard T6-4 read by the session model |
| 7.1 | Haiku | A view and a CSV | T7-1…T7-3 |
| Strings and fixtures | Haiku | Mechanical | i18n parity test |
| Adversarial review of each PR before merge | Sonnet in its own worktree; Opus for 2.1 | Equal tier to the builder | Findings folded in and listed on each PR |
| Production steps (migrations, seed, switch) | Session model | Production state, not delegated | The rollout probes |

## Crash-proofing for the build

Each PR is built in its own worktree off fresh `origin/main`. **Commit after each numbered item**, with a `CHECKPOINT.md` (what's done, what's next) updated after each commit and deleted before the PR is marked ready. **Every agent prompt restates "commit after each item"** word for word. Agents don't spawn nested agents. If a session stops mid-PR, it comments where it got to on the PR's Linear ticket before stopping.

## Linear

**Tickets this plan builds:**

| PR | Ticket |
|---|---|
| 0.1 | SYC-409 |
| 1.1 | SYC-408 |
| 2.1, 2.2, 3.1, 4.x, 5.1, 6.x, 7.1 | SYC-402 (build sub-issues to be created at build time, one per PR, if Samuel wants them tracked separately) |

**Filed by this plan:** none new. **Comments to add (no state changes):** SYC-404 (PR 3.1 builds the first size parameter; please build on it or tell this plan to wait); SYC-150 (the Matching to check row needs the re-file action); SYC-59 (reads `decided_note`); SYC-56 (the export's shape); SYC-383 (the game keys).

## Still needs Samuel

1. Decisions 1, 2 and 3.
2. "Ask" mode for each production migration (1.1, 2.1, 5.1).
3. Thirty minutes in seed mode before switch-on (Decision 2 A).
4. Store builds for 4.x on the launch plan's November store track.

---

## Review outcome

(Filled after the Sonnet review of this draft.)
