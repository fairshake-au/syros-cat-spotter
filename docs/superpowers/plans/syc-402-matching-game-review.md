# Review: SYC-402 matching-game implementation plan

**Target:** `docs/superpowers/plans/syc-402-matching-game.md` (312 lines), branch `claude/bold-bardeen-uveanq` at `a166062` (`origin/main` `2d6e636` plus the plan commit).
**Reviewer:** independent adversarial pass (Sonnet), read-only, no sub-agents.
**Date:** 16 October 2026.
**Spec carried out:** `docs/specs/matching-game.md`, approved 16 October. I did not reopen its decisions (SYC402-D1 to D8). I tested only whether the plan carries it out.

> **How each finding was handled** is recorded in the plan's "Review outcome" section (draft 2 of `syc-402-matching-game.md`). The text below is the reviewer's, unedited.

**What I checked.** I read the plan, the spec, the spec's review, and the SYC-44 plan and its review (the format and standard). I then checked the plan's "exists today" claims C1–C11 and every PR section against the code on this branch. The launch plan was read from `origin/claude/xenodochial-zhukovsky-df315f`. I could not check the Linear tickets (SYC-408, SYC-409, SYC-404) from here.

---

## Summary

The plan is well structured and follows the SYC-44 plan's shape. Several of its "exists today" claims are true:

- `notifications.cat_update_id` is `NOT NULL`.
- There is no resizing on `GET /photos/:id`.
- `sighting_matches` has neither new field.
- The catalogue test parses the spec table.
- `rankedForRecord` keeps the top 3 at ≥ 0.1.
- `app_settings` exists.
- `createQueueStore` is generic.

No canonical-fact breach (CLAUDE.md) turned up. There is no "colony carer" or "snapper", no built-versus-proposed split, and the offline section is precise.

It is not buildable as written. It has **3 blockers and 12 majors**. The blockers are:

1. The decision and credit path has no concurrency design, and credit can never be taken back.
2. The tables in PR 2.1 lack columns that PRs 2.2, 5.1 and 7.1 need, and line-up answers have no data model.
3. Several "exists today" claims describe SYC-44 work that is not on `main` (the report flow, the 410 for a removed photo, the `issue_reports` table).

Most of the rest are places where the plan names the wrong mechanism (the round-up "timer", `placeCats`, the Cache API) or leaves out a spec rule (fresh devices kept out of the test set, wiping the data on the server).

## Findings

| # | Finding | Severity |
|---|---|---|
| 1 | The decision and credit path has no transaction, row lock or idempotency design | Blocker |
| 2 | PR 2.1's tables lack columns later PRs rely on; line-up answers have no data model | Blocker |
| 3 | Dependencies on SYC-44 work that is not on `main`; the `issue_reports` table does not exist | Blocker |
| 4 | C10 is false: the round-up is not an in-process timer. The deck-job lock and triggers don't survive more than one instance | Major |
| 5 | The inbox change is unsafe for old apps, renders in the wrong language, and the migration is mis-named | Major |
| 6 | "Delete my data" is incomplete on both sides (`severPerson.ts` and the phone) | Major |
| 7 | Offline design disagrees with the app's real stores; the sync rule for errors is wrong; the daily cap can discard honest answers | Major |
| 8 | `revealsSettled` is a prediction made on the server and shown on the phone offline; it leaks other players' votes | Major |
| 9 | Spec rules dropped or weakened (§6.4 fresh devices, §6.2 re-marking, check-pair reveal, §3.4 and §3.2 count display) | Major |
| 10 | Settings plumbing and `db-ops` commands are described as one-liners and are not | Major |
| 11 | PR 7.1 defines a view but lists no migration | Major |
| 12 | The size parameter: no server cache, shared IP photo limit, `select *` of base64, and routes with no limiter | Major |
| 13 | Guardian side: wrong function named in C9, `own` route without a capability, route walk, localisation | Major |
| 14 | Model delegation and assurance fall short of the SYC-44 standard | Major |
| 15 | Rollout and launch plan interactions | Minor |
| 16 | The C4 fallback uses a "last main-photo change" that nothing records | Minor |
| 17 | Spec inconsistency on paused pairs, resolved silently | Minor |
| 18 | Decisions 1 and 3 offer options that reopen approved spec rules | Minor |
| 19 | Spec rules with no named test | Minor |
| 20 | Plain English | Minor |
| 21 | Nits and mis-attributions | Nit |

---

## Blockers

### 1. The decision and credit path has no concurrency design (PR 2.2, spec §6.1, §8)

**What the plan says.** The answers route inserts "with `counted` from the device's care state at that moment; then `decideGamePair` for the pair; on a decision, credit (§8) and the badge check." It names a unique index and first-wins. It names no transaction, no lock on the pair row, and no idempotency for the credit.

**What is true.** Nothing else in the codebase makes this safe by default. `routes/sightings.ts` and `lib/colonyCats.ts:50` both lock first (`for update`, cats in id order). `photoVisibility.ts` locks the photo row before writing.

Two failure cases:

- **Two third votes at once.** The pair holds 2 counted Same. Two different devices send Same at the same moment. Under READ COMMITTED each transaction sees its own insert plus the two committed rows, so S = 3 for both. Both decide the pair, and the two earlier voters are credited twice.
- **A voter in between.** Call the first transaction A and the second B. A inserts and reads S = 3, then decides. B inserts a Different and reads D = 1, S = 2, so it calls the pair contested. A pair can end up decided and contested at once, or a 3–1 can be read as a decision.

