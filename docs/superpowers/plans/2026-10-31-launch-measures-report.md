# Launch measures report (SYC-795) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Launch measures" report on the team dashboard showing Samuel's five launch measures week by week against a post-launch baseline, the wait-time recording it needs (server and phone), and Samuel's "Matches to check" list.

**Architecture:** A pure counting module (`lib/reports/launchMeasures.ts`) fed by one loader, drawn by a server-rendered page in `teamPages/reportPages.ts`. This copies the Coverage report's structure. Wait time is two new nullable columns on `sighting_matches`, written once. The server part is written by `recordMatch`. The phone part arrives on a new `POST /sightings/{sightingId}/wait`. Matches to check is a server-drawn list like New cats to check, and it writes `team_action = 'looks_right'`.

**Tech Stack:** pnpm monorepo, Express api-server, drizzle (Postgres/Neon), vitest + supertest, Expo/React Native app (one bundle for phone and web), orval-generated API client from `lib/api-spec/openapi.yaml`.

**Spec:** `docs/superpowers/specs/2026-10-30-launch-measures-report-design.md` (draft 5, approved by Samuel 31 Oct 2026, Decision 1 = B). Read it alongside this plan. Section numbers below (§4.2 and so on) are the spec's.

## Global Constraints

- All weeks are Athens weeks (`lib/weeks.ts` / `reports/range.ts` `weeksIn`). A sighting counts in the week of `sightings.createdAt` (capture time).
- Reports are English-only: no edits to `artifacts/cat-spotter/lib/i18n.ts` or `teamPages/strings/*.ts`.
- No device id, name or position leaves the report module. Spotters are counts, never listed.
- Every percentage shows its count ("62% · 31 of 50"). Below 20 behind it: greyed, with "Too few to compare".
- The baseline is the first Athens Monday on or after `launch_date`. Days before it, after launch, form a "Launch days" row. Weeks before launch are "Before launch (testing)".
- "Since launch" is local to this report. Don't change `RangeKey` or the other reports' bars.
- The phone wait is whole milliseconds, 0 to 600000 inclusive. Both wait columns are written once.
- Test data: no wall clock (pass `now`), and cat names letters-only via the `nameTag` helper (#400). No `Date.now()` or hex in names.
- Every PR opens as a draft (`gh pr create --draft`). Run the affected tests locally, then `gh pr ready` once. Never `--auto`.
- Shared-area owners (repo CLAUDE.md), named in each builder brief:
  - **migrations**: PR 1's builder. This plan has exactly one migration.
  - **`teamPages/layout.ts`**: PR 3's builder.
  - **translation files**: nobody, because they're untouched.
- Commit after every task, with a checkpoint note in the worktree (`CHECKPOINT.md`, untracked).

## Review Focus

1. **The match record is missing on a resolved sighting** (the record failed to save). It must land in group 6 and never crash the accuracy rows. Pinned in Task 4.
2. **A sighting is matched again after a choice was made.** `recordMatch`'s `setWhere chosenAt IS NULL` skips the update, so `server_wait_ms` must still be the first value. Pinned in Task 2.
3. **Phone wait arrives before the match record exists** (the record failed to save), **or for a sighting from the offline queue**. The route must answer 204 without writing, never 500. Pinned in Task 7.
4. **`launch_date` set in the future or after today.** No baseline yet. Every week is "Before launch (testing)", and "Since launch" falls back to the last 3 months with the not-set message's sibling: "Launch is on [date]." Pinned in Task 3/5.
5. **A move after "Looks right"** must count as corrected in the report, though `team_action` stays `looks_right`. So corrections come from `sighting_moves`, not `team_action`. Pinned in Task 4 and Task 9.

---

## PR 1: the report, `launch_date`, the migration, the server's wait

Branch `claude/syc-795-pr1-report` off fresh `origin/main`, in its own worktree.

### Task 1: Migration, two wait columns and a new move source

**Files:**
- Modify: `lib/db/src/schema/sightingMatches.ts` (add columns and checks)
- Modify: `lib/db/src/schema/sightingMoves.ts:30` (`MOVE_SOURCES` gains `"match_check"`)
- Create: `lib/db/migrations/NNNN_launch_measures_wait.sql` + `meta/`, via `generate --name launch_measures_wait`

**Interfaces:**
- Produces:
  - `sightingMatchesTable.serverWaitMs: integer("server_wait_ms")` and `.phoneWaitMs: integer("phone_wait_ms")`, both nullable
  - check `sighting_matches_server_wait_ck`: `server_wait_ms IS NULL OR server_wait_ms >= 0`
  - check `sighting_matches_phone_wait_ck`: `phone_wait_ms IS NULL OR phone_wait_ms BETWEEN 0 AND 600000`
  - `MOVE_SOURCES` includes `"match_check"`, which PR 3 uses. It's folded into this one migration so the plan has only one.

- [ ] Step 1: Edit both schema files. Comment each column the way neighbours are commented: SYC-795, first successful match only, written once.
- [ ] Step 2: `pnpm --filter @workspace/db run generate --name launch_measures_wait`. Read the SQL. Add the commented rollback (drop both checks and columns, and restore the old `sighting_moves_source_ck` list). Note-lines in the rollback need `-- --`.
- [ ] Step 3: `pnpm --filter @workspace/db run migrate`, then `pnpm --filter @workspace/db test`. Expected: PASS, including runner.test (rollback restores the schema).
- [ ] Step 4: `pnpm --filter @workspace/db run migrate:check`. Expected: no drift.
- [ ] Step 5: Commit.

### Task 2: Record the server's part of the wait

**Files:**
- Modify: `artifacts/api-server/src/routes/sightings.ts`:
  - `computeMatchCandidates` (:300)
  - `recordMatch` (:508)
  - the three callers at :735, :765 and :890
  - `recordPhotoGone` (:491)
- Test: `artifacts/api-server/src/routes/sightings.waitTime.test.ts` (new; copy setup from `sightings.handPick.test.ts`)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces:
  - `computeMatchCandidates(req, sightingId, photos, lat, lng, receivedAt: Date)`. `receivedAt` is taken as the first line of each route handler (`POST /sightings`, `POST /sightings/:id/recheck`).
  - `recordMatch(req, sightingId, sets, receivedAt: Date | null)` writes `serverWaitMs = matcherFailed || receivedAt === null ? null : matchedAt − receivedAt`. On conflict, `serverWaitMs: sql\`coalesce(${t.serverWaitMs}, excluded.server_wait_ms)\``. `recordPhotoGone` passes `null`.

- [ ] Step 1: Write failing tests:
  - `records the server wait on a first successful match`: `server_wait_ms` is not null and ≥ 0.
  - `a resend of the same photos keeps the first server wait`: set the stored value to 1234 by SQL, resend, still 1234.
  - `a failed first match leaves it null, and a successful recheck fills it`: mock the matcher to throw, then succeed.
  - `a match after a choice changes nothing`: resolve, then resend, still the first value.

  Mock the matcher as the existing route tests do.
- [ ] Step 2: Run `pnpm --filter @workspace/api-server exec vitest run src/routes/sightings.waitTime.test.ts`. Expected: FAIL (column null).
- [ ] Step 3: Implement the signatures above.
- [ ] Step 4: Re-run. Expected: PASS. Also run `sightings*.test.ts` to check nothing else broke.
- [ ] Step 5: Commit.

### Task 3: The `launch_date` setting

**Files:**
- Modify: `lib/db/src/appSettings/shape.ts` (`SETTING_KEYS`, `settingShapeProblem`)
- Modify: `artifacts/api-server/src/lib/appSettings.ts` (`AppSettings.launchDate`, `settingsFromRows`)
- Test: `lib/db/src/appSettings/dbOps.settings.test.ts`, plus the api-server appSettings test beside the module

**Interfaces:**
- Produces:
  - `"launch_date"` in `SETTING_KEYS`
  - `settingShapeProblem("launch_date", v)` returns `"must be a real date written YYYY-MM-DD"` unless `v` is a string matching `^\d{4}-\d{2}-\d{2}$` that is a real calendar date with year ≥ 2026
  - `AppSettings.launchDate: string | null` (null when missing or bad). Team-only: comment it like `sterilisationPriceEur`.

- [ ] Step 1: Failing tests:
  - shape accepts `"2026-11-14"`
  - shape refuses `"2026-02-30"`, `"14/11/2026"`, `20261114` and `""`
  - `settingsFromRows([])` gives `launchDate === null`
  - a bad stored value gives `null`
  - `GET` of the public app-settings route (`routes/appSettings.ts`) has no `launchDate` key
- [ ] Step 2: Run both test files. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run. Expected: PASS.
- [ ] Step 5: Commit.

### Task 4: The counting module

**Files:**
- Create: `artifacts/api-server/src/lib/reports/launchMeasures.ts`
- Test: `artifacts/api-server/src/lib/reports/launchMeasures.test.ts` (pure, no database) and `launchMeasures.db.test.ts` (the loader and the Coverage cross-check)

**Interfaces:**
- Consumes:
  - `weeksIn` and `Range` from `./range`
  - `bucketWeeks` from `./coverage`
  - `sightingsIn` from `../dashboard/coverageCells`, reused for 4.1 so the two agree
  - `getAppSettings().launchDate`
- Produces:

```ts
export type WeekLabel = "before_launch" | "launch_days" | "baseline" | "after";
export interface LaunchRow {           // one per sighting in range, built by the loader
  at: Date; deviceId: string | null; resolved: boolean;
  match: null | {
    choice: "suggested" | "hand_pick" | "new_cat" | "unlabelled" | null;
    suggestedRank: number | null; missKind: "matcher_miss" | "distance_miss" | null;
    comparedCount: number; matcherFailed: boolean; noCatInAnyPhoto: boolean | null;
    teamAction: string | null; serverWaitMs: number | null; phoneWaitMs: number | null;
  };
  correctedByMove: boolean;            // a sighting_moves row with reason NOT IN ('merged','merge_undone')
}
export type MatchGroup = "not_finished" | "no_cat" | "suggested" | "hand_pick" | "new_cat" | "other";
export type AccuracyRow = "right_first" | "right_lower" | "corrected" | "missed_compared" | "missed_far" | "missed_nothing";
export function weekLabels(starts: readonly Date[], launchDate: string | null): { at: Date; label: WeekLabel }[];
export function matchGroup(r: LaunchRow): MatchGroup;
export function accuracyRow(r: LaunchRow): AccuracyRow | null;   // null = not counted (§4.3)
export function launchMeasuresFrom(rows: readonly LaunchRow[], range: Range, launchDate: string | null, now: Date): LaunchMeasures;
export async function launchMeasuresReport(range: Range, now: Date): Promise<LaunchMeasures>;
export const FEW = 20; export const STILL_OPEN_MS = 48 * 3_600_000; export const MAX_PHONE_WAIT_MS = 600_000;
```

`LaunchMeasures` holds:
- `weeks: { at, label, stillOpen: { notFinished: boolean; followUp: boolean } }[]`
- per week:
  - `sightings`, `spotters`, `returning`
  - `groups: Record<MatchGroup, number>` and `matcherDownInHandOrNew`
  - `accuracy: Record<AccuracyRow, number>`
  - `checked: { right, total }`, where `right` is `teamAction='looks_right' && !correctedByMove` and `total` is suggestions with `teamAction='looks_right'` or `correctedByMove`
  - `corrected` and `suggestionsTaken`
  - `wait: { phoneP50, phoneP90, serverP50: number | null; matcherDown, noPhoneWait, overTen: number }`
  - `followUp: { eligible, cameBack }`
- `withoutSpotter`, `launchDate`, `phoneWaitFrom: Date | null` (the earliest `phoneWaitMs`)
- `workedOutAt`, `ms`

Rules the implementer can't infer from the spec:
- `matchGroup` order is exactly §4.2's:
  1. `!resolved` → `not_finished`
  2. `match?.noCatInAnyPhoto` → `no_cat`
  3. choice `suggested`, then `hand_pick`, then `new_cat`
  4. anything else, including `match === null` → `other`
- `accuracyRow` is null unless `!matcherFailed` and the choice is `suggested` or `hand_pick`. Then, in order:
  - `suggested` with `correctedByMove` → `corrected`
  - `suggested` with rank 1 → `right_first`
  - `suggested` with rank 2 or more → `right_lower`
  - `hand_pick` with `missKind === "matcher_miss"` → `missed_compared`
  - `hand_pick` with `distance_miss` and `comparedCount > 0` → `missed_far`
  - otherwise → `missed_nothing`
- "Returning": the device sent a sighting in an earlier week whose start is ≥ the launch date. Before launch, or with no date, it's always 0.
- Follow-up (§4.5): `eligible` is resolved sightings with a device. `cameBack` is those where the same device has another sighting with `at` in (`at`, `at` + 7 days]. The loader must fetch 7 days past `range.to` for this. `stillOpen.followUp` is true for any week whose end is after `now − 7 days`.
- `stillOpen.notFinished` is true when the week's end + `STILL_OPEN_MS` > `now`.
- Wait (§4.4):
  - only rows with `!matcherFailed` and `serverWaitMs !== null`
  - phone values > `MAX_PHONE_WAIT_MS` go to `overTen` and are left out of the medians (the database already refuses above 600000, so this guards old rows only)
  - `matcherDown` counts `matcherFailed`
  - percentiles use nearest-rank on sorted values, and return null when there are no values

- [ ] Step 1: Write failing pure tests (fixture builders in the test file, fixed dates, no wall clock):
  - `weekLabels`: launch Tue 2026-11-17 gives `launch_days` for the week of 16 Nov and `baseline` for 23 Nov. Launch Mon 2026-11-16 gives `baseline` for 16 Nov. A `null` date makes every week `before_launch`. A launch after the last week also makes every week `before_launch`.
  - `matchGroup`: unresolved with noCat → `not_finished`. Resolved, noCat and hand pick → `no_cat`. Resolved with `match: null` → `other`.
  - The six groups sum to `sightings` for a mixed week.
  - `accuracyRow`: rank-1 with `correctedByMove` → `corrected` only. Rank-1 on a since-merged cat (no correcting move, because merge moves are excluded by the loader) → `right_first`. `looks_right` then a move → counted in `checked.total` but not `checked.right`.
  - Spotters: a null device counts in sightings, not spotters. Returning counts only after launch.
  - Follow-up: a device's second sighting 6 days later counts, 8 days later doesn't, a null device isn't eligible, and the last 7 days are `stillOpen`.
  - Wait: medians of [1000, 2000, 3000] give p50 2000. An empty week gives null. A matcherFailed row counts in `matcherDown` only. A row with a server wait but no phone wait counts in `noPhoneWait`.
- [ ] Step 2: Run `vitest run src/lib/reports/launchMeasures.test.ts`. Expected: FAIL (module missing).
- [ ] Step 3: Implement the pure functions, then the loader. Each sighting LEFT JOINs `sighting_matches`. An EXISTS on `sighting_moves` with the reason not `merged`/`merge_undone` gives `correctedByMove`. `comparedCount` is `cardinality(compared_cat_ids)`, with 0 for null.
- [ ] Step 4: DB test `launchMeasures.db.test.ts`:
  - **Coverage cross-check:** seed a few sightings in two weeks, including one spotted in week 1 with created-at in week 1 but inserted later. Per-week `sightings` equals `coverageReport(range, now).perWeek`, and the period's distinct spotters equal `coverage.spotters`.
  - **Merge move:** a merge move doesn't set `correctedByMove`.
- [ ] Step 5: Run both. Expected: PASS.
- [ ] Step 6: Commit.

### Task 5: The page, "Since launch", routes, downloads, guard

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/reportPages.ts`:
  - `REPORTS`: add `{ key: "launch", title: "Launch measures", about: "How the app is being used since launch, week by week.", built: true }` after `vet`
  - `renderLaunchPage`, `launchTables`
  - CSV keys and `csvFilename`
- Modify: `artifacts/api-server/src/routes/teamReportsArea.ts` (the page and `.csv` branches)
- Modify: `artifacts/api-server/src/lib/guardianView.source.test.ts` (`ISLAND_ONLY_MODULES["lib/reports/launchMeasures.ts"]`, fns `["launchMeasuresReport"]`, capabilities `["view_reports", "export_report"]`)
- Test: `artifacts/api-server/src/lib/teamPages/launchPage.test.ts` (render, pure) and `artifacts/api-server/src/routes/teamReportsArea.launch.test.ts` (access)

**Interfaces:**
- Consumes: `LaunchMeasures`, `launchMeasuresReport` (Task 4); `AppSettings.launchDate` (Task 3).
- Produces:
  - `launchRange(q: unknown, now: Date, launchDate: string | null): Range & { sinceLaunch: boolean }`
    - with no `range` param and a past launch date: from Athens midnight of the launch date to `now`, label "Since launch"
    - `range=since` means the same
    - otherwise `parseRange`
    - no date, or a future date: the last 3 months
  - `renderLaunchPage(r: LaunchMeasures, o: { personName: string; range: Range & { sinceLaunch: boolean }; canExport: boolean; now: Date }): string`
  - `launchTables(r, forCsv): { weeks: TableSpec; matched: TableSpec; accuracy: TableSpec; wait: TableSpec; followUp: TableSpec }`
  - CSV keys `launch-use`, `launch-matched`, `launch-accuracy`, `launch-wait` and `launch-follow`, with filenames `launch-sightings-and-spotters`, `launch-share-matched`, `launch-matching-accuracy`, `launch-match-wait` and `launch-follow-up`. Each has a `baseline` column (`yes`/empty) and dates YYYY-MM-DD.

Exact copy, from the spec, used verbatim:
- "Launch date not set yet. Showing the last 3 months."
- "Before launch (testing)", "Launch days", "Baseline (first full week after launch)", "Still open", "Too few to compare", "Not enough checked yet", "Phone wait not recorded yet", "Phone wait recorded from [d Mon yyyy]", "Matcher down or timed out"
- "Counted by the day each cat was spotted. Sightings sent late are added to the week they were spotted, so recent weeks can still grow."
- "Figures change as records are corrected"
- "A spotter here is a phone or browser. One person on two devices counts twice."
- "November is the quiet season on Syros. A drop may be the season, not the app."
- "The headline counts a suggestion nobody checked as right. The checked figure is the one to trust once it has enough behind it."
- "The follow card isn't switched on yet. This is the 'before' figure it will be compared against."
- The two follow-up notes from §4.5, naming SYC-624 and SYC-524's asks in plain words.

Baseline differences read "+12 on baseline" and "−3 points on baseline". No colour on differences.

Charts: reuse `reports/charts.ts`:
- line charts for sightings/spotters and wait
- a stacked bar for the six groups (add a stacked-bar helper to `charts.ts` only if none exists; test it in `charts.test.ts`)

- [ ] Step 1: Failing render tests:
  - the not-set message appears when `launchDate` is null
  - a baseline row is marked
  - "62% · 31 of 50" formatting is right
  - a 19-sighting week shows "Too few to compare"
  - `checked.total` 19 gives "Not enough checked yet"
  - `phoneWaitFrom: null` gives "Phone wait not recorded yet"
  - no download links without `canExport`
  - the page contains no device id from the fixture
  - snapshot the HTML as the other report tests do
- [ ] Step 2: Failing route tests:
  - no `view_reports` → the usual refusal
  - `view_reports` without `export_report` → `.csv` refused
  - each CSV has a header row with `baseline` and YYYY-MM-DD dates
  - downloads are logged in `report_downloads` like Coverage's
- [ ] Step 3: Run. Expected: FAIL.
- [ ] Step 4: Implement. Register the guard entry.
- [ ] Step 5: Run the two new files plus `guardianView.source.test.ts` and `reportPages*.test.ts`. Expected: PASS.
- [ ] Step 6: Commit.

### Task 6: Check the screens, run the full suite, open PR 1

- [ ] Step 1: Run the full api-server suite (the welfare-guard memory: run it all before ready), with the pnpm-store tsc and no pipe.
- [ ] Step 2: Preview the page locally: scratch DB, planted `__Host-cs_team` cookie, `PRELAUNCH_GATE=off`, real-shaped seeded data across 4 weeks with `launch_date` set. Screenshot it at 390px and desktop. Fix anything broken.
- [ ] Step 3: `gh pr create --draft`. The body says:
  - **Migrate before republish:** the migration must reach production before Samuel republishes
  - after merge, set `launch_date` once it's known (SYC-345)
- [ ] Step 4: Adversarial review (a critic subagent in its own worktree). Fold in fixes, then `gh pr ready` and wait for a real "Test and build" pass.

---

## PR 2: the phone wait

Branch `claude/syc-795-pr2-phone-wait`, stacked on PR 1 (needs its migration). It stays a draft until PR 1 merges.

### Task 7: `POST /sightings/{sightingId}/wait`

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (operation `recordPhoneWait`, tag sightings, body `{ deviceId: string, waitMs: integer, minimum 0, maximum 600000 }`, 204/400/403/404)
- Run: `pnpm --filter @workspace/api-spec run codegen`
- Modify: `artifacts/api-server/src/routes/sightings.ts` (new handler after `recheck`)
- Test: `artifacts/api-server/src/routes/sightings.phoneWait.test.ts`

**Interfaces:**
- Produces:
  - `RecordPhoneWaitBody` (zod, generated)
  - `recordPhoneWait(sightingId, body)` in `@workspace/api-client-react`
  - the handler: 404 if the sighting is unknown; 403 "Not your sighting" if `body.deviceId !== sighting.deviceId`; `verifyDeviceSecret`; then `UPDATE sighting_matches SET phone_wait_ms = $1 WHERE sighting_id = $2 AND phone_wait_ms IS NULL AND matcher_failed = false`; always 204 after the checks pass, whether or not a row changed
  - it uses the existing per-device limiter style: `sharedLimiter`, not `aiLimiter`

- [ ] Step 1: Failing tests:
  - writes once (a second post with another value keeps the first)
  - another device → 403
  - wrong secret → refused as other routes are
  - `waitMs` −1, 600001, 1.5 or "100" → 400
  - no match record → 204 and nothing written
  - matcher failed → 204 and nothing written
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run. Expected: PASS. Also run `pnpm -w run typecheck:libs`.
- [ ] Step 5: Commit.

### Task 8: The app times the live send

**Files:**
- Create: `artifacts/cat-spotter/lib/phoneWait.ts`
- Modify: `artifacts/cat-spotter/app/(tabs)/spot.tsx` (around the `send` in `submitSighting`, :931)
- Modify: `artifacts/cat-spotter/app/review.tsx` (the recheck success path)
- Test: `artifacts/cat-spotter/lib/__tests__/phoneWait.test.ts`

**Interfaces:**
- Consumes: `recordPhoneWait` (Task 7).
- Produces:
  - `startPhoneWait(clock = () => performance.now()): () => number | null`. It returns a stop function giving whole ms, or null if over 600000 or negative.
  - `reportPhoneWait(post: (id: number, body: { deviceId: string; waitMs: number }) => Promise<unknown>, sightingId: number, deviceId: string, waitMs: number | null): void`. Fire-and-forget: it never throws, never awaits in the caller, and does nothing when `waitMs` is null.

Wiring:
- In `spot.tsx`, start the timer at the top of `send` (before shrinking the photo).
- Stop it when `createSighting` resolves.
- Call `reportPhoneWait` only when `outcome.kind === 'sent'` and the answer isn't matcher-failed (`waitOutcomeForSend` already knows).
- The `save` path and `OfflineContext.tsx`'s replay never call it.
- In `review.tsx`, time from the "Check again" tap to a successful recheck answer.
- A retried send after a failure starts a new timer on the new tap.

- [ ] Step 1: Failing tests, with an injected clock:
  - start 1000, stop 3500 → 2500
  - 700000 ms → null
  - `reportPhoneWait` with null doesn't call `post`
  - a rejecting `post` doesn't throw or surface (await a microtask, no unhandled rejection)
  - `OfflineContext` source never imports `phoneWait`: a source test in the repo's existing style
- [ ] Step 2: Run `pnpm --filter cat-spotter exec vitest run lib/__tests__/phoneWait.test.ts` (use the ESBUILD_BINARY_PATH workaround if esbuild is stripped). Expected: FAIL.
- [ ] Step 3: Implement and wire.
- [ ] Step 4: Run, plus the existing spot/review tests. Expected: PASS.
- [ ] Step 5: Preview on web: send one sighting and check `phone_wait_ms` is set in the scratch DB. Check at 390px that nothing on screen changed.
- [ ] Step 6: Commit, open the draft PR stacked on PR 1, and run the critic review. Mark it ready after PR 1 merges (retarget to main first, per the stacked-PR memory).

---

## PR 3: Matches to check

Branch `claude/syc-795-pr3-matches-to-check` off `origin/main` after PR 1 merges (needs `match_check` in `MOVE_SOURCES`). It doesn't need PR 2.

### Task 9: The list and "Looks right"

**Files:**
- Create: `artifacts/api-server/src/lib/matchesToCheck.ts`
- Modify: `artifacts/api-server/src/lib/moveSightings.ts:67` (`MOVE_SOURCES_FROM_SCREEN` gains `"match_check"`)
- Test: `artifacts/api-server/src/lib/matchesToCheck.test.ts`
- Modify: `guardianView.source.test.ts` (register, capability `["move_sighting"]`)

**Interfaces:**
- Consumes: `getAppSettings().launchDate`.
- Produces:
  - `matchesToCheck(launchDate: string | null): Promise<MatchToCheck[]>`, where `MatchToCheck = { sightingId, catId, catName, rank, spottedAt: Date, area: string, sightingPhotoUrl, catPhotoUrl }`
    - what's listed: `choice='suggested'`, `team_action IS NULL`, no non-merge move, sighting `created_at` ≥ Athens midnight of the launch date
    - ordered `created_at, id` ascending
    - the cat is the canonical cat (`canonicalCatOf`), its photo from `catDisplayPhotos`
    - an empty list when `launchDate` is null
  - `matchesToCheckCount(launchDate): Promise<number>`
  - `markLooksRight(person: Person, sightingId: number): Promise<"done" | "already">`
    - `UPDATE … SET team_action='looks_right', team_by_account_id=person.id, team_at=now() WHERE sighting_id=$1 AND team_action IS NULL AND choice='suggested'`
    - `team_cat_id` stays null, which the check constraint requires
    - refuses (`MoveRefused("NOT_AUTHORISED")`-style) without `move_sighting`

- [ ] Step 1: Failing tests:
  - lists only unchecked, unmoved suggestions since launch, oldest first
  - a hand pick isn't listed
  - a merge-moved sighting is still listed, while a correction-moved one isn't
  - `markLooksRight` twice → "done" then "already", with `team_at` unchanged
  - after a move, `markLooksRight` → "already"
  - no `move_sighting` → refused
  - after "Looks right" then a move, `launchMeasuresFrom` counts it `corrected` (uses Task 4)
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run. Expected: PASS.
- [ ] Step 5: Commit.

### Task 10: The page, routes, home count, layout

**Files:**
- Create: `artifacts/api-server/src/lib/teamPages/matchesToCheckPage.ts` (built like `newCatsPage.ts`)
- Modify: `artifacts/api-server/src/routes/teamHome.ts` (GET `/team/matches-to-check`, `requireTeam("move_sighting")`; the home count only when `can(person, "move_sighting")`, with a failed count hiding the tile, as `duplicates` does)
- Modify: `artifacts/api-server/src/routes/teamDuplicates.ts` or a new `routes/teamMatchCheck.ts` (POST `/team/matches-to-check/:sightingId/looks-right`, `...formRoute("move_sighting")`, 303 back to the list)
- Modify: `artifacts/api-server/src/lib/teamPages/homePage.ts` (a tile: `"match to check"`/`"matches to check"`, about "Suggestions spotters took. Check the photo matches the cat.")
- Modify: `artifacts/api-server/src/lib/teamPages/layout.ts:18,50` (`NavKey` gains `"matchcheck"`; `TEAM_PARENT.matchcheck = "home"`). **Layout owner: this builder.**
- Test: `artifacts/api-server/src/routes/teamMatchCheck.test.ts`

**Interfaces:**
- Consumes: Task 9.
- Produces:
  - the "Different cat" link `/api/team/sightings/move?cat=<catId>&s=<sightingId>&source=match_check`
  - each row: the two photos side by side (stacked under 480px), "<name> · #<id>", "<area> · <d Mon yyyy>", "1st/2nd/3rd suggestion", and the two buttons with 44px tap targets

- [ ] Step 1: Failing tests:
  - no `move_sighting` → refusal, and Home has no tile
  - with it → the tile shows the count
  - the list is oldest first
  - POST "Looks right" without Origin is refused (formRoute)
  - POST with it → 303, and the row is gone
  - the "Different cat" link opens the move screen with the sighting ticked
  - the page has no `<script>`
- [ ] Step 2: Run. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run, plus the layout and home tests and `guardianView.source.test.ts`. Expected: PASS.
- [ ] Step 5: Preview at 390px and desktop with real-shaped seeded data. Screenshot both.
- [ ] Step 6: Commit, open the draft PR, run the critic review, then mark it ready.

---

## After all three merge (part of /ship, not optional)

- Linear:
  - SYC-795 → Done with the PR numbers
  - SYC-345 note: "set `launch_date`"
  - SYC-45 note: record the follow card's switch-on date
  - SYC-389 and SYC-376: point to the report
  - SYC-56 note: Samuel's checks are its first labelled set
- Remove the worktrees and branches. Pull main in the primary checkout.
- Republishing waits until the migration is on production.

## Model delegation

Session model: Opus 5.5.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1 migration + Task 3 setting | Sonnet | mechanical, pattern exists, exact values in plan | `migrate:check` + `lib/db` runner.test; the session model reads the SQL and rollback before commit |
| Task 2 server wait in `recordMatch` | Opus (session) | subtle: the upsert's `setWhere` and the `coalesce` interact, and getting it wrong is a **silent** failure (wrong-but-plausible numbers) | the four tests, plus a **mutation probe**: drop the `coalesce`, and "resend keeps the first" must go red; drop `matcherFailed ? null`, and the failure test must go red |
| Task 4 counting module | Opus (session) | the heart of the report; group/accuracy order and exclusions are silent-failure territory | pure tests + DB cross-check with Coverage; a **mutation probe** on each of: group order (swap rules 1/2), the merge-move exclusion, and `MAX_PHONE_WAIT_MS`. Each must turn a named test red |
| Task 5 page, routes, CSVs, guard | Sonnet | standard page copying `renderCoveragePage` with exact copy given | render + route tests, the guard test, a spot review of the diff by the session model, and screenshots at 390px/desktop |
| Task 7 phone-wait route + OpenAPI | Sonnet | clear contract, existing route pattern | tests incl. refusals; `typecheck:libs` after codegen; a spot review of the auth order (owner check then secret) by the session model |
| Task 8 app timing | Sonnet | small helper + wiring, clear rules | helper tests with an injected clock; web preview probe that `phone_wait_ms` is written; the session model reviews the spot.tsx diff to confirm the save/offline paths never call it |
| Task 9–10 Matches to check | Sonnet | follows `newCatsPage` / duplicates patterns | tests incl. the looks-right→moved→corrected test; a **mutation probe** on `team_action IS NULL` in `markLooksRight`; screenshots at 390px/desktop |
| Adversarial review per PR | Opus critic, own worktree | independent read of a change Claude built (Samuel's "review and merge" rule); Fable not needed for a contained report | a findings list; each finding re-checked in code before change |
| Re-running delegated tests | Opus (session) | the "re-run delegated tests" memory: an agent's "tests pass" can be false | re-run each named file; grep that the claimed tests exist |

Every builder prompt restates: **commit after each task, and keep a checkpoint note in the worktree.**

At most 3 builder sessions for this work, and they run in sequence (PR 1 → PR 2 and PR 3 in parallel), keeping within the 5-builder cap with other work.
