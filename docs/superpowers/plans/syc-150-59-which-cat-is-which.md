# SYC-150 and SYC-59: Which cat is which (implementation plan)

**Status:** **Approved by Samuel, 27 October 2026** ("approved, both as recommended"): the work stays on SYC-150, SYC-59 and SYC-410 with no sub-issues, and the build starts the week of 3 November with Slices 1 and 2 in parallel. Reviewed by an independent Sonnet critic: 9 major and 4 minor findings, all folded in (see "Review outcome" at the end).

**Linear:**
- SYC-150 (move a sighting, High; SYC-418 folded in)
- SYC-59 (duplicates and merging; SYC-531 folded in)
- SYC-410 (one reader of merges)
- Touches: SYC-152 ("Matched by hand", whose buttons this builds), SYC-402 (the matching game: its "same cat" and "Re-file" rows), SYC-44 (Report an issue), SYC-383 (App switches) and SYC-757 (guardians, later)

**Design (approved, not reopened here):** [`docs/specs/which-cat-is-which.md`](../../specs/which-cat-is-which.md), **approved by Samuel on 26 October 2026** ("approved, write the plan"), with decisions D1–D11 made the same day. Two adversarial reviews: [`reviews/which-cat-is-which-review.md`](../../specs/reviews/which-cat-is-which-review.md).