Credit is "never removed" (§8), and the count "never goes down". So a wrong credit cannot be repaired afterwards.

The same problem applies to the counters. `game_devices` ("check pairs seen", "rounds today") needs atomic `UPDATE … SET n = n + 1`. The care-score re-marking runs on top of live decisions.

Sync retries are mostly covered by first-wins. But a retry after a lost reply returns `accepted:false`. The phone then treats the answer as done, which is correct, but the plan never says that the credit step must be a no-op the second time (`credited_at is null` guard).

**Fix.** Add a "Concurrency" paragraph to PR 2.2:

1. One transaction per answer: lock the `game_pairs` row (`select … for update`), insert the judgement (`on conflict do nothing`), read the counts, run `decideGamePair`, write status and credit, commit.
2. Credit as `update game_judgements set credited_at = now() where … and credited_at is null`.
3. `game_devices` counters as atomic updates.
4. Tests:
   - T2-23: twenty parallel third votes, one decision, credit exactly once.
   - T2-24: a Same and a Different racing for the pair's 3rd/4th slot, ending in a state the table allows.
   - T2-25: a retry of the deciding answer credits nothing new.
5. Give the engine review to Opus in a separate worktree, told to double-credit a voter (see finding 14).

### 2. PR 2.1's tables don't hold what later PRs need; line-up answers have no data model (spec §10.1, §3.3)

**What the plan says.** PR 2.1 builds "exactly the columns in spec §10.1 plus `decided_note`". PR 5.1 counts `game_judgements.credited_at IS NOT NULL`. PR 7.1's view carries the fresh-devices flag and the youngest device age. PR 5.1's only migration is `inbox_items`.

**What is true.**

- **`credited_at` missing.** Spec §10.1's list for `game_judgements` has no `credited_at`. No migration in the plan adds it. PR 5.1 cannot be built, and the credit written in 2.2 has nowhere to go. Because 2.2 ships before 5.1 (order table), "badge check (PR 5.1)" is a call into code that doesn't exist yet.
- **Device age has no source.** `youngest device age` is needed for the §6.4 flag. `game_devices` per the spec has no first-seen date. The only source is `device_credentials.created_at` (`lib/db/src/schema/devices.ts`). Once a device is deleted, that age is gone. So the age must be copied onto the pair or judgement at decision time. The plan doesn't say where.
- **Line-up answers.** A line-up tap writes one `game_lineup_answers` row and "derives" Same (target vs X), or Different ×3 for "None". But `game_judgements.pair_id` needs a `game_pairs` row for each derived pair. Nothing says line-up build creates those pair rows. If it does, those pairs also appear in ordinary pairs rounds. Then the "once per device per pair" rule (unique `(device_id, pair_id)`) means a device that answered a line-up will have its later pairs-round answer silently refused (first-wins). And "None → Different against each" is three judgements: three counted votes from one tap, with no credit rule written down.
- **Counting after unlinking.** `device_id` is nullable "for unlinking". If the engine counts `count(distinct device_id)`, a deleted device's votes collapse into one NULL group, and a live pair can drop out of a decision. The plan must say "count rows, not distinct ids", and add a test (see finding 6).
- **Answer time.** There is no `answered_at` on the answer payload (see finding 7).

**Fix.** List the extra columns in PR 2.1's migration: `game_judgements.credited_at`, `answered_at` (client time, clamped), `game_pairs.fresh_reviewed_at/by`, `decided_note`, and the youngest device age stored at decision time. Add a "Line-up pairs" paragraph:

- Which pair rows are created, in which pool, and whether they are also served as ordinary pairs.
- How a device that answered a line-up is excluded from being asked the same pair.
- That credit for derived judgements follows the same rule (pools 1–2, counted, deciding side).

Add tests that the derived pair is not re-served to the same device, and that "None" credits only on decided pairs.

### 3. "Exists today" claims that describe SYC-44 work not on `main` (C-table, PRs 2.1, 3.1, 4.1)

**What the plan says.**

- Exclusion: "open reports (`issue_reports` with `photo_id` and no outcome)."
- T2-3: "a privacy-removed photo (SYC-246's `remove_photo` state) never enters."
- PR 3.1: "A hidden or removed photo answers exactly as today (`404` / `410`)."
- PR 4.1: "'Something wrong with this photo?' → the existing report flow with the photo id."
- "Every 'exists today' claim names the file it was read in" (header).

**What is true.**

- There is no `issue_reports` table. Migration `0023_issue_reports.sql` creates `issue_digest_runs` and adds columns to `welfare_reports`. An issue is a `welfare_reports` row with `kind = 'content'`, `photo_id` set (`lib/db/src/schema/welfare.ts:49-51, 96`), and open means `state in ('new','looking')`. The plan's wording would send an implementer to a table that doesn't exist.
- `routes/photos.ts` has no 410 anywhere (the file ends at the `Cache-Control` and `send`). There is no `removedAt`, `photo_removal` or removal state in the schema (`grep` finds none). `remove_photo` is only a capability row (`lib/capabilities.ts:92`). The state comes from SYC-44 PR 7.2, scheduled for **Wed 28 Oct** in the launch plan "unless cut" and, if cut, the first week of November. So T2-3 cannot be written, 3.1 has nothing to preserve, and the 24-hour/launch-time deck check for removal (`/game/deck/check`) has no state to check.
- There is no report-an-issue screen or `/api/issues` route on `main` (`artifacts/cat-spotter/app` has `report.tsx`, the cat-in-trouble form only; no `routes/issues*`). SYC-44 PR 5.1 and 6.x are scheduled for 21–23 Oct, and the launch plan says the app's report screen is held back until Turnstile is in the phone apps. So PR 4.1's link and spec §3.7's pausing have no destination yet.
- None of this appears in the "Depends on" column or in "Where this collides with other work".

