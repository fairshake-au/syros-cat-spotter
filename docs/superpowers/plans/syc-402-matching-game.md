# SYC-402: "Tell the cats apart", the matching game (implementation plan, draft 2, for Samuel's approval)

**Linear:** SYC-402 (the game), with SYC-408 (two fields on the match record), SYC-409 (two capability rows), SYC-56 (the test set this feeds), SYC-150 (team re-files a sighting; not built here), SYC-59 (merge; not built here), SYC-44 (report an issue: PRs 6.2 and 7.2 are dependencies), SYC-404 and SYC-403 (photo versions), SYC-163 (team chooses a main photo), SYC-53 (guardian pages), SYC-383 (dashboard settings page), SYC-4 (native review of strings).
**Status:** draft 2 for Samuel's approval, 16 October 2026. An independent Sonnet review of draft 1 found 3 blockers, 12 majors, 5 minors and a set of nits (`syc-402-matching-game-review.md`); all are folded in here, and § "Review outcome" says how. Nothing here is built.
**Design (approved, not reopened here):** `docs/specs/matching-game.md`, **approved by Samuel on 16 October 2026** ("Approved — accept the D8 narrowing and D4 as written, Phase 4"), decisions SYC402-D1 to D8 and its §15 answers · its review `docs/specs/reviews/matching-game-review.md` · `roles-and-invites.md` §6.2 (owns the capability names) · `cat-record-data-spine.md` (owns `cat_identity` and the public-position grid) · `choose-a-different-cat.md` §4.6 (owns the match record) · `report-an-issue.md` (owns reports and removal) · `DECISIONS.md` (wins).
**Checked against:** `origin/main` at `2d6e636` (16 October 2026, after #191, #195 and #201 merged); the launch plan `docs/superpowers/plans/mvp-launch-31-oct.md` (PR #172: feature freeze Wed 28 Oct, final publish Thu 29 Oct, one-instance pin lifted Mon 26 Oct, store track in November); the SYC-44 plan (PRs 5.1, 6.x and 7.2 not yet on `main`); open PRs #194, #196, #197; Linear SYC-402 (all comments), SYC-408, SYC-409, SYC-404, SYC-150, SYC-59. Every "exists today" claim names the file it was read in, and the reviewer re-checked each.
**Timing:** **Phase 4 · Intelligence and income.** Nothing in this plan touches the 31 October launch. The first PR can merge in the first merge window **after** the launch publish settles (week of 3 November); the game switches on for players only when §"Rollout" step 7 is reached, which needs weeks of real spotting first. Earliest realistic switch-on: **early December 2026**.

**Words used in this plan.** A *structural guard* is a test that fails when someone adds a reader or writer nobody listed. A *mutation probe* is a test run twice: once as written, once with the rule it protects deliberately broken, to prove the test would catch it. A *checkpoint* is the `CHECKPOINT.md` file each build keeps so a stopped session can resume. The spec's own words (pair, judgement, decided, contested, retired, deck, close call, check pair, counted) are defined at the top of `matching-game.md`.

---

## In plain English

**What a spotter sees, when it's all built.** A card on Home, **Help tell cats apart**. Tap it: two photos, three buttons, *Same cat · Different cats · Can't tell*. Five of those make a round; every fifth round is three line-ups ("Which of these is this cat?" with *None of them*). After each answer the card turns over with the cats' names and, for a hard pair, *"Our photo-matching tool found these two hard."* One number grows on Home and on the profile: cats you've helped tell apart, counted when three people agree. Two badges. It plays without signal from the deck the phone already holds; answers are sent when signal returns.

**What the Syros Cats team sees.** A new dashboard page, **Matching to check**: pairs the players think are one cat, sightings the players think are filed under the wrong cat, pairs they disagree about, pairs nobody can tell apart, and pairs decided only by brand-new phones (held back until the team has looked). The team decides each with one tap and can tick "use as a check" to make a pair one of the quiet attention checks. Before the game opens, the same page in *seed* mode (the page with random pairs as its source, so the first 20–30 check pairs can be decided by hand) is where those come from. A cat guardian sees, on her own page, only the rows where both cats are in her colonies, and decides those.

**What Samuel gets.** A file of decided pairs for SYC-56 (the ticket that measures how good the photo-matching tool is), each with its photo ids, who decided it, and the tool's score band (how sure the tool was) and model version. That is what lets the tool's 0.4 "suggest it" cut-off finally be measured against something.

**What never happens.** No cat is changed by the game. No position, score, hidden photo or other player's vote reaches a phone. No points, no leaderboard movement.

**The order, in one line.** First the two match-record fields (so close calls have exact photos from the day the game opens), then the server's tables, deck job and decision engine behind a switch that's off, then the photo size parameter, then the app (pairs, then line-ups, then offline), then the count and badges, then the team page, then the export, then the switch.

---

## Where the spec and the code on `main` disagree

The spec's decisions stand. These are places where carrying them out needs the plan to say something the spec didn't, because the code has moved on or the spec left it open. Each is checked against the file named.

| # | What the spec says | What is true on `main` | What this plan does |
|---|---|---|---|
| C1 | §3.4: the badge "arrives through the in-app inbox" | Inbox rows are `notifications` (`lib/db/src/schema/notifications.ts:43-51`), each tied to a cat update: `cat_update_id integer NOT NULL`. The list route inner-joins `cat_updates` then `cats` (`routes/notifications.ts:124-131`), the API shape requires `catId`, `catUpdateId`, `catName` and an `updateType` (`lib/api-spec/openapi.yaml:808-830`), and the app's tap opens the cat (`app/notifications.tsx:118-123`). Badge names are translated on the phone (`lib/badges.ts` comment); the server holds no language for a device | **Decision 1** |
| C2 | §4.3: a size parameter on `GET /photos/:id` | `routes/photos.ts` has the one route, reads the whole base64 row (`select()` on `photos`, lines 44-47) and does no resizing; `sharp` is already a dependency (`package.json:27`, used by `lib/mapTiles/tileCache.ts` and `lib/imageValidation.ts`, which caps stored photos at 2048 px). `photoLimiter` is 300 per 15 min per IP, in memory (`middlewares/rateLimit.ts:57-61`). SYC-404 and SYC-403 (stored small versions) are in the backlog | PR 3.1 (Decision 3) |
| C3 | §10.3: two capability rows "to be approved with this spec" | `lib/capabilities.ts` holds the catalogue as data, and `capabilities.catalogue.test.ts` **parses §6.2 of `roles-and-invites.md`** so the two can't drift; a row in one place and not the other fails CI | PR 0.1 edits both in one PR (SYC-409) |
| C4 | §10.2: `compared_photo_ids` and `model_version` on `sighting_matches` | Neither exists (`lib/db/src/schema/sightingMatches.ts`). `computeMatchCandidates` reads `cat.primaryPhotoId` raw (`routes/sightings.ts:262-274`); `VISION_MODEL` is a constant in `lib/visionModel.ts`; the record is written by the `recordMatch` upsert (`routes/sightings.ts:362`, `setWhere isNull(chosenAt)`). Nothing on `main` ever changes `cats.primary_photo_id` after insert (SYC-163 isn't built), so there is no "last main-photo change" to read | PR 1.1 (SYC-408). For rows from before it: the compared photo **is** `cat.primaryPhotoId`, and the pair is kept only if `catDisplayPhotoIds` returns that same id (the public sees the photo the tool saw) and it isn't hidden. That fallback is retired when SYC-163 lands; from then the record's ids are the only safe source |
| C5 | §4.1 pool 1: "scored under 0.25, or outside the top three, so no score is stored" | `rankedForRecord` stores the top three at ≥ 0.1 (`routes/sightings.ts:296-300`); a `hand_pick` with `miss_kind = 'matcher_miss'` may or may not have a score | The deck job records band `unscored` for those and the label carries it (spec §7.1) |
| C6 | §9: "a new queue item type, `game_answer`, in the existing store"; "Cache API on web" | `createQueueStore<T extends { localId }>` is generic (`lib/queueStore.ts:175`); `ReportQueueContext.tsx:155-165, 206-230` is the second user and shows the full pattern: `withLock(…)` / `ifLockFree(…)` so two browser tabs never send twice, and `reportQueue.ts:187-189` treats a 4xx as permanent **except** 401, 403, 408, 428 and 429. Photos on the phone are kept by `lib/pendingPhotos.ts`: files via `expo-file-system` on native, IndexedDB via `lib/webPhotoStore.ts` on web, with a `durablePhotos()` probe for in-app browsers that can't keep them. **Nothing in the app uses the Cache API**; `offline-queue-on-web.md` sets IndexedDB. AsyncStorage holds JSON only (about 6 MB on Android) | PR 4.1 stores deck photos through the same adapters as pending photos; PR 4.3 copies the report queue's locks and permanent-error rule word for word. The spec's "Cache API" citation is corrected here, not its design |
| C7 | §4.3: "one deck an hour" per device | Per-device limits are `declareLimit` buckets in `lib/limits.ts` (`rateLimit.ts:126-137`); `declareLimit` throws on a clash, so each route declares its own | PR 2.2 declares three buckets: deck, answers, deck-check |
| C8 | §7.2: the guardian's rows "on her own page" | `routes/teamMy.ts` has `/team/my` and `/team/my/colonies`, both `requireTeam(undefined, OWN)`: any accepted person, **no capability** (line 50). `requireTeam` supports a `target` resolver that returns an **array**, and every target must pass (`middlewares/requireTeam.ts:62-69, 126-133`). Every `/api/team/*` route needs a row in `team.walk.test.ts`. Guardian-facing pages use `tr(lang, …)` (`lib/teamPages/layout.ts:337-345`) | PR 6.2: a read-only section on `/team/my/colonies`, and its own POST route under `requireTeam('decide_photo_pair', { target })` with **both** cats' colonies as targets, read from the pair row |
| C9 | §6.3: "a cat in no colony is the team's" | The colony readers are `currentColonyOf` (`lib/colonyMembership.ts:20`) and `catTarget` (`lib/capabilityTargets.ts:36`); `placeCats` (`lib/colonyCats.ts:50`) **writes** cats into colonies and is not used here. `can()` is strict: a placed capability with no colony target means island-wide | Both targets from `catTarget`; either missing → the team only |
| C10 | §4.3: the deck job runs "nightly, and after each team decision, hide, restore or removal" | There is **no in-process timer** anywhere in the api-server. The push round-up has two triggers: `opportunisticRoundUp` middleware after any API response, throttled (`lib/sightingRoundUp.ts:218`, mounted in `app.ts`), claimed by inserting the Athens date as a primary key (`sightingRoundUp.ts:119-123`); and `POST /api/internal/mail/drain` (`routes/internalMail.ts:38`), called by a Cloudflare Worker every two hours and by `.github/workflows/mail-drain.yml` as backup. The one-instance pin is lifted on Mon 26 Oct (launch plan; `docs/DEPLOYMENT.md:51`), so more than one server may run | PR 2.1 follows the drain pattern exactly: an internal route, the Worker, a time-bucketed opportunistic fallback, an advisory lock, and a dirty flag for event triggers (§ PR 2.1 "Triggers") |
| C11 | §10.4: settings in `app_settings` | Exists since #195. **Shapes live in `lib/db/src/appSettings/shape.ts`** (`SETTING_KEYS`, `settingShapeProblem`), shared by the server (`artifacts/api-server/src/lib/appSettings.ts`, a flat three-field struct) and the `db-ops set-setting` CLI. `GET /api/app-settings` returns only `feedNudge` and `hiddenFacts` (`routes/appSettings.ts:17-25`), cached publicly for 60 s; the phone keeps a fixed `StoredSettings` (`lib/appSettings.ts`) | PR 2.1 adds the keys in `shape.ts` with shapes and tests; PR 2.2 adds `gameEnabled` to the response, the OpenAPI schema, the generated client and `StoredSettings` |
| C12 | §4.2: a pair with an open report is paused; §3.7: the report link on every card; §9: a removed photo answers `410` | There is **no** `issue_reports` table: migration `0023_issue_reports.sql` adds columns to `welfare_reports`; an issue is a `welfare_reports` row with `kind = 'content'` and `photo_id` set (`lib/db/src/schema/welfare.ts:51, 96`), open when `state in ('new','looking')`. There is **no** report-an-issue screen or `/api/issues` route on `main` (SYC-44 PRs 5.1 and 6.x are scheduled 21–23 Oct). There is **no** photo removal state and no `410` (SYC-44 PR 7.2, Wed 28 Oct "unless cut", else first week of November) | PR 2.1 pauses on the `welfare_reports` rule; PR 4.1 renders the report link only once SYC-44 6.2 is on `main` (the switch-on checklist requires it, since §3.7 is a spec rule); PR 3.1 and the deck check treat "removed" as "whatever `photo_removal` says" and merge after 7.2 |
| C13 | §3.2: *"That settles it. Three of you agree."* on the reveal when this answer settled the pair | The phone can't know that offline, and telling it in advance would mean sending other players' votes on an undecided pair, which §7.4 forbids | The line is never shown on the reveal. On the next sync the server's answer carries `settledSinceLastSync: n`, and the round end (or the next app open) says *"Since last time, 2 of your pairs were settled."* The spec's §3.2 wording is amended by this plan (small call 8) |
| C14 | §3.7 says a paused pair's "answers [are] still accepted on sync"; §4.5 says a paused pair's answer returns `accepted: false` | The two sentences disagree | Small call 9 follows §4.5 (not accepted), because a photo under a report may be about to vanish and a judgement on it would be a label nobody can audit |

---

## Decisions for Samuel

Three, each with a recommendation. The rest are small calls (below), which stand unless he objects.

### Decision 1: How a game badge is announced (C1)

The spec says "through the in-app inbox" (§3.4, §8); that stands. The open question is how an inbox built around cat updates carries a row that has no cat, without breaking phones that haven't updated.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. A `kind` on the inbox row, served only to apps that ask for it** *(recommended)* | Migration `notifications_kind`: `cat_update_id` becomes nullable; new `kind` (`cat_update` / `badge`, default `cat_update`) and `badge_id` (text, nullable); checks (`kind='cat_update'` ⇒ `cat_update_id` set; `kind='badge'` ⇒ `badge_id` set); a partial unique index `(device_id, badge_id) where kind='badge'`. The list route returns badge rows **only** when the request says `?kinds=cat_update,badge`; an old app never sees one. The new app renders `badge_${id}` through `t()` and doesn't navigate to a cat. Rollback deletes badge rows first, then restores `NOT NULL` | One inbox, one unread count, one "mark all read"; the badge lands where people already look | Touches the table every notifications request reads, and the list route changes from an inner join to a left join; the fan-out, round-up insert, read-all and mark-read routes and `severPerson` are all re-tested |
| B. A separate `badge_awards` table and route; the inbox screen merges two lists | No change to `notifications`; the old route is untouched | Simpler migration | Two unread counts to reconcile, two "mark read" paths, and the app's inbox screen grows a second source for one row type |

**Recommendation: A.**

### Decision 2: Who seeds the check pairs, and when (spec §15.4, left to this plan)

| Option | Benefits | Risks |
|---|---|---|
| **A. Samuel, in seed mode, before switch-on** *(recommended)* | Thirty minutes; he knows what a clear-cut pair looks like for this purpose; no team time before the game has proven itself | The pairs reflect one person's eye |
| B. Syros Cats, in seed mode | The people who know the cats | Asks for team time on a feature they haven't seen work |
| C. Both: Samuel seeds 20, the team adds as they decide contested pairs | Grows naturally | Same as A at the start |

**Recommendation: A** (C follows naturally once the page is in use).

### Decision 3: The photo size parameter (C2)

The spec fixes the mechanism (a size parameter on the existing route, through `photoVisibility.ts`, §4.3); that stands. The question is what it reads from.

| Option | Benefits | Risks |
|---|---|---|
| **A. Build on SYC-404's stored small version if merged; else `?w=720` resized on request with a small in-memory LRU of resized bytes** *(recommended)* | One path once SYC-404 lands; cheap now | If SYC-404 lands later with a different shape, this parameter is migrated to it (one PR) |
| B. Wait for SYC-404 | One path, once | The game waits on a ticket with no date |

**Recommendation: A.**

### Small calls this plan makes (object to any, otherwise they stand)

1. **A switch.** `game_enabled` (default `false`) in `app_settings`. The Home card, the reward-screen line and the profile line don't render, and the game routes answer `404`, until it's `true`. Every PR below merges with the switch off.
2. **Both formats before switch-on.** Samuel chose pairs and line-ups from the start (D2). PR 4.1 ships pairs, PR 4.2 line-ups; the switch turns on only after both are live.
3. **Migration names, not numbers.** `match_compared_photos` (PR 1.1), `game_tables` (PR 2.1), `notifications_kind` (PR 5.1, under Decision 1 A). Numbers are claimed when each is generated, on top of the history at that moment (`lib/db/migrations/README.md`), because SYC-209, SYC-53, SYC-2 and SYC-44's `photo_removal` are each adding migrations. Each is its own publish slot with a Neon snapshot first, in "ask" mode.
4. **The decision engine is one pure function.** `decideGamePair(counts, now, settings) → { state, answer?, reason }` implements the spec's §6.1 table exactly and is tested row by row. The route calls it inside one transaction per answer (PR 2.2 "Concurrency"); nothing else decides.
5. **No view.** The labels export runs a query over decided `game_pairs` (pools 1 and 2, not fresh-flagged or reviewed). Nothing is copied and no migration is needed. (Draft 1 had a view; a view would need its own migration and would block later column changes.)
6. **The team's "same cat" mark writes a note**, `game_pairs.decided_note = 'same_cat_for_merge'`, and nothing else. "Ask for a better photo" and the "nobody can tell" outcome write `decided_note = 'needs_photo'`. SYC-59 reads the first; SYC-54's colony view can read the second.
7. **Seed mode is the same page.** `/api/team/matching?mode=seed` shows random neighbour pairs (pool 2) and easy pairs with the three buttons plus "use as a check"; it's the ordinary page with a different source.
8. **The "settles it" line moves to sync time** (C13). This amends spec §3.2's one sentence; everything else about the reveal stands.
9. **A paused pair's answer is not accepted** (C14; `accepted: false, reason: 'paused'`), and the phone treats that as done.
10. **Line-up pairs are ordinary pairs.** Building a line-up creates (or reuses) the three target-vs-candidate `game_pairs` rows in pool 1 with `from_lineup_id` set. They can be served in pairs rounds to other devices. A device that answered the line-up is never served those three pairs again (the deck route excludes pairs whose line-up this device answered), so first-wins never silently refuses a later answer. "None of them" writes three Different judgements; each is credited only if and when its own pair is decided on that side, under the ordinary rule.
11. **Counting is by rows, never by distinct device ids**, so a judgement whose device was unlinked by "Delete my data" (`device_id` null) still counts and a live pair never loses a vote. One test proves it.
12. **A retired pair stays retired.** After an unmerge (`cat_identity` superseded) the deck job may build a fresh pair for the two cats; the old row is not revived.
13. **Game routes go in OpenAPI** (`lib/api-spec/openapi.yaml`) and the orval clients, like the profile; the queue's sender uses the generated client through `customFetch`, as the report queue does.

---

## How it ships: the order

| Step | PR | Migration | Depends on | Switch |
|---|---|---|---|---|
| 0 | 0.1 Catalogue rows + capabilities (SYC-409) | — | — | — |
| 1 | 1.1 Match record fields (SYC-408) | `match_compared_photos` | — | — |
| 2 | 2.1 Game tables, settings, deck job, deletion | `game_tables` | 1.1 | off |
| 3 | 2.2 Game routes and the decision engine | — | 2.1 | off |
| 4 | 3.1 Photo size parameter | — | SYC-44 PR 7.2 merged (C12) | — |
| 5 | 4.1 App: deck store, pairs round, Home card, reward line, count | — | 2.2, 3.1; SYC-44 PR 6.2 for the report link | off |
| 6 | 4.2 App: line-ups | — | 4.1 | off |
| 7 | 4.3 App: offline queue and deck check | — | 4.1 | off |
| 8 | 5.1 Badges and the inbox row | `notifications_kind` (Decision 1 A) | 2.2 | off |
| 9 | 6.1 Team: Matching to check, seed mode | — | 2.2 | — |
| 10 | 6.2 Guardian section on My colonies | — | 6.1, 0.1 | — |
| 11 | 7.1 Labels export | — | 2.2 | — |
| 12 | Seed, then switch on | — | all, and SYC-44 6.2 live | **on** |

PRs 0.1 and 1.1 are useful on their own (SYC-408 serves SYC-56 and SYC-303) and can merge in any window after launch. PR 3.1 waits for SYC-44 7.2 because both edit `routes/photos.ts`. Everything else merges in order.

---

## Slice 0: docs and the catalogue

### PR 0.1: the two capability rows (SYC-409; spec §10.3; C3)

- `roles-and-invites.md` §6.2: add `review_photo_pairs` (island-only; team ✓, management ✓, guardian —) and `decide_photo_pair` (placed; All / All / Own), word for word from the spec.
- `lib/capabilities.ts`: the two catalogue entries.
- `DECISIONS.md`: a new Part recording SYC402-D1–D8 and the 16 October approval, in the house style.
- **Tests:** `capabilities.catalogue.test.ts` passes. T0-1: `can(guardian, 'decide_photo_pair', colonyA)` true for her colony, false for another; `can(guardian, 'review_photo_pairs')` false; `can(staff, 'review_photo_pairs')` true.

## Slice 1: the match record

### PR 1.1: `compared_photo_ids` and `model_version` (SYC-408; spec §10.2; C4)

- Schema: `comparedPhotoIds: jsonb` (`Record<catId, photoId>`), `modelVersion: text`, both nullable. Migration `match_compared_photos`, additive, with the rollback block.
- `computeMatchCandidates`: record the photo id it actually sent per cat (today `cat.primaryPhotoId`; after SYC-303 is decided, whatever it sends) and `VISION_MODEL`, in the same `recordMatch` upsert as `comparedCatIds`, on both the first run and the dedupe-hit re-run.
- **Tests:** T1-1 the record holds the photo id sent for each compared cat; T1-2 the model version; T1-3 a cat whose photo row is missing is in neither list; T1-4 **mutation probe:** change which photo is sent and show the record follows the photo, not the cat. `migrate:check` and the rollback test.

## Slice 2: the server

### PR 2.1: tables, settings, the deck job and deletion (spec §4, §9, §10.1, §10.4; C5, C10, C11, C12)

**Tables** (`lib/db/src/schema/game.ts`; migration `game_tables`, with rollback):

| Table | Columns beyond spec §10.1 | Why |
|---|---|---|
| `game_pairs` | `from_lineup_id` (nullable), `decided_note` (`same_cat_for_merge` / `needs_photo` / null), `fresh_devices` (bool), `fresh_reviewed_at`, `fresh_reviewed_by`, `youngest_device_days_at_decision`, `lowest_care_at_decision`, `counted_device_count_at_decision` | small call 10; spec §6.4 (held out of the test set until reviewed); the label's audit fields are copied **at decision time**, because a deleted device's age (`device_credentials.created_at`) is gone afterwards |
| `game_judgements` | `answered_at` (client time, clamped to the last 7 days and never in the future), `credited_at` (nullable) | the daily cap and credit (PR 2.2) |
| `game_lineup_answers` | — | as spec |
| `game_devices` | `first_seen_at` | the "fresh device" age while the device exists |
| `game_deck_runs` | `bucket` (bigint, primary key: `floor(epoch_seconds / 21600)`), `started_at`, `finished_at`, `dirty` (bool) | the job's claim and the dirty flag (Triggers, below) |

Check constraints on `pool`, `status`, `answer`, `decided_by`, `decided_note`. Unique `(device_id, pair_id)` on judgements (nulls distinct, so unlinked rows never collide).

**Settings** (`lib/db/src/appSettings/shape.ts`, with a shape and a default each, tested in the `dbOps.settings.test.ts` pattern; read into the api-server's `AppSettings`): `game_enabled` (false), `game_round_mix` ({close: 3, neighbour: 1, check_or_easy: 1}), `game_deck_size` ({pairs: 20, lineups: 3}), `game_lineup_every` (5), `game_lineup_none_share` (0.25), `game_daily_cap_answers` (25: the server counts answers, not rounds; a pairs round is 5, a line-up round 3, so 25 answers is five rounds), `game_score_band` ([0.25, 0.6]), `game_retire_days` (90), `game_queue_cap_per_day` (10), `game_fresh_device_days` (7), `game_care_threshold` (0.6), `game_care_min_checks` (5).

**The deck job** (`lib/game/deck.ts`, `rebuildDeck()`): pools exactly as spec §4.1; exclusions exactly as §4.2, in this order: visibility (`hiddenPhotoIds`, `catDisplayPhotoIds`, both id-only and batched; **the job never selects from `photos` itself**, because `photos.data` is the whole image), sighting eligibility (`resolved` with `choice in ('suggested','hand_pick','new_cat')`, not `matcherFailed`), the compared-photo rule (C4), `cat_identity` merge retirement, the closeness rule on published positions (`blurPosition`, `lib/blur.ts:33`, the 250 m cell the public payload already uses; a 500 m exact match is at most about 850 m between cell centres, so pool 1 always passes the 1 km rule), open reports (`welfare_reports` where `kind='content'` and `photo_id` matches and `state in ('new','looking')` → `paused`), removed photos (whatever state SYC-44 7.2 adds; until it merges, nothing is "removed"), retired pairs. Private photos (welfare reports, guardians) and cats the public can't see need no rule: photos reach the game only as a cat's display photo or a resolved public sighting's photo, which are public by construction; the plan says so here so nobody rediscovers it. Line-ups per spec §4.4 with random candidate order fixed at build time, the hand-picked cat replacing the lowest-scoring candidate, `new_cat` "None" cases marked weak, and the `game_lineup_none_share` target. Cap at a few hundred live pairs, ordered by usefulness (unanswered close calls, then pairs with one or two counted judgements, then neighbours).

**Triggers** (C10), the mail-drain pattern: `POST /api/internal/game/rebuild` on `internalMail.ts`'s token check, called by the existing Cloudflare Worker every six hours (and by a backup step in a workflow, like `mail-drain.yml`); an opportunistic fallback middleware that claims the current `bucket` row; `pg_try_advisory_xact_lock` around a run so two servers never build at once; every team decision, hide, restore and removal route sets `dirty = true` on the current bucket and returns at once (no rebuild in a team member's click); a run that finishes with `dirty` set runs once more. `db-ops rebuild-game-deck` is a workflow input that calls the internal route with the token from secrets, not a database CLI (the job needs api-server code).

**Deletion** (spec §9): `lib/severPerson.ts` gains three statements: null `game_judgements.device_id` and `game_lineup_answers.device_id` for the device, and delete the `game_devices` row. The world fixture used by the device-id scan (`routes/me.delete.test.ts:324-346`, `severPerson.test.ts`) gets one row in each game table, so the scan covers them from this PR on.

**Tests:** T2-1 each pool produces only pairs that satisfy every §4.2 rule (one test per rule, each with a **mutation probe** that disables the rule and shows the forbidden pair appear); T2-2 a hidden sighting photo never enters any pool; T2-3 a removed photo never enters (written against 7.2's state; skipped with a named reason until 7.2 merges, never deleted); T2-4 a pair whose compared photo isn't the cat's display photo is dropped, not swapped; T2-5 two cats merged through `cat_identity` retire their pair, and an unmerge doesn't revive it; T2-6 the closeness rule: two cats with exact positions 400 m apart but published cells 1.2 km apart produce **no** pair; T2-7 a pair with an open content report is paused and returns when the report leaves `new`/`looking`; T2-8 line-up candidate order is random and not score-ordered (statistical over 200 builds); T2-8b the hand-picked cat is in the line-up; T2-8c a line-up with any failing photo is dropped whole; T2-9 the job is idempotent; T2-10 two concurrent runs, one works (advisory lock); T2-26 a decision during a run sets `dirty` and causes exactly one more run; T2-27 two servers at different times, one build per bucket; T2-28 usefulness ordering; T2-29 the deck job issues no query that selects `photos.data` (structural guard on the query log); T2-30 `severPerson` unlinks judgements and line-up answers and deletes the device row, and the device-id scan passes with the fixture rows; T2-31 a pair with one unlinked judgement still counts it (small call 11).

### PR 2.2: the routes and the decision engine (spec §4.3, §4.5, §6, §8; C7, C11, C13)

- `GET /api/game/deck` (device secret; bucket `game_deck`, one per device per hour; `404` while `game_enabled` is false): the next 20 pairs and 3 line-ups this device hasn't answered **and whose line-up this device hasn't answered** (small call 10), filtered **again** through `hiddenPhotoIds` at request time, with photo addresses from `publicPhotoUrl` plus `?w=720`, public names and the reveal lines. Carries **no** vote counts, no flags derived from them, no decided answer for a check pair, no score, no position. Records `last_deck_fetched_at`.
- `POST /api/game/answers` (device secret; bucket `game_answers`, 60 per device per hour; batch of up to 50; always `200`): per answer, **Concurrency:** one transaction: `select … from game_pairs where id = $1 for update`; `insert into game_judgements … on conflict do nothing` (first wins); if nothing was inserted, `{ accepted: false, reason: 'duplicate' }`; if the pair is retired or paused, `{ accepted: false, reason }`; the daily cap is counted by the answer's **`answered_at` Athens day** (`athensDay`, `lib/resolve.ts:829`, exported), so a day's play synced tomorrow lands on the day it was played; over the cap → `{ accepted: false, reason: 'daily_cap' }`; otherwise read the counts (rows, not distinct devices), run `decideGamePair`, write the status, and on a decision credit with `update game_judgements set credited_at = now() where pair_id = $1 and answer = $2 and counted and credited_at is null` (idempotent by construction) and copy the audit fields onto the pair; commit. `game_devices` counters are atomic `set n = n + 1`. The response carries `settledSinceLastSync` (C13) and the device's `pairsDecided`.
- `GET /api/game/deck/check?ids=` (device secret; bucket `game_check`, 12 per device per hour; at most 100 ids): which of these photo ids are now hidden or removed.
- `lib/game/decide.ts`: the pure function for spec §6.1's table. `lib/game/care.ts`: the care score; on a drop below the threshold, re-mark the device's counted judgements on live pairs uncounted **and re-run `decideGamePair` on each of those pairs, in id order, in the same transaction**.
- Settings to the phone (C11): `gameEnabled` in `GET /api/app-settings`, the OpenAPI schema, the regenerated client and `StoredSettings`.
- **Tests:** T2-11 every row of the §6.1 state table, one test each, including 2 Same + 1 Can't tell (still live), 3 Can't tell + 1 Same (nobody can tell), 3–2 (queue), 4–1 (decided), 90 days (undecided), newest-last at the queue cap; T2-12 uncounted judgements never move a pair and never contest it; T2-13 a device below 60 % after five checks is uncounted, its live judgements re-marked and their pairs re-decided (a contested pair that becomes 3–0 decides; one that falls to 1 goes back to live), decided pairs untouched; T2-13b Can't tell on a check pair changes the care score by nothing; T2-14 first-wins; T2-15 the daily cap by `answered_at` Athens day across the DST change, and a day played offline and synced the next day is accepted; T2-16 a hidden-at-request-time photo is filtered from the deck even before the deck job has run; T2-17 `404` while the switch is off; T2-18 a decision where every counted device is under seven days old sets `fresh_devices`; T2-19 the queue cap of ten contested rows a day; T2-20 **mutation probes** on the decision function: flip "no counted disagreement" to "majority" and show the 2–1 case wrongly decides; T2-21 the device secret is required on all three routes; T2-22 **structural guard:** the deck and answers response types contain no `lat`, `lng`, `score`, `confidence`, vote count, settled flag or `sighting_matches` field (a type-level test on the OpenAPI schema plus a snapshot), and a check pair's item carries no decided answer; T2-23 twenty parallel third votes: one decision, every voter credited exactly once; T2-24 a Same and a Different racing for the third and fourth slots end in a state the table allows; T2-25 a retry of the deciding answer credits nothing new; T2-32 a line-up answer writes one row and derives one Same judgement, "None" derives three Different; T2-33 a pair from a line-up this device answered is never served to it as a pair; T2-34 the per-device buckets refuse the request over the limit.

## Slice 3: photos

### PR 3.1: the size parameter (spec §4.3; C2, C12; Decision 3)

- `GET /api/photos/:id?w=720`: on SYC-404's stored small version if merged, else `sharp` resize on request from the stored bytes with an in-memory LRU (about 200 entries) of resized bytes; JPEG; the same `private, max-age=31536000, immutable` headers as the full photo. Only `w = 720` is honoured (one size, so a cache can't be asked for a thousand variants); any other value serves the full photo. A hidden or removed photo answers exactly as the full route does after 7.2 (`404` / `410`). Game photo fetches count against `photoLimiter` like any other; the phone downloads a deck **four photos at a time**, so one deck is about 58 requests spread over the download rather than a burst.
- Merges **after SYC-44 7.2** and rebases over it (both edit `routes/photos.ts`).
- **Tests:** T3-1 the resized bytes are ≤ 720 px on the long side; T3-2 a hidden photo at `?w=720` is `404`, a removed one `410`; T3-3 an unknown `w` serves the full photo; T3-4 the header test from SYC-44 still passes on the resized response; T3-5 the LRU serves the second request without resizing (spy on `sharp`).

## Slice 4: the app

### PR 4.1: the deck store, the pairs round, the Home card, the reward line and the count (spec §3.1, §3.2, §3.4, §3.5, §3.7, §9; C6, C12)

- `lib/gameDeck.ts`: fetch; photos stored through the pending-photo adapters (`expo-file-system` on native; `webPhotoStore` IndexedDB on web; where `durablePhotos()` says the browser can't keep them, the game plays **online only** and says so on the card); an index in AsyncStorage (ids and names, no photos); a deck older than 24 h is **replaced when there's signal and never discarded while offline**; refill when under half full, deduped by pair id against the current deck and the unsent queue; a refill refused with `429` inside the hour is simply skipped (the phone plays what it holds); wipe on "Delete my data".
- `app/game.tsx`: the round (five pairs), the reveal (names; the one line for a close call; never a number, never the team's answer), the end-of-round figure (the decided count from the last sync, plus "n waiting to send"), the empty-deck state, the daily-cap state (the phone enforces its own cap offline by `answered_at` Athens day), "Something wrong with this photo?" → the report-an-issue flow with the photo id, **rendered only when the app build has SYC-44 6.2's screen**.
- Home card (`index.tsx`, below nearby cats, one row) with the count; the profile line "Counted when three people agree"; the reward-screen line (`review.tsx`, bottom, only on the screen a live send opened, never on a queued review). All read `gameEnabled` from stored settings and `pairsDecided` from the profile.
- Strings in en/el/fr as a **second flagged pack** for SYC-4's native review (the launch pack froze on 22 Oct).
- **Tests:** T4-1 the card, line and profile line render only when `gameEnabled` is true in stored settings; T4-2 a round shows exactly the deck's next five unanswered pairs; T4-3 the reveal never renders a number, and on a check pair renders names only; T4-4 the empty-deck and daily-cap copy; T4-5 the report link carries the photo id and is absent without 6.2; T4-6 "Delete my data" wipes the deck files, the index, the queue and the tally; T4-7 the deck is not written into the cat-alogue cache key (structural guard); T4-17 a non-durable browser gets online-only play; T4-18 a deck older than 24 h is still playable offline and replaced on the next fetch; T4-19 a refill never serves a pair already in the deck or the unsent queue; T4-20 the download runs four at a time.

### PR 4.2: line-ups (spec §3.3, §4.4)

- The line-up round (three), random order as delivered, the reveal with the spotter's choice, "None of them".
- **Tests:** T4-8 one tap sends one `lineup_answer`, never three pair judgements; T4-9 "None" sends one answer with `chosen: null`; T4-10 the rendered order equals the delivered order.

### PR 4.3: the offline queue and the deck check (spec §9; C6)

- `GameQueueContext` on `createQueueStore<PendingGameAnswer>` with its own storage key; `withLock` / `ifLockFree` as the report queue; sync on the same triggers (timer, NetInfo, AppState); `accepted: false` → done; network failure → retry; **permanent only on a 4xx other than 401, 403, 408, 428 and 429**, copied from `reportQueue.ts:187-189`; a `410 IDENTITY_DELETED` goes through the delete-my-data path; items older than 30 days dropped. Registered in `DeleteMyDataContext` with `pauseSync` / `resumeSync` and `wipeGame` so no answer is sent during deletion.
- On every launch with signal: `GET /api/game/deck/check` for the deck's photo ids, **with a 3-second timeout**; items reported hidden or removed are deleted before any card renders; if the check times out or fails, the phone plays what it holds and tries again next launch (the server's own request-time filter and the 24 h replacement bound the exposure, as the spec's §9 edge says).
- The provisional tally ("5 answered · 5 waiting to send") and the sync-time "Since last time, n of your pairs were settled" (C13).
- **Tests:** T4-11 an answer saved offline is sent on reconnect in order; T4-12 `accepted: false` clears the item without an error; T4-13 a hidden photo is removed from the local deck on launch before render; T4-14 **mutation probes:** a `409` is permanent, a `401`, `403`, `408`, `428` and `429` retry, a `410 IDENTITY_DELETED` triggers deletion handling; T4-15 the tally counts queued and sent separately and never shows a "decided" number the phone computed; T4-16 no game answer is sent while deletion is in progress; T4-21 two web tabs never send the same answer twice; T4-22 the deck check times out at 3 s and play continues.

## Slice 5: the count and the badges

### PR 5.1: badges and the inbox row (spec §3.4, §8; C1; Decision 1)

- `getProfileStats` (`catHelpers.ts:539`): one indexed count of `game_judgements` where `device_id = $1 and credited_at is not null`, added to `ProfileStats`; `pairsDecided` in the profile payload and the OpenAPI spec (orval regenerated).
- `badges.ts`: `sharp_eyes` (10), `cat_detective` (50); strings in three languages.
- Under Decision 1 A: migration `notifications_kind` (table `notifications`) as described there; the badge row written **by the answers route** when a decision first makes a badge true for a device (checked in the decision transaction, not on profile read); `GET /notifications/:deviceId` returns badge rows only with `?kinds=cat_update,badge` (left join); the app's inbox renders `badge_${id}` through `t()` with no cat navigation; the unread count and mark-read routes count badge rows like any other.
- **Tests:** T5-1 credit only to counted, deciding-side judgements in pools 1–2, and a **structural guard** that no game module imports the points writer (`profiles.points` never changes); T5-2 a later team override leaves credit in place; T5-3 the two badges from stats; T5-4 the partial unique index: one row per badge per device, ever; T5-5 an old-style request (no `kinds`) gets no badge rows and the same shape as today; T5-6 `getProfileStats` adds exactly one query; T5-7 the fan-out, round-up insert, read-all and mark-read tests still pass; T5-8 the rollback with a badge row present (deletes first, then restores `NOT NULL`); T5-9 `severPerson` deletes badge rows with the rest.

## Slice 6: the team's side

### PR 6.1: Matching to check, and seed mode (spec §7.2; C8, C10)

- `routes/teamMatching.ts` + `lib/teamPages/matchingPage.ts`: `/api/team/matching` (new `NavKey` `matching`, a `NAV` entry "Matching to check", with the layout tests updated), under `review_photo_pairs`. Sections in the spec's row order plus **"Decided by new phones"** (`fresh_devices` and not reviewed): the team confirms or overturns, which sets `fresh_reviewed_at/by`. Each row: both photos (via `publicPhotoUrl`), public names, the players' counts, three actions (decide Same / decide Different / ask for a better photo), "use as a check", "retire". A cat-level row ("Players think Mikis and Ermis are one cat" / "this sighting isn't Mikis") appears only with **two decided photo pairs** saying so, or one plus the team's look. Decisions go through one function `decidePairAsTeam(pairId, answer, person, { useAsCheck, note })` that writes `decided_by`, the person, the note, sets the deck job's dirty flag, and nothing else. `?mode=seed` sources random pool-2 and pool-4 pairs instead.
- Posts use `formRoute` (`teamCorrections.ts:201`): Origin, session and capability, then body; 303 back; 400 names fields only. Rows added to `team.walk.test.ts`.
- **Tests:** T6-1 the page needs `review_photo_pairs`; T6-2 a decision retires the pair unless "use as a check"; T6-3 a check pair stays live and is never credited; T6-4 **structural guard:** the game's team route module and `lib/game/*` import no writer of `cats`, `cat_identity` or `sightings`; T6-5 seed mode shows only pools 2 and 4; T6-6 the page shows no position and no score (snapshot); T6-7a the sighting-vs-cat row needs two decided Different pairs; T6-7b the two-cats row needs two decided Same pairs; T6-12 the fresh-devices section and review action; T6-13 "needs_photo" is written by "ask for a better photo" and by the nobody-can-tell outcome.

### PR 6.2: the cat guardian's section (spec §6.3, §7.2; C8, C9)

- On `/team/my/colonies`: "Matching to check in your colonies": rows where **both** cats are in her colonies (`catTarget` for each), with the three actions posting to `POST /api/team/matching/:pairId/decide` under `requireTeam('decide_photo_pair', { target })` where the target resolver reads the pair row and returns **both** colonies (every target must pass); rows with one cat outside show read-only with "Syros Cats decide this one"; for that outside cat she sees exactly what the public sees. The team holds `decide_photo_pair` island-wide, so the same route serves the team page's buttons. Strings through `tr(lang, …)` in the guardian string tables. Rows added to `team.walk.test.ts`.
- **Tests:** T6-8 both-cats rule on the page and on the POST; T6-9 one-cat-outside is read-only and the POST is refused; T6-10 a cat in no colony never appears for her; T6-11 her decision is recorded with her person id and `decided_by = 'guardian'`; T6-14 the POST's target comes from the pair row and a forged colony in the body changes nothing (**mutation probe**).

## Slice 7: the export

### PR 7.1: `db-ops export-game-labels` (spec §7.1)

- A `@workspace/db` CLI (plain SQL, no api-server code): decided pairs from pools 1–2, **excluding `fresh_devices` rows not yet reviewed**, with photo ids, answer, decided_by, counted-device count, youngest device age and lowest care at decision, score band, model version, source sighting. A new `db-ops.yml` input and an artefact step (7-day retention, visible to anyone with repository access; photo ids and no device ids, so acceptable).
- **Tests:** T7-1 excludes pools 3–4, undecided, retired; T7-2 excludes fresh-device rows until reviewed, includes them after; T7-3 contains no device ids; T7-4 the CLI runs against the scratch database in CI.

---

## Where each of the spec's rules is enforced

| Rule | Where | Test |
|---|---|---|
| Hidden, removed, private photos never shown | deck job (T2-2, T2-3) **and** deck route at request time (T2-16) **and** phone deck check (T4-13, T4-22) | three layers, each tested |
| Never a position, score, area word, vote count or settled flag | the response-type structural guard (T2-22); the team page snapshot (T6-6); the reveal renders no number (T4-3) | by construction, not by today's shape |
| Closeness no finer than the public map | deck job on `blurPosition` (T2-6) | |
| One answer per device per pair; line-up pairs not re-served | unique index + first-wins (T2-14); deck route exclusion (T2-33) | |
| Line-up never manufactures "Different" | the phone sends one choice (T4-8); the server derives per small call 10 (T2-32) | |
| The §6.1 table, under concurrency | `decideGamePair` in one locked transaction (T2-11, T2-20, T2-23–25) | |
| Credit once, never removed | `credited_at is null` guard (T2-25); override leaves credit (T5-2) | |
| Fresh devices out of the test set until reviewed | export excludes (T7-2); team review action (T6-12) | |
| No cat changed by the game | structural guard on `lib/game/*` and the team route (T6-4) | |
| No points, no leaderboard | structural guard on the points writer (T5-1) | |
| Deletion unlinks, never deletes judgements | `severPerson` (T2-30, T2-31, T5-9); phone wipe and pause (T4-6, T4-16) | |
| The switch | `404` and no cards while off (T2-17, T4-1) | |

## Where each spec test is built

The spec names no numbered tests; its rules are mapped above and its §16 review-outcome items are each covered by: photo source (T2-2–T2-4, T2-16), no leak (T2-22, T6-6), line-up storage (T2-32, T4-8), trust table (T2-11–T2-13), check pairs (T6-3, T4-3), fresh devices (T2-18, T6-12, T7-2), stuck states (T2-11), test-set audit fields (T7-1–T7-3), stale deck (T4-13, T4-18, T4-22), queue and badges (T4-11–T4-16, T5-1–T5-9), dashboard queue (T6-1–T6-14), count farming (T5-1, T2-13), report link (T4-5), ten-nearest/top-three (T1-1–T1-4), reveal wording (T4-3), pool 2 colour and positions (T2-1, T2-6), composition (T4-2), per-photo-pair labels (T6-7a/b), thumbnail route (T3-1–T3-5), placement (T4-1), offline wording (§ "What works with no signal").

---

## Rollout

Each production migration: Neon snapshot first, `db-ops migrate` in "ask" mode, publish, probe.

1. **PR 0.1, 1.1** in the first post-launch windows (week of 3 Nov). Migrate (`match_compared_photos`), publish. **Probe:** a real spot writes `compared_photo_ids` and `model_version` (read on Neon).
2. **PRs 2.1, 2.2** the following week; migrate (`game_tables`), publish; add the Worker's six-hourly call. **Probe:** `db-ops rebuild-game-deck` on production and read the pool sizes from the `game_deck_runs` row; `GET /api/game/deck` answers `404` (switch off); `db-ops list-settings` shows the game keys.
3. **PR 3.1** after SYC-44 7.2 is live. **Probe:** `?w=720` on a public photo serves a small JPEG; on a hidden photo `404`.
4. **PRs 4.1, 4.2, 4.3** as app releases: web first; the store track per the launch plan. **The game is not in the first store submission** (its screens, cat photos and report link are what a reviewer inspects; the first submission is the launch app). `game_enabled` stays false until the store build with the game is the minimum supported one. **Probe:** with the switch off, nothing game-related renders on web or native.
5. **PR 5.1** (migrate `notifications_kind`), **6.1**, **6.2**, **7.1**. **Probes:** an old-shape notifications request on production returns the same rows as before; the Matching to check page loads for the team and is refused for a guardian; the export runs on the rehearsal branch.
6. **Seed** (Decision 2): 20–30 check pairs in seed mode.
7. **Switch on** when: pool 1 has at least 100 live close-call pairs (the run row); the check pairs are seeded; SYC-44 6.2 is live (the report link); the Greek and French strings have had native review; the store build with the game is the minimum supported. `db-ops set-setting game_enabled true`. Expected: early December.
8. **First SYC-56 report** when the export has 200 close-call labels.

Rollback: `game_enabled false` hides everything at once with no release. Each migration has its rollback block; `game_tables` and `match_compared_photos` are additive and can stay; `notifications_kind`'s rollback deletes badge rows first.

---

## Where this collides with other work

- **SYC-44** (report an issue): PR 4.1's report link needs 6.2; PR 3.1 and the "removed" state need 7.2; both are after this plan's first PRs and before switch-on.
- **SYC-209, SYC-53, SYC-2, SYC-44 migrations**: numbers claimed at generation time (small call 3).
- **SYC-404 / SYC-403**: Decision 3.
- **SYC-303** (hidden main photo sent to the matcher): PR 1.1 records whatever photo is sent, so when SYC-303 changes which photo that is, the record follows.
- **SYC-163** (team chooses a main photo): retires the C4 fallback.
- **SYC-150**: the "re-file" button is greyed with "not yet" until it ships.
- **SYC-59**: reads `decided_note = 'same_cat_for_merge'`.
- **SYC-383**: the game keys appear on the dashboard settings page when it's built; until then `db-ops set-setting`.
- **`review.tsx`** is edited by the match-wait PR 2 in the 26 Oct publish; PR 4.1 rebases over it. **`routes/photos.ts`** is edited by SYC-44 7.2; PR 3.1 rebases over it.
- **The one-instance pin** is lifted on 26 Oct; the deck job is built for more than one server from the start (C10).

## What this plan does not do

- Build a merge (SYC-59) or a re-file action (SYC-150).
- Tune the 0.4 threshold (SYC-56, once it has labels).
- Add any device-marking for guardians in the app (D4 accepted as written).
- Show a provisional "likely" count, or any other player's vote, on the phone (D8 narrowing accepted; C13).
- Add a settings page for the game keys (SYC-383).
- Put the game in the first store submission (Rollout step 4).

## What works with no signal, precisely

- Playing the deck the phone already holds, pairs and line-ups, with the full reveal (names and the one line; never "that settles it").
- Saving answers; they are sent in order when signal returns, and the server counts them on the day they were played.
- A provisional tally of answered and waiting.
- **Not** offline: fetching a new deck; the decided count; badges; the "since last time" line; removing a photo hidden since the last launch with signal (it goes at the next launch with signal, or stays until then).
- In a browser that can't keep photos (`durablePhotos()` false): online only, said on the card.
- The dashboard doesn't work offline, as today.

## Model delegation

Session model for this plan: **Opus 5.5** (inherited by the chip). For the build, each PR goes to the cheapest tier that can do it, with the reason stated wherever it goes up.

| PR | Model | Why this tier | Assurance |
|---|---|---|---|
| 0.1 | Haiku | Copying approved rows word for word; the catalogue test checks them | Session model diffs against the spec |
| 1.1 | Sonnet | One additive migration and one upsert change on a well-tested path | T1-1…T1-4 with the mutation probe; Opus spot review of the dedupe-hit path |
| 2.1 deck job and deletion | **Opus** | *Escalated:* every privacy rule is enforced here first, and a missed exclusion is a silent privacy failure with every test green; `severPerson` is deletion | T2-1…T2-10, T2-26…T2-31, one mutation probe per rule; **independent Opus review in its own worktree** told to get a hidden or far-apart pair into a deck |
| 2.2 routes and engine | **Opus** | *Escalated (review finding 1):* the locked transaction, the credit guard and the re-decide-on-drop are the whole integrity of the labels, and a race is silent | T2-11…T2-25, T2-32…T2-34 with mutation probes; **independent Opus review told to double-credit a voter or decide a pair twice** |
| 3.1 | Sonnet | One route parameter on an existing library | T3-1…T3-5 |
| 4.1, 4.2 | Sonnet, with an independent Sonnet review | Screen work on existing patterns; but the phone holds copies of photos that may be hidden later | T4-1…T4-10, T4-17…T4-20; **review told to show a hidden photo after a hide**; browser check at 390 px and desktop, en/el/fr |
| 4.3 | Sonnet, with an independent Sonnet review | Follows the report queue's pattern exactly; the deck check and deletion pause are privacy | T4-11…T4-16, T4-21, T4-22 with mutation probes |
| 5.1 | Sonnet, Opus spot review | Touches `getProfileStats` (every resolve), the notifications table (every inbox request) and deletion | T5-1…T5-9 |
| 6.1 | Sonnet | Server-rendered HTML following `teamCorrections.ts` | T6-1…T6-7, T6-12, T6-13; structural guard T6-4 read by the session model |
| 6.2 | Sonnet, **independent Opus review** | *Escalated review:* an authorisation change across two colonies; a flaw lets a guardian decide for another colony | T6-8…T6-11, T6-14; review told to decide a pair outside her colony |
| 7.1 | Haiku | A query and a CSV | T7-1…T7-4 |
| Strings and fixtures | Haiku | Mechanical | i18n parity test |
| Adversarial review of each PR before merge | Sonnet in its own worktree; Opus for 2.1, 2.2 and 6.2 | Equal tier to the builder or higher where named | Findings folded in and listed on each PR |
| Production steps (migrations, Worker, seed, switch) | Session model | Production state, not delegated | The rollout probes |

## Crash-proofing for the build

Each PR is built in its own worktree off fresh `origin/main`. **Commit after each numbered item**, with a `CHECKPOINT.md` (what's done, what's next) updated after each commit and deleted before the PR is marked ready. **Every agent prompt restates "commit after each item"** word for word. Agents don't spawn nested agents. If a session stops mid-PR, it comments where it got to on the PR's Linear ticket before stopping.

## Linear

**Tickets this plan builds:**

| PR | Ticket |
|---|---|
| 0.1 | SYC-409 |
| 1.1 | SYC-408 |
| 2.1, 2.2, 3.1, 4.x, 5.1, 6.x, 7.1 | SYC-402 (build sub-issues to be created at build time, one per PR, if Samuel wants them tracked separately) |

**Filed by this plan:** none new. **Comments added (no state changes):** SYC-404 (PR 3.1 and Decision 3), SYC-150 (the re-file button), SYC-59 (`decided_note`). **To add at build time:** SYC-44 (6.2 and 7.2 are dependencies), SYC-56 (the export's shape), SYC-383 (the game keys), SYC-163 (retires the C4 fallback).

## Still needs Samuel

1. Decisions 1, 2 and 3.
2. "Ask" mode and a Neon snapshot for each production migration (1.1, 2.1, 5.1).
3. Thirty minutes in seed mode before switch-on (Decision 2 A).
4. The Cloudflare Worker's six-hourly call (Claude adds it through the Cloudflare API, as for the mail drain; Samuel confirms).
5. Store builds for 4.x on the November store track, after the first submission.

---

## Review outcome

Independent adversarial review by a Sonnet subagent of draft 1 (`syc-402-matching-game-review.md`): 3 blockers, 12 majors, 5 minors, nits. Verdict "approve with fixes". All addressed in this draft:

| # | Finding | What changed |
|---|---|---|
| 1 | No concurrency design for decisions and credit | PR 2.2 "Concurrency": row lock, `on conflict do nothing`, idempotent credit, atomic counters; T2-23–T2-25; engine built and reviewed by Opus |
| 2 | Missing columns; no line-up data model; distinct-id counting | PR 2.1 table of extra columns (`credited_at`, `answered_at`, audit fields at decision, `from_lineup_id`, `first_seen_at`); small calls 10 and 11; T2-31–T2-33 |
| 3 | SYC-44 work assumed on `main` | C12; dependencies in the order table; report link gated on 6.2; 3.1 after 7.2; T2-3 skipped with a reason until 7.2 |
| 4 | C10 false; lock and triggers don't survive several servers | C10 rewritten; PR 2.1 "Triggers": internal route + Worker, bucket claim, advisory lock, dirty flag; T2-26, T2-27; id-only queries (T2-29) |
| 5 | Inbox change unsafe for old apps; wrong table name; no translation | Decision 1 rewritten (`notifications_kind`, `kinds` opt-in, `badge_id`, partial unique index, rollback order); PR 5.1; T5-4, T5-5, T5-7–T5-9 |
| 6 | Delete my data incomplete | PR 2.1 "Deletion" (`severPerson`, fixture rows); PR 4.3 registration in `DeleteMyDataContext`; T2-30, T4-6, T4-16 |
| 7 | Offline stores, error rule, cap, refill, expiry | C6 corrected; PR 4.1 storage and refill rules; PR 4.3 lock and error rules copied from the report queue; `answered_at` and cap by play day; T4-14, T4-17–T4-22, T2-15 |
| 8 | `revealsSettled` leaks votes | Dropped; C13 and small call 8 move the line to sync time; T2-22 forbids flags |
| 9 | Spec rules dropped (fresh devices, re-decide on drop, check-pair reveal, count display, two-pair rows, notes, §4.4, by-construction note) | `fresh_reviewed_*` and the team section (T6-12, T7-2); re-decide in `care.ts` (T2-13); T2-22/T4-3; count on Home, profile and round end in PR 4.1; T6-7a/b; small call 6; T2-8b/c and `game_lineup_none_share`; the by-construction sentence in PR 2.1 |
| 10 | Settings plumbing and db-ops | C11 corrected; `shape.ts`, `/app-settings`, OpenAPI, `StoredSettings` named; `rebuild-game-deck` as a workflow call to the internal route; export as a `@workspace/db` CLI with an artefact step and stated retention |
| 11 | View without a migration | Small call 5: no view; the export is a query |
| 12 | Size parameter cost; shared IP limit; unlimited routes | PR 3.1: LRU, one size, four-at-a-time download; PR 2.2: three per-device buckets, id cap on the check route; T2-34, T3-5 |
| 13 | Guardian side: wrong function, `own` route, walk, nav, localisation | C8, C9 corrected (`catTarget`, `currentColonyOf`); PR 6.2's own POST under the capability with both targets from the pair row; walk rows; `NavKey`/`NAV`; `tr(lang)`; T6-14 |
| 14 | Delegation and assurance short of the standard | Opus for 2.1 and 2.2 builds, Opus reviews for 2.1, 2.2, 6.2; independent reviews for 4.1–4.3; the structural-guard rows in "Where each rule is enforced"; a spec-test map; probes and snapshots per rollout step |
| 15 | Rollout and launch-plan interactions | 3.1 after 7.2; snapshots per migration; the game out of the first store submission; strings as a second flagged pack |
| 16 | C4 fallback reads a change nothing records | C4 rewritten: compared = `primaryPhotoId`, kept only if it is the display photo; retired by SYC-163 |
| 17 | Paused pairs: spec inconsistency | C14 and small call 9 |
| 18 | Decisions 1 and 3 offered rejected options | Both rewritten with real alternatives only |
| 19 | Rules with no named test | T2-28 (usefulness), T2-11 (newest last), T2-33 (delivered pairs not re-served), T4-19 (refill), T4-22 (check timeout) |
| 20 | Plain English | "In plain English" rewritten with one-clause explanations; a "Words used" paragraph at the top |
| 21 | Nits | `athensDay` from `lib/resolve.ts`; `sharp`'s real users; `notifications`; `game_lineup_every`; OpenAPI (small call 13); unmerge (small call 12) |