**Checked against:** `origin/main` at `b30dfdec8` (26 October 2026, after #372). Every "is true on main" claim below names the file it was read in.

**Timing:** after the 31 October launch. The feature freeze is Wednesday 28 October (`mvp-launch-31-oct.md`), and this is several weeks of work that touches the record underneath everything. The first PR can merge in the first merge window after the launch publish settles. Nothing in this plan changes what a spotter or the team sees until Slice 3.

**Words used in this plan:**
- A *structural guard* is a test that fails when someone adds a reader or writer nobody listed.
- A *mutation probe* breaks the rule a test protects, deliberately, to prove the test goes red; then the break is undone.
- A *checkpoint* is the `CHECKPOINT.md` in the build worktree: what's done, what's next.

---

## In plain English

**What the team gets, in the order it arrives:**
1. **Nothing visible at first.** The first steps make sure every screen in the app will treat two merged cats as one, and add the new records the later steps write to. Spotters and the team see no change.
2. **Moving a sighting.** On a cat's History, "Move to a different cat…" and "Move to a new cat", with tick boxes to move several at once (which splits one record into two cats). The same button appears on a "That's a different cat" report.
3. **Merging.** "Same cat as…" on a cat's page opens the merge screen. Undo merge sits in the History.
4. **Spotting duplicates.** The Possible duplicates list. "Are these the same cat?" on the spotter's reward screen. Points when the team confirms. The nightly look-alike sweep, built but switched off until it has been tested.

**What spotters notice:**
- An occasional extra question after a spot.
- A quiet line when their photo is filed under a different cat.
- A note when a cat they follow turns out to be the same as another.
- 10 points when their "same cat" answer is confirmed.

**What never happens:** nothing is deleted, nothing is merged without a team member, and no push or email is sent about a move or a merge.

**The order, in one line:** foundations first, then moving a sighting, then merging, then spotting duplicates. Each stage below is called a *slice*, and each slice is one or more pull requests.

---

## Where the spec and the code on `main` disagree

The spec's decisions stand. These are places where carrying them out needs the plan to say something more.

| # | What is true on `main` | What this plan does |
|---|---|---|
| C1 | Five readers of `cat_identity` follow different rules. `loadCatRecords` still folds in an undone merge (`lib/observations.ts:1445-1451`). `coatReading/due.ts:133-141` mistreats an undo. Only `capabilityTargets.ts` `canonicalCats` (58-92) follows chains. | PR 1.1 moves `canonicalCats` into `lib/catIdentity.ts` and puts every reader on it, before anything can write a merge. It's behaviour-neutral today, because the table is empty. |
| C2 | About 20 readers never touch `cat_identity`: the public cat list and page (`lib/catHelpers.ts`, `routes/cats.ts`), `totalCatCount`, the matcher pool (`routes/sightings.ts:267`), `visitsFor` (`lib/vetVisits.ts:357`), the colony readers, the nightly news walker | PR 1.2 adds `liveCats` and `catsFeeding` and the two source tests (spec §9.3). It moves every listed reader. Also behaviour-neutral today. |
| C3 | `sighting_matches` has no team-step columns (`lib/db/src/schema/sightingMatches.ts`) | PR 2.1 adds them (spec §7.5 of the move draft, now §9.7 move step 8) |
| C4 | `points_ledger.sighting_id` is `NOT NULL` and unique. `cat_id`, `athens_day` and `week_start` are `NOT NULL`. The once-a-day index is `(device_id, cat_id, athens_day) WHERE points > 0`, with no sighting scope (`lib/db/src/schema/badges.ts:16-40`, `migrations/0046:59`). `awardPoints` pre-checks the same tuple (`lib/pointsLedger.ts:40-66`). | PR 2.1 makes `sighting_id` nullable and adds `duplicate_cat_low`/`duplicate_cat_high` with a CHECK and their own unique index. It **drops and recreates the once-a-day index as `WHERE sighting_id IS NOT NULL AND points > 0`**, and gives `awardPoints`' pre-check the same scope. A duplicate row carries the survivor's `cat_id`, the merge's Athens day and week, and `source = 'duplicate'`. **It counts on the week board** (`weekBoard.ts:42`): these are points earned that week. **It doesn't count as an active week or a spotted cat** (`badges/stats.ts:28`, `catHelpers.ts:748` filter to sighting rows). Test: a duplicate award and a same-day sighting of the same cat both pay in full. Mutation probe: put the index back unscoped, and that test goes red. |
| C5 | `notifications.kind` allows only `cat` and `week_result` (`lib/db/src/schema/notifications.ts:79-81`) | PR 2.1 adds `merged` (D4, for followers) and `duplicate_points` (D10). Both carry a `message`, like `week_result`. PR 4.1 widens `GET /api/notifications` (`routes/notifications.ts:140-146`, which today lets through only `cat` and `week_result`) to the two new kinds. They're shaped like `week_result` (`catId` null, a message), so an installed app that doesn't know them yet shows the message text, which is checked against the oldest supported build. They never go through the push sender (`notificationFanout.ts`): there's a test that no push is queued for either kind. The spotter's "filed under Agatha" line (D4) is not a notification: it's drawn on their own spot from the move record (PR 3.3). |
| C6 | `cat_identity.created_by` is untyped text, with no indexes (`lib/db/src/schema/observations.ts:98-112`) | PR 2.1 adds the spec §9.2 columns and an index on `(canonical_cat_id)` and `(cat_id)` |
| C7 | The "Matched by hand" list isn't built (SYC-152), and nor is the matching game (SYC-402, no `game_pairs` in code) | This plan builds the move and merge actions they will call, and the Report an issue and cat-page entry points. SYC-152 and SYC-402 add their buttons when they're built. Comments go on both tickets. The game's "same cat" row becomes a `duplicate_reports` source then. |
| C8 | App switches are rows in `app_settings`, read through `lib/appSettings.ts` and changed on the App switches page (`lib/appSwitches.ts`) | PR 5.3 adds the key `duplicate_sweep` (spec §9.6; default off) to that page, as SYC-415's `extra_photos_on` did |
| C9 | The fingerprint job is the only writer of `photo_fingerprints` (`lib/fingerprint`), and fingerprints hold no cat id | The sweep reads fingerprints by each live cat's display photo. It writes nothing to that table. |
| C10 | `hasMetCat` has no purpose argument and compares raw ids (`lib/claiming.ts:88-125`) | PR 3.1 adds `purpose` and canonical comparison (spec §9.9) |
| C11 | Welfare re-ties already in production retire the old cat's report through a cross-cat query keyed only on `supersedes_id` (`lib/observations.ts:1471-1497`). They have no move record. | PR 3.1 **keeps** that query and generalises it: a row replaced by a row on another cat is listed `elsewhere` when the replacer has a `sighting_move_id` **or** the replaced row is a `welfare_report`. Regression test with an existing-style re-tie (no move row); mutation probe that drops the welfare branch. This is the only change in the plan to behaviour that exists today. |
| C12 | `sightings` has no index on `cat_id` (`lib/db/src/schema/sightings.ts:43-52`) | PR 2.1 adds `sightings_cat_idx` on `(cat_id) WHERE cat_id IS NOT NULL`, for the merge's scan and the deferred check |

---

## How it ships: the order

| Slice | PR | What | Depends on |
|---|---|---|---|
| 0 | 0.1 | Capability rows `move_sighting`, `merge_cats`, `review_duplicates` in `roles-and-invites.md` §6.2 and `lib/capabilities.ts` | — |
| 1 | 1.1 | `lib/catIdentity.ts` and the five existing readers (SYC-410) | — |
| 1 | 1.2 | `liveCats`, `catsFeeding`, the reader sweep and the two source tests | 1.1 |
| 2 | 2.1 | One migration: every new table and column, and the triggers | — |
| 3 | 3.1 | Moving: the record (moved statements, `elsewhere` rows, the readers table, `hasMetCat`, as-of, news, deletion) | 1.2, 2.1 |
| 3 | 3.2 | Moving: the route, locks and steps (spec §9.7) | 3.1 |
| 3 | 3.3 | Moving: the dashboard screens, History rows, the Report an issue button, the spotter's line in the app. `MERGE_INSTEAD` shows text only ("These look like the same cat. Ask for a merge."); 4.2 turns it into a link to the merge screen. | 3.2 |
| 4 | 4.1 | Merging: route, undo, follows, owners, public reads, "also known as", points award, and the shared counting-phone helper (5.1 reuses it) | 3.2 |
| 4 | 4.2 | Merging: the merge and undo screens, History rows, the merged-away team page | 4.1 |
| 4 | 4.3 | Merging: the app's "Mimi is now part of Agatha" banner and the followers' notification | 4.1 |
| 5 | 5.1 | Possible duplicates list, the ladder, counting phones, the "New cats to check" additions, the new-cat check | 4.2 |
| 5 | 5.2 | "Are these the same cat?": the resolve response, the answers route, the app's reward screen | 5.1 |
| 5 | 5.3 | The nightly sweep behind its switch, and the calibration script | 5.1 |

Slices 1 and 2 can be built in parallel. 4.2 and 4.3 can run in parallel, and so can 5.2 and 5.3.

---

## Slice 0: the catalogue

### PR 0.1: three capability rows

- **Rows:** `move_sighting`, `merge_cats` and `review_duplicates`, all `island`, TEAM. They're added to `roles-and-invites.md` §6.2 and `lib/capabilities.ts` in one PR, because `capabilities.catalogue.test.ts` parses the doc and fails on drift.
- **Tests:** the catalogue test, plus "a cat guardian is refused each of the three" (D5).

---

## Slice 1: one reader of merges

### PR 1.1: `lib/catIdentity.ts` (SYC-410; spec §9.3)

1. **The module.** `canonicalCatOf(ids, { asOf? })` and `catsFeeding(ids, { asOf?, excludeKinds? })` move here from `capabilityTargets.ts` `canonicalCats`. They follow chains, at most 8 hops, with a loop guard. A merge row stops counting once an undo supersedes it, and the newest standing row wins.
2. **The readers.** `loadCatRecords`, `claiming.ts` (the merged-away refusal and `hasMetCat`'s merged-in clause), `capabilityTargets.ts`, `teamCatList.ts` (raw SQL becomes a call) and `coatReading/due.ts` all use the module.
3. **Structural guard.** A source test bans any `cat_identity` / `catIdentityTable` reference outside `lib/catIdentity.ts`, the schema and tests.
4. **Tests** (spec test 15's core, and test 16): each reader, given rows inserted directly, for merge, merge-then-undo, a chain of two, and a loop.
   - **Mutation probes:** (a) drop the `supersedes_id` check, and the undo test for each reader goes red; (b) cut the walk to one hop, and the chain test goes red.

### PR 1.2: live cats and statements by cat (spec §9.3)

1. **`liveCats()`** is the only way to list or count cats. Moved onto it: `totalCatCount`, `listCatsWithStats`, `trappingPlan.ts`, `colonyCats.ts`, `reports/progress.ts`, the nightly news walker (`lib/news/nightly.ts:339`), the matcher pool (`routes/sightings.ts:267`), `findFromPhoto.ts`, `newCatsAfterFailedCheck`, the nearby list and `searchTeamCats`.
2. **`catsFeeding`** for every read of `observations` by cat id. Moved onto it: `visitsFor` and vet-visit photos, `reports/vetCosts.ts`, `teamColonies.ts`, `colonyMembership.ts`, `movedAway.ts`, `guardianChanges.ts`, `dashboard/colonyFigures.ts`, `routes/cats.ts` (care timeline), `teamCorrections.ts`, `welfareTie.ts`, `teamOnlyPhotos.ts`, `vet_batch_cats` readers and the claim waits. `coat` and `markings` pass `excludeKinds` (spec §4.2).
3. **Two structural guards, covering every shape a read can take**, not only `.from(catsTable)`:
   - Cats: any use of `catsTable` (`from`, `innerJoin`, `leftJoin`) and raw SQL matching `\b(from|join) cats\b` or `${catsTable}`.
   - Statements: any `observationsTable.catId` comparison, and raw SQL on `observations` by `cat_id`.
   - Each is allowed only inside the helpers or on an allowlist, and each allowlist entry carries a one-line reason.
4. **The sweep's list is checked, not trusted.** The review found readers the first list missed. Among them: `colourCheck.ts`, `guardianCatView.ts`, `publicCat.ts`, `teamCatView.ts`, `recentGuardianChanges.ts`, `vetBatchRoutes.ts`, `teamVetBatches.ts`, `routes/reports.ts`, `routes/issues.ts`, `routes/notifications.ts`, `commitStatement.ts`, `mail/outbox.ts`, `likelyReview.ts`, `teamAuth/heldTyping.ts`, `observations.ts`, `weekBoard.ts`, `sightingRoundUp.ts`, `badges/award.ts`, `issues/queue.ts`, and `routes/sightings.ts`' ear-tip state. So:
   - **Opus** runs the greps for every shape above and writes the full hit list into the PR description, with a ruling for each: "move to the helper" or "allowlist, because …" (single-cat load by id, a write, or a deliberate raw read).
   - Samuel isn't asked to review it, but the list is in the PR.
   - The Sonnet builder then applies the rulings.
   - The public map data is checked to come from `listCatsWithStats` (spec §9.3 row 1). If it doesn't, it's added.
5. **Tests:**
   - spec test 15 for every moved reader: merge then undo, using directly inserted `cat_identity` rows, agrees with before;
   - `totalCatCount` drops by one on a merge.
   - **Mutation probes:** put one reader back on a plain `.from(catsTable)`, one on a `leftJoin(catsTable…)` and one on a raw `from cats` template; each structural guard goes red for each.

---

## Slice 2: the tables and database rules

### PR 2.1: one migration (spec §9.1, §9.2, §9.4, §9.5, §9.6, §9.8; C3–C6)

**Schema** (in `lib/db/src/schema`, so `migrate:check` sees them):
- `sighting_moves` (with `txid`) and `merge_follow_changes`;
- the new `cat_identity` columns (with `txid`) and their indexes;
- `observations.sighting_move_id`;
- the team-step columns on `sighting_matches`;
- `duplicate_reports`, `duplicate_decisions` and `new_cat_checks`;
- the `points_ledger` changes;
- the two new `notifications` kinds.

**Triggers** (in the migration SQL only, so each one gets a mutation probe):
- `sighting_moves_append_only`;
- the `cat_identity` guard, replacing `cat_identity_append_only`, which allows only redaction;
- the `sightings_append_only` move branch, checked against `app.sighting_move_id` / `app.cat_merge_id` and `txid = txid_current()`;
- the refusal to file a sighting under a merged-away cat;
- the deferred constraint trigger on `cat_identity` that refuses a merge while a resolved sighting still names the merged-away cat;
- the `observations_append_only` insert branch;
- a guard on the three duplicate tables: add-only, redaction only.

**Rollback** is written for every step. `pnpm --filter @workspace/db test` proves each one.

**`sightings_append_only` is `CREATE OR REPLACE`, keeping the 0046 definition's branches word for word** (`migrations/0046:65-142`) and adding the move branch. `notifications_kind_ck` is dropped and re-added with the two new kinds, with its rollback written. `ADD COLUMN txid … DEFAULT txid_current()` rewrites `cat_identity`, which is empty, so it's harmless; the plan says so in the migration comment.

**Tests that the right things still pass:**
- the existing resolve paths: pending to resolved, awaiting_team to resolved, the place stamp and redaction;
- a legitimate move and a legitimate merge done in raw SQL with the setting and a fresh move or merge row: accepted.

**Tests** (spec test 1, and 16a's database half). Each guard is exercised with:
- a forged change with no setting;
- an older move row with the same cats;
- a savepoint;
- a change to another column in a move;
- an update to a move or merge row other than redaction.

**One mutation probe per trigger:** remove the check, and its refusal test goes red. Tighten the move branch, and the legitimate-move test goes red.

**Production:** the migration runs on Neon `production` before Samuel republishes (memory: *migrate before republish*). It's additive except the replaced `cat_identity` trigger, so old code runs unchanged on the new schema.

---

## Slice 3: moving a sighting (SYC-150)

### PR 3.1: the record (spec §5.7, §5.8, §9.5, §9.9–§9.12)

1. **`writeMovedObservation`**: copies the spotter's rows and withdraws everyone else's on the original row's own cat. A source test bans every other writer of `sighting_move_id`.
2. **`loadCatRecords`** adds the `elsewhere: true` rows by generalising the welfare cross-cat query, keeping its welfare branch (C11). Every resolver drops `elsewhere` rows from its folds. **Test per resolver:** an `elsewhere` row never counts. **Regression test:** an existing-style welfare re-tie still retires the old report.
3. **The readers table** (spec §9.5): `earTipStateFor`, `hasAnsweredEarTip`, `agreeWithClip` (refuse a moved row, and resolve and lock the canonical cat), `catsOfPhoto`, `likelyReview`, `handPick`, `matcherHealth` and `sightingRoundUp`. Also `writeObservation`'s two same-cat checks (`lib/observations.ts:1160,1167`, the `TODO(SYC-59)`s) compare canonical cats.
4. **`hasMetCat`** gains `purpose` and canonical comparison (C10).
5. **As-of reads** go through `sighting_moves` (§9.10).
6. **Nightly news:** `silenced` with reason `moved`, and re-baselining (§9.12).
7. **Deleting a team member** clears the mover and `observations.account_id` (§9.11).

**Tests:** spec tests 2–5, 7 and 27. Spec test 6 is the deletion half, here with no route yet: a deletion and a direct `writeMovedObservation` running at once.

**Mutation probes:**
- copy the row as the mover instead of the spotter, and test 3 goes red;
- leave out the `elsewhere` rows, and test 2 goes red;
- drop the sighting id from the withdrawal, and test 4's evidence-of-life check goes red;
- drop the welfare branch, and the re-tie regression test goes red.

### PR 3.2: the route (spec §9.7, move)

1. **`POST /api/team/sightings/move`**, with the lock order and the move steps in §9.7, including the new-cat path, the main photo, the map spot (D6), follows, closing a report and the match record's team step.
2. **The answers route** re-reads `cat_id` under `FOR SHARE` inside its transaction.
3. **The refusals:** `NOT_RESOLVED`, `SAME_CAT`, `MOVED_ALREADY`, `MERGE_INSTEAD` and `MAIN_PHOTO_NEEDED`, plus the name refusals.

**Tests:** spec tests 6 and 8–13. Test 13 runs as two real concurrent transactions, a few requests at most, never a load loop (memory: *no high-volume port experiments*).

**Mutation probes:**
- take the locks in the other order, and test 6's race goes red, or deadlocks and times out as a failure;
- drop the answers route's re-read, and test 13 goes red.

### PR 3.3: the screens (spec §5.1, §5.2, §5.4, §5.5, §3.4 of History)

1. **Dashboard:** the move screen with search, the reason, "What moves", the main-photo picker and the conditional warnings. The History ⋯ menu entries, tick boxes and "Move back". The History rows on both cats. "Move to the right cat" on a `wrong_cat` report. Words follow the spec's copy exactly.
2. **App:** on the spotter's own spot, the line *"Syros Cats filed this under Agatha"*, read from the move record through the spot's existing payload. It's in English, Greek and French. The Greek and French go to Johnny's checking pack, as the launch plan's D5 allows.

**Tests:**
- server-rendered page tests in the style of `catPages.history.test.ts`;
- the i18n parity test;
- a browser check at 390 px and desktop, through the planted-cookie preview (memory: *dashboard preview cookie host*), with a moved sighting **in the data**.

---

## Slice 4: merging (SYC-59)

### PR 4.1: the server (spec §4, §9.2, §9.3 table, §9.7 merge and undo, §9.8)

1. **`POST /api/team/cats/merge`** and **`/merge/:id/undo`**, with the steps in §9.7:
   - merge moves with no copied statements;
   - follow and unfollow copies with `merge_follow_changes`;
   - the owner and pending-name rules;
   - the deferred check and the re-read after locks;
   - `UNDO_LATER_MERGE_FIRST`;
   - copying late answers back on undo;
   - points to counting phones once per pair, as ledger rows plus `profiles.points` under the badges lock.
2. **Public reads and writes on a merged-away id:**
   - `GET /cats/:id` returns the survivor with `mergedFrom`. An older app ignores the extra field, which is tested against the oldest supported build's types.
   - Name and claim actions return `MERGED` with the survivor's id.
   - Follow, let-go, `PATCH /cats/:id` and the team correction routes act on the survivor.
   - Resolve files under the survivor.
   - Welfare reports and the `cat_updates`/notifications list show under the survivor.
3. **"Also known as":** team search, move and merge search, and the name-taken prompt find the survivor by a merged-in cat's name.
4. **In-app lines:** the `merged` notification to followers, and `duplicate_points` to the phones paid (D4, D10). `GET /api/notifications` is widened to both kinds (C5), and neither is ever pushed.
5. **The counting-phone helper** (three resolved spots on three Syros days) lives in `lib/countingPhone.ts`. It is used for points here and reused by 5.1.
6. **News:** merge step 7 resets both cats' baselines, and the nightly check marks changes `silenced` with reason `merged` (spec §9.12).

**Tests:** spec tests 14–22, 16a, 16b and 28, plus: no push for either new kind; the old-build notification shape; a merge is silenced in the nightly check.

**Mutation probes:**
- copy statements on merge moves, and test 14's counts double, so it goes red;
- pay by `(device, merge)` instead of the pair, and test 19's re-merge goes red;
- let undo run mid-chain, and test 16 goes red.

### PR 4.2: the dashboard (spec §4.1, §4.3, §4.4)

- **The merge screen:** survivor choice with its two limits, the "What happens" preview including colony, owner, followers and the guardians who gain or lose sight of the cat, the warnings and the blocks.
- **The undo screen:** lists post-merge sightings and ones moved again since, with tick boxes.
- **History rows and the "from Mimi" tags.**
- **The merged-away team page.**
- **"Same cat as…"** on every team cat page.
- The move screen's `MERGE_INSTEAD` text becomes a link to the merge screen.

**Tests:** page tests; a browser check at 390 px and desktop with a real merge in the preview data.

### PR 4.3: the app (spec §4.2)

- **The cat page** handles `mergedFrom`: *"Mimi is now part of Agatha's record"*.
- **The notifications list** shows the `merged` and `duplicate_points` kinds.
- **The phone cache** needs no change. Its next fetch drops Mimi, which is checked in the web preview by loading a cached list holding a merged-away cat.

**Tests:** app tests for both kinds, i18n parity, and a web preview check.

---

## Slice 5: spotting duplicates (SYC-59)

### PR 5.1: the list (spec §3.2, §3.3, §9.6)

1. **Possible duplicates** under `review_duplicates`. It shows:
   - rows grouped by pair;
   - the ladder worked out on read;
   - "counting phone", reusing 4.1's helper;
   - the reasons in plain words;
   - "new phone" marks;
   - the three buttons;
   - the reopen rule, and fading from view after 60 days.
2. **"New cats to check"** gains nearby cats' photos, "Same as…" and "Checked, it's new" (`new_cat_checks`).
3. **The new-cat check:** at resolve with `new_cat`, a `new_cat_check` report for each passed-over suggestion at or above 0.4.

**Tests:** spec tests 24 and 25, plus the reopen rule.

**Mutation probe:** count a non-counting phone, and test 25's "new phones never make *Likely*" goes red.

### PR 5.2: "Are these the same cat?" (spec §3.1 item 1, D8)

1. **The resolve response** carries `duplicateQuestion` under the near-tie rule. An older app ignores the field, which is tested against the oldest supported build's types. **The answers route** accepts `duplicate`, once per sighting.
2. **The app's reward screen** shows the question below the usual ones, with the spotter's own photo above the two cats' main photos.

**Tests:**
- spec test 23;
- the near-tie only asks, and never makes *Likely* on its own (test 25's first clause);
- i18n parity;
- a browser check of the reward screen at 390 px with the question showing.

### PR 5.3: the sweep (spec §3.1 item 3, §9.6, D11)

1. **The nightly job** runs behind `duplicate_sweep` (off by default) on the App switches page. It writes at most 10 pairs a night and skips decided pairs and cats without fingerprints.
2. **`db-ops calibrate-duplicate-sweep`** reads decided pairs, prints how the top 10 at each candidate threshold would have scored, and suggests `SWEEP_THRESHOLD`.

**Tests:** spec test 26, and the calibration script against fixture pairs.

**The switch stays off at merge.** Turning it on is a later step (Rollout step 6).

---

## Where each spec rule is enforced

| Spec rule | Enforced in |
|---|---|
| Nothing deleted; every change is a dated record | 2.1 triggers |
| A sighting's cat changes only with a move or merge in this transaction | 2.1 trigger |
| No sighting is filed under a merged-away cat | 2.1 trigger and deferred check, 4.1 re-read, 4.1 resolve |
| A copied answer keeps the spotter as author | 3.1 `writeMovedObservation` |
| One reader of merges | 1.1 module and its structural guard |
| Every list, count and statement read covers merges | 1.2 helpers and their two structural guards |
| Colour and markings stay the survivor's own | 1.2 `excludeKinds` |
| Owners never move; pending names never stay over a named record | 4.1 refusals |
| Points once per pair, counting phones only | 2.1 unique index, 4.1 award |
| A move or merge is never news, and never pushed | 3.1 (`moved`) and 4.1 (`merged`) silencing, 1.2 walker, 4.1 no-push test |
| Duplicate reports are never public | 5.1; no public route reads them (test 24) |

## Where each spec test is built

| Spec tests (§9.13) | PR |
|---|---|
| 1 | 2.1 |
| 2–5, 7, 27 | 3.1 |
| 6, 8–13 | 3.2 |
| 14, 16a, 16b, 17, 18, 19–22, 28 | 4.1 |
| 15, 16 | 1.1 (core), 1.2 (every reader), 4.1 (through the route) |
| 23 | 5.2 |
| 24, 25 | 5.1 |
| 26 | 5.3 |

---

## Rollout

1. **0.1, 1.1 and 1.2 merge.** These are behaviour-neutral. Before the republish, record the island total (the "of 142" in the profile payload, which comes from `totalCatCount`, `lib/catHelpers.ts:720`) with a read-only count on production, and the first page of `GET /api/cats`. After it, the live `/api/healthz` shows the commit (memory: *confirm the live build before smoke*), and both match. The exact read-only tool is written into the build's rollout checklist; it never creates a device or any other row.
2. **2.1 merges. Don't republish yet:** its migration (the only one in this plan) runs on production first.
   - Probe 1: `migrate:history` on production. It's read-only.
   - Probe 2: a forged `UPDATE sightings SET cat_id` **inside a transaction that is rolled back**, on a throwaway Neon branch restored from production. This writes to Neon, so Samuel switches the session to ask mode first (memory: *Neon writes need ask mode*), and he gets one line of warning before it runs.
3. **3.1–3.3 merge.**
   - **Rehearse first:** before anyone moves anything on live data, run one move and its "Move back" on the throwaway branch, through the API.
   - Then, after the republish, the team tries one real move with Samuel watching: the main photo, the warnings, History on both cats, "Move back".
4. **4.1–4.3 merge.** Rehearse a merge and undo on the throwaway branch first. Then one real merge and undo on a pair the team already knows is a duplicate. Probes:
   - the island total drops by one, then returns;
   - Mimi's old link opens Agatha;
   - followers carried over.
5. **5.1 and 5.2 merge.** The team gets the Possible duplicates list. Spotters start getting the question.
6. **Later, once the team has decided at least 30 pairs:** run `calibrate-duplicate-sweep`. Samuel decides whether to switch the sweep on, from its numbers.

Replit sync and republishing are Samuel's (memories: *Replit sync is Samuel's*, *migrate before republish*). Only step 2 has a migration.

**The phone app.** 3.3, 4.3 and 5.2 change the app. The web app updates at the republish. The store builds follow the store track in November (`docs/runbooks/store-builds.md`). Until a phone updates, it ignores `mergedFrom` and `duplicateQuestion`, and shows the two new notification kinds as plain message rows. Each of those behaviours has a test in its PR. Nothing in the server waits for the app.

## Where this collides with other work

| Work | Collision | Handling |
|---|---|---|
| SYC-396 (dashboard redesign, In Progress) | Team cat page and History (`teamPages/catHistory.ts`, `teamCatView.ts`) | 3.3 and 4.2 rebase on whatever SYC-396 has merged. Check its open PRs before starting each. |
| SYC-152 ("Matched by hand") | Its buttons call the move route | Build it after 3.2. Comment on the ticket. |
| SYC-402 (matching game) | Its "same cat" and "Re-file" rows | When built, they call 3.2 and 4.1 and write a `game` duplicate report. Comment on the ticket. |
| SYC-63 (deletion) | `severPerson` gains new tables | 3.1, 4.1 and 5.1 each extend it, with tests |
| Launch week | Freeze on 28 Oct | Nothing here merges before the launch publish settles |

## What this plan does not do

- Guardians moving or merging (SYC-757).
- The "Matched by hand" list itself (SYC-152) and the matching game (SYC-402).
- Turning on the sweep (Rollout step 6 is Samuel's call).
- A "This might be the same cat as…" button (D9: no).
- Moving single photos (D2).

## What works with no signal

Nothing new here works offline. Every action is on the dashboard, which needs signal. The spotter's "Are these the same cat?" answer is sent with the reward-screen answers, which need signal today. If there is none, the question is simply not answered.

---

## Model delegation

Session model for this plan: **Opus 5.5**. Each PR goes to the cheapest tier that can do it; wherever it goes up, the table says why. **No Fable:** the design is approved, so nothing left needs the top tier. The risk sits in silent failures, which Opus builders, Opus reviewers and mutation probes cover.

| PR | Builder | Why this tier | Assurance |
|---|---|---|---|
| 0.1 | Haiku | Copying approved rows; the catalogue test checks them | Catalogue test; session model diffs against the spec |
| 1.1 | **Opus** | *Escalated:* every cat's answer goes through this. A wrong chain or undo rule gives wrong statuses with every test green. | Tests 15 and 16 core; **mutation probes (a) and (b)**; independent **Opus** review in its own worktree, told to make an undone merge still count |
| 1.2 grep list and rulings | **Opus** | *Escalated (plan review finding 12):* a missed reader is a silent failure, and the first list was already short | Hit list with a ruling per hit in the PR description; the session model checks the count matches its own grep |
| 1.2 applying the rulings | Sonnet | Applying one helper across a ruled list | Two structural guards plus their mutation probe; independent Sonnet review told to find a reader the list missed |
| 2.1 | **Opus** | *Escalated:* triggers are the integrity guarantee. A forged change that slips through is silent. | One mutation probe per trigger; rollback test; independent **Opus** review told to change a sighting's cat without a move |
| 3.1 | **Opus** | *Escalated:* authorship and the `elsewhere` rows decide every cat's status. A mistake looks exactly like a right answer. | Tests 2–5, 7, 27; three mutation probes; independent **Opus** review told to make a moved "clipped" count on both cats, or with team authority |
| 3.2 | **Opus** | *Escalated:* locks, races and deletion. A race is silent. | Tests 6, 8–13, 18 with real concurrent transactions; two mutation probes; independent **Opus** review told to leave a device id after deletion |
| 3.3 | Sonnet | Screens on existing patterns | Page tests; i18n parity; browser check at 390 px and desktop with data; independent Sonnet review |
| 4.1 | **Opus** | *Escalated:* merges, undo, follows, owners, points and the counting-phone helper. Double counting, lost owners and farmable points are silent. | Tests 14–22, 16a, 16b, 28; three mutation probes; independent **Opus** review told to double-count a sighting, pay twice, or strand a sighting on a merged-away cat |
| 4.2, 4.3 | Sonnet | Screens and an app banner | Page and app tests; i18n parity; browser check with a real merge in the data; independent Sonnet review |
| 5.1 | Sonnet, Opus spot review of the ladder | Standard list work; the gameable part, counting phones, is built on Opus in 4.1 | Tests 24, 25 and the reopen rule; mutation probe on counting phones |
| 5.2 | Sonnet | One question on an existing screen and route | Test 23; i18n parity; browser check at 390 px |
| 5.3 | Sonnet | A job behind a switch, and a script | Test 26; script against fixtures; the switch stays off |
| Adversarial review of each PR before merge | Its own worktree, never shared: Opus for 1.1, 2.1, 3.1, 3.2 and 4.1; Sonnet otherwise | Equal tier to the builder or higher | Findings folded in and listed on each PR |
| Production (migration, republish probes, calibration) | Session model | Production state isn't delegated | The rollout probes |

**Re-run delegated tests** (memory: *re-run delegated tests*). Before any PR is marked ready, the session model re-runs the named test files itself and greps that each claimed test exists. For typecheck it runs the pnpm-store `tsc` with no pipe and proves it can fail (memory: *local typecheck false green*).

## Crash-proofing for the build

- **Worktrees:** each PR is built in its own worktree off fresh `origin/main`. Review agents get their own worktrees too.
- **Commit after each numbered item, every time.** Every agent prompt restates this word for word. `CHECKPOINT.md` is updated after each commit and deleted before the PR is marked ready.
- **No nested agents:** agents never spawn other agents.
- **Commit before every mutation probe** (memory: *commit before probes*). A probe runner restores with `git checkout`, and a dirty tree loses work.
- **Drafts:** PRs open as drafts and are marked ready once (repo rule). Main's push CI is checked after each merge (memory: *check main's push CI after merge*).
- **Stopping mid-PR:** if a session stops mid-PR, it comments where it got to on SYC-150 or SYC-59 before stopping.

## Linear

| PR | Ticket |
|---|---|
| 0.1, 1.1, 1.2, 2.1 | SYC-410 (1.1, 1.2), and SYC-150 for the rest. Build sub-issues get created at build time if Samuel wants them tracked separately. |
| 3.1–3.3 | SYC-150 |
| 4.1–4.3, 5.1–5.3 | SYC-59 |

**Filed so far:** SYC-757 (guardians, from D5).

**Comments to add when this plan is approved:**
- SYC-152: the buttons call the move route from 3.2.
- SYC-402: "same cat" and "Re-file" call 4.1 and 3.2, and the game writes `game` reports.
- SYC-396: 3.3 and 4.2 touch History.
- SYC-63: the new tables in `severPerson`.

## Still needs Samuel

1. **Approve this plan**, or say what to change.
2. **Build sub-issues:** one Linear issue per PR, or keep the work on SYC-150, SYC-59 and SYC-410 as above? Recommendation: keep it on the three tickets. Thirteen sub-issues would be noise.
3. **When to start:** recommendation, after the launch publish settles (week of 3 November), starting with Slices 1 and 2 in parallel.

## Review outcome

An independent Sonnet critic reviewed this plan against `main` at `b30dfdec8` on 27 October 2026. It found 9 major and 4 minor issues. All are folded in:

| # | Finding | Where it's fixed |
|---|---|---|
| 1 | Points in 4.1 needed the counting-phone check, which 5.1 built | 4.1 item 5 builds it; 5.1 reuses it |
| 2 | The once-a-day points index would clash with duplicate points; the week board and stats weren't decided | C4, with a test and a mutation probe |
| 3 | 1.2's reader list was short, and the guards missed joins and raw SQL | 1.2 items 3 and 4: every shape, Opus rulings, three probes |
| 4 | Replacing the welfare cross-cat query would change live behaviour | C11 and 3.1 item 2: kept and generalised, with a regression test and probe |
| 5 | Test 18 was in the wrong PR; several spec items were in no PR | Test table, 3.1 item 3, 4.1 items 2 and 6 |
| 6 | 3.3 pointed at a merge screen that 4.2 builds | Order table and 4.2 |
| 7 | App releases and old builds weren't planned; nothing widened the notifications route | C5, 4.1, 5.2, Rollout "The phone app" |
| 8 | 2.1 had no tests that legitimate changes still pass | 2.1 |
| 9 | Migration details: volatile default, missing index, the kind check | 2.1, C12 |
| 10 | The dependency table contradicted itself; the switch name differed from the spec | Order table; `duplicate_sweep` |
| 11 | Rollout probes were vague, or wrote to Neon without warning | Rollout steps 1–4 |
| 12 | 1.2's list deserved Opus; commit before probes | Model delegation, Crash-proofing |
| 13 | Builder words in the plain-English section | In plain English |