**Fix.** Add a "Depends on SYC-44" row for PRs 2.1, 3.1 and 4.1:

- Open report = `welfare_reports` where `kind='content'` and `photo_id = X` and `state in ('new','looking')`.
- PR 3.1 adds the `410`/removed behaviour itself if 7.2 has not merged, or waits for it.
- PR 4.1 hides the link until 6.2 has shipped. Switch-on needs 6.2 live, because §3.7 is a spec rule.
- Correct C-table text to say what is and isn't on `main`.

---

## Majors

### 4. C10 is false, and the deck-job lock and triggers don't work with more than one instance (PR 2.1)

**What the plan says.** "The push round-up runs on a timer in-process (`pushRoundupRunsTable`)." The deck job gets "a 6-hour in-process timer with a `game_deck_runs` row for the lock, the same shape as `push_roundup_runs`", plus a call at the end of each team decision, hide, restore and removal route.

**What is true.**

- **No timer.** The round-up has no timer. It has two triggers:
  - An Express middleware, `opportunisticRoundUp` (`lib/sightingRoundUp.ts:213-240`, mounted at `app.ts:85`), runs after any API response in the evening, at most every 5 minutes per server.
  - `POST /api/internal/mail/drain` (`routes/internalMail.ts:62-77`) is called by a Cloudflare Worker every 2 hours and by a GitHub backup workflow (`.github/workflows/mail-drain.yml`).
  The claim "like the round-up" points at a pattern that isn't an in-process timer.
- **Claim row shape.** `push_roundup_runs` is claimed by inserting the Athens **date** as the primary key (`sightingRoundUp.ts:119-123`). That works once a day. A rebuild every 6 hours, after every decision, and on demand cannot use "one row per period wins". Two decisions seconds apart would see the lock held, skip, and the second decision's change would be missing from the deck until the next tick (up to 6 hours). The request-time filter covers hidden photos, but not merges, retired pairs, newly decided pairs or newly removed photos.
- **Launch plan.** It lifts the one-instance pin on **Mon 26 Oct** (`docs/DEPLOYMENT.md:51`; launch plan "more than one server allowed (SYC-105)"). N instances means N timers at different offsets. An autoscaled deployment that scales to zero fires none.
- **Request path cost.** Running the full rebuild inside each team decision/hide/restore request adds the whole job's time to a team member's click.

**Fix.** Follow what the repo already does:

1. Add `POST /api/internal/game/rebuild`, on the same token pattern as `internalMail.ts`, called by the existing Cloudflare Worker. Keep an opportunistic fallback with a time-bucketed claim (bucket = `floor(epoch / 6h)`).
2. Use `pg_try_advisory_xact_lock`, or a `running_since` lease with an expiry, for in-flight runs.
3. Make event triggers set a "dirty" flag (or fire and forget a coalesced run) rather than rebuild in the request. A run that finishes while the flag is set runs once more.
4. Add tests: a decision during a running build triggers a second run (T2-26); two instances at different times, one build per bucket (T2-27).
5. Say in the plan that the deck job's queries must select photo ids only, never `select()` from `photos` (the `data` column is the whole base64 image; the existing helpers `catDisplayPhotoIds`, `hiddenPhotoIds` are id-only and batched, and should be named).

### 5. The inbox change is unsafe for old apps, and the badge text cannot be translated (PR 5.1, Decision 1)

**What the plan says.** The migration "`inbox_items`: `cat_update_id` becomes nullable and the row gains `kind` and `message`." "An old app shows the row with a blank message, so the message is also put in `cat_updates`-shaped fields as a fallback until the app updates." T5-5: "the old inbox renderer tolerates the new row."

**What is true.**

- **Name.** The table is `notifications` (`lib/db/src/schema/notifications.ts:43-51`), not `inbox_items`.
- **The list drops the row.** `GET /notifications/:deviceId` inner-joins `cat_updates` then `cats` (`routes/notifications.ts:124-131`). A badge row with `cat_update_id = NULL` is silently dropped by today's server code, and the route must change to a left join with a different select.
- **Old apps.** The API shape requires `catId`, `catUpdateId`, `catName`, and an `updateType` from `[sighting, desexed, adopted, general]` (`lib/api-spec/openapi.yaml:808-830`). A badge has no cat. The old renderer's tap does `router.push('/cat/[id]', { id: String(n.catId), updateId: String(n.catUpdateId) })` (`app/notifications.tsx:118-123`), so a badge row opens a broken cat screen. The "cat_updates-shaped fallback" cannot be filled with anything true.
- **Translation.** Badge names are translated on the client (`lib/badges.ts` comment; the server has no language for a device). A server-written `message` text would be English for everyone, or need a language the server doesn't hold. Store `badge_id`, and let the app translate it, as it does for the badge pill on `review.tsx`.
- **Other readers.** Other places read or write the table: the fan-out, the round-up insert (`sightingRoundUp.ts:160`), the read-all and mark-read routes, and `severPerson` (step 6). A table whose column becomes nullable needs checks:
  - `kind='cat_update'` requires `cat_update_id`.
  - `kind='badge'` requires `badge_id`.
  - A partial unique index `(device_id, badge_id) where kind='badge'` is what makes T5-4 ("one row per badge per device, ever") true. The plan names no index, and badges are computed on read, never stored, so nothing else prevents a repeat.
- **Rollback.** Rolling back `DROP NOT NULL` fails once a badge row exists. The rollback block must delete badge rows first, then restore `NOT NULL`.

**Fix.** Rewrite Decision 1 A and PR 5.1:

1. Migration `notifications_kind` on table `notifications`, with `kind`, `badge_id`, the checks, the partial unique index, and a rollback that deletes badge rows first.
2. The list route returns badge rows only when the request says it understands them (for example `?kinds=badge`). Old apps never see a row they cannot open.
3. The new app renders `badge_${id}` through `t()` and does not navigate to a cat.
4. Tests: T5-5 becomes "an old-style request gets no badge rows"; add a test for the unique index.

### 6. "Delete my data" is incomplete on both sides (spec §9; PRs 2.1, 4.1, 4.3)

**What the plan says.** T4-6: "'Delete my data' wipes the deck and index." Nothing on the server. Spec §9: judgements are unlinked, `queueStore.wipe()`, and the daily tally are wiped.

**What is true.**

- **Server.** `lib/severPerson.ts` is the one place deletion unlinks a person. Its header says a test that scans every text and jsonb column for the device id (`routes/me.delete.test.ts:324-346`, `severPerson.test.ts`) fails if a table is added that holds the id and the function forgets it. No PR edits `severPerson.ts`. PR 2.1 would turn CI red on that scan. It must (a) null `game_judgements.device_id` and `game_lineup_answers.device_id`, (b) delete the `game_devices` row, and (c) delete the person's badge notifications (already covered by `delete from notifications`). The spec's "decided pairs, labels and other players' counts don't change" needs a test (see finding 2 on counting rows).
- **Phone.** `DeleteMyDataContext.tsx:91-107` builds `wipePhone` from `offline.wipeQueue()`, the recent photos, the waiting-card records and the settings key, plus the report queue only if the person chose to. The plan's `GameQueueContext` is not registered there. Also `pauseSync` (`deleteMyData.ts`) pauses only the sighting queue (`offline.pauseSync`). A game queue that keeps syncing during deletion can send answers under the old id after the server has deleted it (it would get a 410 `IDENTITY_DELETED`). It must pause with the rest. The wipe needs the game queue, the deck store and its index, and the daily tally, not "the deck and index".

**Fix.** Add the server edit to PR 2.1 with a world fixture row so the scan test covers the game tables. Register `GameQueueContext` with `pauseSync`/`resumeSync` and `wipeGame` in `DeleteMyDataContext`. T4-6 covers the queue and the tally, and T4-16 checks a game answer is not sent during deletion.

### 7. Offline: the plan's stores, error rule and cap don't match how the app works (PRs 4.1, 4.3; spec §9)

**What the plan says.** Deck store: "AsyncStorage on native, Cache API + a small index on web". `GameQueueContext` "on the report queue's pattern". "4xx other than 429 → permanent". Daily cap "per Athens day" counted on the server.

**What is true.**

- **Photo storage.** The spec says "Cache API (`offline-queue-on-web.md` sets the pattern)". That document sets **IndexedDB** (`docs/specs/offline-queue-on-web.md:22,74`). The app already has the adapter: `lib/pendingPhotos.ts` writes native files with `expo-file-system` and web photos to IndexedDB through `lib/webPhotoStore.ts`, with a `durablePhotos()` probe for in-app browsers that can't keep them. No code in `artifacts/cat-spotter` uses the Cache API (`caches.`). AsyncStorage holds JSON only; Android's default store is about 6 MB total, so 2–4 MB of photos in it would crowd out the sighting and report queues. The plan should correct this (a plan can correct the spec's citation without reopening its design) and use `FileSystem` and `webPhotoStore`, including a path for browsers where the store isn't durable (play online-only, or not at all).
- **Web locks.** The report queue's pattern includes `withLock(REPORT_QUEUE_LOCK, …)` and `ifLockFree(REPORT_UPLOAD_LOCK, …)` so two tabs don't send twice (`context/ReportQueueContext.tsx:155-165, 206-230`). "Exactly" the report pattern means these, and the plan doesn't mention them.
- **Which errors are permanent.** `reportQueue.ts:187-189` excludes 401, 403, 408, 428 and 429 from "permanent". `offlineQueue.ts:93-134` handles the pre-launch gate's 401 (not permanent) and `device_moved` (kept). The plan's "any 4xx but 429 is permanent" would throw away queued answers on the pre-launch gate's 401 or a `device_moved` 403, and on a 408. The 410 `IDENTITY_DELETED` should go through the delete-my-data path. T4-14 only tests 409 and 429.
- **Cap semantics.** The server cannot see a "round", only answers. `game_daily_cap = 5` and "rounds today" in `game_devices` need defining: rounds reported by the phone, or answers (25?). More important: an offline player who finishes a day's allowance on a flight, and syncs the next day, would have those answers judged against the arrival day (or the cap already used that day) and refused as `accepted:false, reason:'daily_cap'`. The phone treats that as done, so honest answers vanish. The payload needs `answered_at`, the cap counts by answer day (clamped to a sane window), and the phone enforces its own cap offline (the plan doesn't say where).
- **Refill and the hourly limiter.** `GET /api/game/deck` returns "pairs this device hasn't answered". Queued, unsent answers aren't answered yet, so a refill returns pairs the person already played offline. The phone must dedupe against the queue and the current deck by pair id. The hourly limit also means a legitimate refill after a second app open within the hour gets a 429, so the phone needs a rule for that.
- **Expiry.** "Expiry at 24 h" (4.1) must not mean a deck that is no longer playable offline. Spec §9 says a deck over 24 hours is replaced when there is signal. A phone that is offline for a weekend keeps playing what it holds.

**Fix.** Rewrite the PR 4.1 storage sentence (FileSystem on native, `webPhotoStore` on web, non-durable fallback). Copy the report queue's lock and permanent-error rules, and write them out. Add `answeredAt`, define the cap, add a pair-id dedupe rule, and a test for each.

### 8. `revealsSettled` is a prediction shown as fact, and it leaks other players' votes (PR 2.2, spec §3.2, §9, D8)

**What the plan says.** The deck carries "for each item a `revealsSettled` flag computed at request time." Spec §3.2: the line "That settles it. Three of you agree." is shown "if this answer settled the pair."

**What is true.** A flag computed when the deck is fetched (up to 24 hours before the answer, and shown offline) says "if you answer this way, it settles the pair". That is exactly the provisional count the approved narrowing refuses (§15 item 1; plan "What this plan does not do": "Show a provisional 'likely' count on the phone"). It can be false: someone else answers first, the team decides, or the player picks the other side. It also tells the phone that two other players already agreed on a side, which is other players' answers on a pair that is not yet decided. The spec says answers are used by the team only (§7.4: "Showing a player's answers to anyone but the team" is never done).

**Fix.** Show the "settles it" line only after sync, from the server, or drop it. If the reveal must be offline, use a line that doesn't depend on other votes. T2-22 (response snapshot) should assert the deck has no per-pair vote counts or flags derived from them.

### 9. Spec rules dropped or weakened

| Spec | What the plan does | Fix |
|---|---|---|
| §6.4: a decision where every device is under seven days old is "marked *fresh devices* and **kept out of the test set until the team looks**" | T2-18 flags it. PR 7.1's view includes it "with the flag" (T7-2 checks the flag is present). Nothing keeps it out, and there is no way for the team to "look" | Add `fresh_reviewed_at/by`; the view excludes flagged labels until reviewed; the Matching to check page gets a row for them; test T7-4 that a flagged label is absent until reviewed |
| §6.2: when a device drops below 60 %, its earlier counted judgements on still-live pairs are re-marked uncounted | `care.ts` re-marks. The engine isn't re-run, so a contested pair that now has S = 3, D = 0 stays contested, and a pair whose S falls to 1 keeps a stale status | Re-run `decideGamePair` for every pair touched, in the same transaction (Blocker 1's lock order: pairs in id order) and test it |
| §6.2: "Can't tell on a check pair doesn't count either way" | T2-13 doesn't cover it | Add a test |
| §3.2: "On a check pair the reveal shows the names and nothing more: the team's answer is never shown" | T4-3 says the reveal never renders a number. Nothing prevents the deck from carrying the decided answer, and no test checks it | T2-22 snapshot asserts a check pair's deck item has no decided answer; T4-3 asserts the reveal on a check pair has names only |
| §3.4 and §3.2: "Cats you've helped tell apart: N" under the Home card and on the profile ("Counted when three people agree"); round end shows the count and "by how much" | PR 5.1 is server and strings; PR 4.1's "end-of-round count" is the provisional tally (T4-15 forbids a decided number). No PR builds the Home count, the profile line, or the round-end figure when online | Add them to a PR: Home and profile read `pairsDecided` from the profile response; the round end shows the figure from the last sync, and says "waiting to send" for the rest. Say what "if it moved" means given D8 |
| §7.2 row 1: "Same on **two or more photo pairs** of the same two cats, or one pair plus the team's own look" | T6-7 covers only the sighting-vs-cat (Different) row | Add the cats-Same test |
| §7.2: "ask for a better photo" and the "Nobody can tell" row's "note that a cat needs a clearer main photo" | Named as an action, with no stored effect | Say where the note is stored (for example a `decided_note` value) |
| §4.4: a hand-picked cat replaces the lowest-scoring candidate; a line-up is dropped if any of its four photos fails §4.2; about one line-up in four ends in "None" | T2-8 tests random order only; the one-in-four setting is not in the key list | Add tests and the key |
| §4.2: "photo sent privately with a welfare report or by a guardian"; "a pair involving a cat the public can't see" | No exclusion rule or note. Cats have no hidden flag today, and photos reach the game only as a cat's display photo or a resolved sighting's, so these may hold by construction | Say so in one line, so a reviewer doesn't have to rediscover it |

### 10. Settings plumbing and the `db-ops` commands are described as one-liners

**What the plan says.** PR 2.1 adds ten `game_*` keys "to the same reader" (`lib/appSettings.ts`). T4-1: the card renders "only when `game_enabled` is true in the loaded settings". `db-ops rebuild-game-deck` and `db-ops export-game-labels`.

**What is true.**

- **Where shapes live.** The key list and shape checks live in **`lib/db/src/appSettings/shape.ts`** (`SETTING_KEYS`, `settingShapeProblem`), shared by the server and the `db-ops set-setting` CLI. Editing only `artifacts/api-server/src/lib/appSettings.ts` leaves `set-setting` unable to write a game key. The api-server's `AppSettings` is a flat struct with three fields. Ten keys (several with object shapes) need a shape for each and tests (`dbOps.settings.test.ts` pattern).
- **The phone can't read the switch.** `GET /api/app-settings` returns only `feedNudge` and `hiddenFacts` (`routes/appSettings.ts:17-25`), and the app stores a fixed `StoredSettings` (`lib/appSettings.ts`). Nothing in the plan adds `gameEnabled` to the response, the OpenAPI schema, the generated client, or the phone's stored copy. So T4-1 cannot be built, and the Home card has no way to know the game is on. The response is cached for 60 seconds publicly, which suits a switch.
- **`db-ops` shape.** Every `db-ops` command runs a script against Postgres: `pnpm --filter @workspace/db run <cli>` (`scripts/db-ops.sh:431-447, 500-507`), and the GitHub workflow lists commands in a `choice` input (`.github/workflows/db-ops.yml:15-31`). Neither runs the api-server's code. `rebuild-game-deck` needs the deck job, which depends on api-server libraries (`catDisplayPhotoIds`, `blurPosition`, the capability code). Either the deck job lives in a package the CLI can import, or the command calls an internal API route (finding 4). The plan edits neither `db-ops.sh` nor `db-ops.yml`.
- **Export artefact.** The only upload step in the workflow is the encrypted dump, with a 7-day retention. A labels CSV would be a plain artefact visible to everyone with repo access. Photo ids only, no device ids (T7-3), which is acceptable, but say the retention and who can read it, and that `export-game-labels` needs a new step.

**Fix.** Name `lib/db/src/appSettings/shape.ts`, the `/app-settings` response, the OpenAPI schema and regenerated client, and the phone's `StoredSettings`. Say how the two commands run (internal route plus a thin CLI, or a deck library in `@workspace/db`) and add the workflow inputs and an artefact step.

### 11. PR 7.1 defines a view but lists no migration

The plan's order table gives PR 7.1 migration "—", yet small call 5 and PR 7.1 define `game_labels` as a Postgres view. `migrate:check` does pass for a view, because the README says views live only in migration SQL and the scratch databases are compared on tables, columns, indexes and constraints (`lib/db/src/migrate/cli.ts:101`). But the view must be created by a migration file with a rollback block (`DROP VIEW`), and the rollback test must run. The plan says no migration exists in this PR. Also, a view over `game_pairs` blocks later `ALTER COLUMN` on the columns it uses, which is a hidden cost for a table that is still changing.

**Fix.** Either list migration `game_labels_view` with its rollback in PR 7.1 and the order table, or drop the view and have the export run a query (simpler; "nothing is copied" holds either way). I would drop the view.

### 12. Photo size parameter and the routes' limits (PR 3.1, PR 2.2)

- **No server-side cache of the resized image.** Each request reads the whole base64 row (`select()` on `photos`, `routes/photos.ts:44-47`), decodes, resizes with `sharp`, re-encodes. "Cached with the same headers" is the browser's cache only. A fresh deck is about 58 photos per device.
- **Shared limit.** `photoLimiter` is 300 per 15 minutes per IP, in each server's **memory**, and shared by all of a café's or ferry's phones (`middlewares/rateLimit.ts:57-61`). One deck plus ordinary browsing is already a fifth of it. The plan should say whether game fetches count, and whether the deck download paces itself (a handful at a time).
- **Cheaper source.** Stored photos are already capped at 2048 px (`lib/imageValidation.ts`), and SYC-403/404 would add stored small versions. Decision 3 says to build on those if merged. If not, an in-memory LRU of resized bytes is a cheap fix.
- **No limiter named on `POST /api/game/answers`** (batch of 50: one transaction each, plus the care and decision work) **or `GET /api/game/deck/check`**. The latter is unauthenticated as described and answers "which of these photo ids are hidden", so it must need the device secret, cap the number of ids, and be rate limited. Only the deck route gets one.
- **C7 wording.** The per-device limiter is a `declareLimit` bucket in `lib/limits.ts` (`rateLimit.ts:126-137`), and `declareLimit` throws on a clash. "Reuses" means a new bucket.

### 13. Guardian side and the team page (PRs 6.1, 6.2)

- **C9 names the wrong function.** `placeCats` (`lib/colonyCats.ts:50`) **writes** cats into colonies. The readers are `currentColonyOf` (`lib/colonyMembership.ts:20`) and `catTarget` (`lib/capabilityTargets.ts:34`). `requireTeam` does support two targets: its `target` resolver can return an array and "every target returned must pass" (`middlewares/requireTeam.ts:62-69`). So the approach is fine; the cited function is not.
- **`own` route.** `/team/my/colonies` is registered with `requireTeam(undefined, OWN)` (`routes/teamMy.ts:50`): any accepted person, no capability. The section's decisions need their own POST route behind `requireTeam('decide_photo_pair', { target })`, with the target read from the pair row and not the request. The team holds `decide_photo_pair` too ("All"), so one route can serve both; say which. The page itself must list only rows the record puts in her colonies, not rely on the POST check.
- **Route walk.** Every new `/api/team/*` route needs a row in `team.walk.test.ts` or that test fails (`middlewares/requireTeam.ts` comment). Not mentioned.
- **Nav.** `NavKey` is a closed union and `NAV` a fixed list (`lib/teamPages/layout.ts:10, 21-30`). A new key means editing both, plus the layout tests. It shows to every island holder; the page still enforces `review_photo_pairs`.
- **Localisation.** Guardian-facing pages use `tr(lang, …)` and the person's language (`layout.ts:337-345`). The new section's strings need keys in the guardian string tables, not English-only team HTML.
- **Posts.** `formRoute` is exported from `teamCorrections.ts` and takes the capability and options; fine.

### 14. Model delegation and assurance fall short of the SYC-44 plan's standard

The SYC-44 plan escalated every package where a miss is silent, irreversible, or privacy or authorisation related, and added three sections this plan lacks.

- **Escalation.**
  - PR 2.2's engine (race, double credit) is Sonnet with an Opus review of the engine only. Given finding 1, build it with Opus, or at least run an independent Opus review "told to double-credit a voter".
  - PR 4.1 and 4.3 hold the phone's copy of photos that may be hidden later. A missed wipe or deck check is a silent privacy failure. They are Sonnet with no independent review stated.
  - PR 6.2 is an authorisation change (a placed capability across two colonies). A flaw lets a guardian decide for another colony. Sonnet.
  - PR 5.1 changes `getProfileStats` (called on every resolve and profile read), a table read by every notification request, and deletion. Sonnet, "small".
- **A reader list.** The SYC-44 plan has an "Every place the guards must hold" section with structural checks that fail on a place nobody listed (T4-0, P6-0, T7-8). This plan has one table of rules, one test each. Missing: a structural allowlist of the files that read photo ids into game responses; a test that no game response contains a position, a score or a field from `sighting_matches` by construction, rather than by a snapshot of today's shape; an allowlist of writers to `cats`, `cat_identity` and `sightings` (T6-4 covers only the team route).
- **Spec-test map.** The SYC-44 plan maps each spec test to a plan test. This plan has no such map, and finding 9 shows gaps.
- **Probes and snapshots.** Rollout names a probe only for step 2. Add one per slice, and the Neon snapshot step before each production migration (the SYC-44 rollout and the launch plan both require it, in "ask" mode).
- **Review outcome.** Left blank ("Filled after the Sonnet review"). Fill it with this review.

---

## Minor

### 15. Rollout and the launch plan

Nothing in the plan lands inside the 28–31 October freeze. PRs 0.1 and 1.1 are described as "week of 3 Nov". Points to tighten:

- **Photo route.** PR 3.1 edits `routes/photos.ts`, which SYC-44 7.2 also changes (410, photo bytes) in the 28 Oct publish, or the first week of November if cut. Say "after 7.2" and that 3.1 rebases.
- **Migration numbering.** `0027` is the last on `main`; SYC-209, SYC-53, SYC-2 and SYC-44's `photo_removal` all add migrations. The plan's "numbers claimed at generation time" is right; add that three of the plan's migrations (1.1, 2.1, 5.1) each need "ask" mode and a snapshot, and that each is a separate publish slot.
- **Store builds.** The launch plan says no store build exists yet and the first store release follows 31 Oct. The plan's "store builds as the November store track allows" should state whether the game goes into the first store submission. The game's screens, photos of cats and a "something wrong" link are the sort of thing a reviewer looks at, so decide deliberately, and keep `game_enabled` false until the build with the game is the minimum supported one.
- **Words.** The launch plan freezes new visitor-facing words from 22 Oct unless they were in Johnny's pack. The plan's strings are after launch, so they need a "second flagged pack" and the SYC-4 native review it already lists. Say so.
- **`review.tsx`.** The match-wait PR 2 edits it in the 26 Oct publish; the plan notes it already.

### 16. The C4 fallback uses a "last main-photo change" that nothing records

Spec §4.2 and C4 say "drop pairs older than its last main-photo change". Nothing updates `cats.primary_photo_id` after insert on `main` (a search for writes finds none; SYC-163 is not built). So there is no change history to read, and the main photo is stable today. The only way the compared photo differs from what the public sees is the hide stand-in. A simpler, exact rule for rows without `compared_photo_ids`: compared photo = `cat.primaryPhotoId`, and keep the pair only if `catDisplayPhotoIds` returns that same id and it is not hidden. Add a note that once SYC-163 lands, the match record's photo ids (PR 1.1) are the only safe source, so the fallback is retired then.

### 17. The spec disagrees with itself on paused pairs; the plan picks silently

§3.7 says paused pairs have their "answers still accepted on sync". §4.5 says an answer for a paused pair returns `accepted:false`. The plan follows §4.5 (PR 2.2). That is a choice about whether an honest answer given before a report is thrown away. Name it in "Small calls", with a test.

### 18. Decisions 1 and 3 offer options that reopen approved spec rules

Decision 1 B ("profile only, no announcement") contradicts approved §3.4 and §8 (badges "announced through the in-app inbox"). Decision 3 C ("embed thumbnails in the deck response") contradicts §4.3 (the size parameter, through `photoVisibility.ts`). Decision 1 as a whole is really a gap in the spec (C1), which is right to put to Samuel, but B and C aren't open options. Offer A, and the real alternative (a stored badge row versus a cat-shaped fake), not the rejected ones. Decision 2 was left to the plan by Samuel (§15 item 4), so it is fine.

### 19. Spec rules with no named test

In addition to finding 9: §3.5 (deck empty state, "never repeats a pair to the same device" is covered by T2-14 only for answers, not for delivered-but-unanswered pairs); §4.3 "scoring each live pair by usefulness" (ordering); §6.1 "newest last" for the queue cap; the "Different on a sighting photo vs its cat" two-pair rule; first-launch refill when the deck is under half full; deck check on every launch **before any card renders** with a slow network (timeout rule). Add one test each or say why none is needed.

### 20. Plain English

- No canonical-fact breach: "spotter", "guardian" and the precise offline wording are all right. Use "cat guardian" where the page first names her (the spec does, in §5).
- "In plain English" uses terms Samuel hasn't been given: "seed mode", "a labels export for SYC-56", "the 0.4 threshold", "pool 1", "the matcher's score band". One clause each.
- The tables use "structural guard", "mutation probe", "checkpoint". The SYC-44 plan also does; a one-line glossary at the top of the Model delegation section would help.
- C1's table cell ("a table read by every notifications request") and the Decision 1 risks are hard to follow. Rewrite after finding 5.

## Nits

- C11 and PR 2.2 attribute `athensDay` to #195. The Athens helpers are `athensDay` in `lib/resolve.ts:829`, `todayInStreakTimezone` in `lib/streak.ts` (used by `routes/appSettings.ts`), and a private `athensParts` in `lib/sightingRoundUp.ts:46`. Name the one the plan means and export it.
- The plan says `sharp` is "used by the colour reader". It is used by `lib/mapTiles/tileCache.ts` and the upload path (`lib/imageValidation.ts`); the colour reader isn't where it is imported.
- "Migration `inbox_items`" and "`inbox_items` table": the table is `notifications` (finding 5).
- Spec §10.4 lists a "line-up frequency" setting; the plan's key list has none.
- `lib/api-spec/openapi.yaml` is named for `pairsDecided` only. State whether the game routes go in OpenAPI (and so in the orval clients) or the app uses `customFetch` directly, as the report queue does.
- A merge retirement is permanent ("retired"), but `cat_identity` rows can be superseded (an unmerge). Say whether a retired pair returns after an unmerge.

---

## What I verified as true

- **C1:** `notifications.cat_update_id integer NOT NULL` (`lib/db/src/schema/notifications.ts:43-51`).
- **C2:** no resizing on `routes/photos.ts`; `sharp` is a dependency (`package.json:27`).
- **C3:** `capabilities.catalogue.test.ts` parses `roles-and-invites.md` §6.2. A row in one place and not the other fails CI.
- **C4:** neither field exists on `sighting_matches`; `computeMatchCandidates` reads `cat.primaryPhotoId` raw (`routes/sightings.ts:262-274`) and `VISION_MODEL` is in `lib/visionModel.ts`. The `recordMatch` upsert is where both fields would go; its `setWhere isNull(chosenAt)` keeps a recorded choice.
- **C5:** `rankedForRecord` is the top three at ≥ 0.1 (`routes/sightings.ts:296-300`).
- **C6:** `createQueueStore` is generic (`lib/queueStore.ts:175`); `ReportQueueContext.tsx:155` is a second user; `offlineQueue.ts` is sighting-specific and treats most 4xx as permanent.
- **C11:** `app_settings` exists (#195), with three keys; `db-ops set-setting`/`list-settings` exist.
- **Photo grid function:** the "published positions" function is real and reusable: `blurPosition` in `lib/blur.ts` (250 m cell centres, idempotent), unnamed in the plan. Name it. The 1 km rule holds for pool 1, since a 500 m exact match is at most about 850 m between cell centres.
- **The hide mechanism:** `hiddenPhotoIds` and `catDisplayPhotoIds` are batched id-only helpers (`lib/photoVisibility.ts:51, 103`). `publicPhotoUrl` is the only builder of `/api/photos/…`.
- **Requirement:** `requireTeam` supports checking a placed capability against several targets (finding 13).

## Verdict

**Approve with fixes.** The design is carried out faithfully and the structure is sound, but the plan is not yet buildable. Revise it to a draft 2 that fixes Blockers 1–3 and Majors 4–8 and 10–11, then re-check those items before any PR starts. No spec decision needs reopening.

## For Samuel, in plain English

The plan does what you approved: pairs and line-ups, three people agreeing, no points, the Matching to check page, the switch that keeps it off until you say. It also respects the privacy rules and keeps clear of the launch freeze. But it can't be handed to builders yet. Three things must be fixed first. (1) Nothing stops two people's answers arriving at the same instant and crediting someone twice, and credit can never be taken back. (2) The database tables it plans are missing a few columns that later steps need, and it hasn't worked out how a line-up tap becomes a pair answer. (3) It leans on things from the "Report an issue" work (the report screen, a table, the "photo removed" answer) that aren't built yet, and one of them has the wrong name. After that come repairs. The badge message would break old versions of the app, so it needs a different design. "Delete my data" isn't fully wired on the server or the phone. The phone's photo storage should use what the app already has. The 6-hour deck rebuild copies a "timer" that doesn't exist. And a rule you approved, that brand-new phones' decisions stay out of the test set until the team looks, got quietly dropped. None of this changes what you approved, and all of it is plan edits. Once draft 2 covers these, it should be safe to build, starting after the 31 October launch as planned.
