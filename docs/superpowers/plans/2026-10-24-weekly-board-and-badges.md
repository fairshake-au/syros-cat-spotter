# Weekly Spotters Board and Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly Spotters board, 15 new badges (22 in all) saved once earned, a once-a-day-per-cat points rule, and a full-screen badge celebration with sound, buzz and a Monday push for weekly winners.

**Architecture:** Every points award is written to a new dated ledger inside the existing resolve transaction, alongside the spot's area and whether it's on the island. Badges move from "computed from four totals" to a catalogue evaluated inside that transaction, with earned badges and "celebration moments" saved in their own tables. A weekly close, run from the existing drain and opportunistic hooks, freezes each week's top three, awards Podium and Champion, and sends pushes in a Monday-morning window. The app reads a new weekly-board endpoint, server-computed badge progress, and a queue of moments that one full-screen celebration component plays.

**Tech Stack:** Postgres and drizzle (`lib/db`), Express and vitest with a real Postgres (`artifacts/api-server`), OpenAPI and orval codegen (`lib/api-spec`), Expo/React Native with reanimated, expo-haptics, the new `expo-audio`, vitest with react-native-web (`artifacts/cat-spotter`).

**Spec:** `docs/superpowers/specs/2026-10-24-weekly-board-and-badges-design.md` (approved 24 Oct 2026, SYC-706). Read it before any task. This plan decides *how*; the spec decides *what*.

## Global Constraints

- Week = Monday 00:00 to next Monday 00:00, `Europe/Athens`. A day for the once-a-day rule = an Athens calendar day. Reuse `STREAK_TIMEZONE` from `artifacts/api-server/src/lib/streak.ts`.
- Points: `POINTS_NEW_CAT = 25`, `POINTS_CONFIRM = 15` (unchanged, `routes/sightings.ts:66-67`). The first spot of a given cat by a given spotter on a given Athens day earns points; later ones that day earn 0. Points already earned are never recalculated.
- Badge ids are new snake_case strings: `weeks_2`, `weeks_4`, `weeks_8`, `podium`, `champion`, `discover_25`, `discover_50`, `discover_100`, `areas_3`, `areas_8`, `areas_all`, `pathfinder`, `trailblazer`, `remote_1`, `remote_5`. The 7 existing ids are unchanged.
- Badges are never taken away. No code path deletes a `spotter_badges` row except account deletion.
- Pathfinder quiet period: 30 days. Area radius: 2 km (`MAX_KM`, `namedAreas.ts:29`). Remote = on the island (the `SYROS_RECT` box plus `SYROS_MARGIN_DEG = 0.02`, the rule `artifacts/cat-spotter/lib/island.ts` already uses) **and** in no area.
- Push window for weekly results: from 08:00 to 20:00 Athens on the Monday the week closes. Never outside it. Pushes and bell entries never name an area or place.
- Copy rules: "spotter" (never "snapper"), "cat guardian". Every new string goes in `en`, `el` and `fr` in `artifacts/cat-spotter/lib/i18n.ts`, and the French uses *tu*.
- Old app builds must keep working: `GET /leaderboard` keeps its array shape, and `ResolveResult.newBadges` stays a `string[]`. New data comes in new fields or new routes.
- Every PR is opened as a draft. Run the affected tests locally, then `gh pr ready` once. A skipped check is not a pass. Never use `gh pr merge --auto`.
- Local test setup: from `artifacts/api-server`, `DATABASE_URL=postgres://samuelporter@localhost:5432/postgres AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key npx vitest run <file>`. Client tests need `ESBUILD_BINARY_PATH` (see `docs/superpowers/plans/2026-10-23-cat-page-tabs-and-following.md:17`).
- Commit after each step that leaves the tree green. Commit before any mutation probe (probe runners restore with `git checkout`).

## Review Focus

1. **Two spots resolved at the same moment** (two phones, or a retry): both see the same "before" state. Expect exactly one points award per cat per day, and each badge celebrated exactly once. Pinned by `T3: concurrent resolves of the same cat on one day award points once` and `T6: concurrent resolves celebrate a new badge once`.
2. **Week boundary at Sunday 23:59:59 vs Monday 00:00:00 Athens**, including the Sundays the clocks change (29 Mar and 25 Oct 2026). Expect the spot to fall into the right week. Pinned by `T1: weekStartAthens at the boundaries and both clock changes`.
3. **A spotter deletes their account after a week they placed in.** Expect last week's top three unchanged, with that row reading "a spotter", and nothing that names their device left anywhere. Pinned by `T4: deleting a podium spotter keeps the frozen week` plus the existing column scan in `me.delete.test.ts`.
4. **The server is down all Monday, or the drain runs at 21:00.** Expect the week to close once, with no push after 20:00, and the celebration still queued. Pinned by `T9: a close at 21:00 Monday sends no push` and `T9: two closes at once close the week once`.
5. **The team retires or adds an area after people have earned area badges.** Expect earned badges to stay, and progress for "All of Syros" to show complete for holders. Pinned by `T5: retiring an area never removes areas_all and progress shows complete`.

---

## PR A: Foundation: ledger, places, once-a-day points (Tasks 0–4)

### Task 0: Measure the remote gap (read-only probe, no code)

The spec says the builder counts real spots that fall more than 2 km from every area centre, then tells the team.

- [ ] **Step 1:** On the production database (read-only query through the Neon connector `run_sql`; if auto mode blocks it, ask Samuel to switch to "ask" mode, per memory), count resolved, unredacted sightings whose nearest current area centre is over 2 km away. Split them into inside the island box and outside it. Use the `named_areas` rows where `retired_at is null` and the haversine formula in SQL.
- [ ] **Step 2:** Post the counts as a comment on SYC-706, quoting the query and its run time. Do not change areas.

### Task 1: Schema and migration `0046_weekly_board_and_badges`

**Files:**
- Create: `lib/db/src/schema/badges.ts`
- Modify: `lib/db/src/schema/sightings.ts` (two columns), `lib/db/src/schema/index.ts` (one export line)
- Create (generated, then hand-edited rollback): `lib/db/migrations/0046_weekly_board_and_badges.sql`, `meta/0046_snapshot.json`, `meta/_journal.json`
- Create: `artifacts/api-server/src/lib/weeks.ts`, `artifacts/api-server/src/lib/weeks.test.ts`

**Interfaces (Produces):**
- `pointsLedgerTable` (`points_ledger`): `id serial pk`, `deviceId text` (nullable, for deletion), `sightingId integer not null unique`, `catId integer not null`, `points integer not null`, `athensDay date not null`, `weekStart date not null`, `earnedAt timestamptz not null default now()`, `source text not null` (`'live' | 'history'`). A partial unique index `points_ledger_once_a_day_uq` on `(device_id, cat_id, athens_day) where points > 0`. An index on `(week_start, device_id)`.
- `spotterBadgesTable` (`spotter_badges`): `deviceId text not null`, `badgeId text not null`, `earnedAt timestamptz not null default now()`, `source text not null` (`'live' | 'history' | 'week'`), `seenAt timestamptz` (null = shows "New"). Primary key `(device_id, badge_id)`.
- `badgeMomentsTable` (`badge_moments`): `id serial pk`, `deviceId text not null`, `kind text not null` (`'badges' | 'week_result' | 'history'`), `badgeIds text[] not null`, `weekStart date`, `place integer`, `weekPoints integer`, `createdAt timestamptz default now()`, `celebratedAt timestamptz`. No jsonb (keeps the deletion column scan simple).
- `weeklyClosesTable` (`weekly_closes`): `weekStart date pk`, `closedAt timestamptz not null`, `pushedAt timestamptz`.
- `weeklyResultsTable` (`weekly_results`): `weekStart date not null`, `place integer not null`, `deviceId text` (null once deleted), `displayName text` (null renders "a spotter"), `points integer not null`. Primary key `(week_start, device_id)` is not possible with nulls, so use `id serial pk` plus a unique index on `(week_start, device_id)`.
- `sightingsTable` gains `areaKey text` (null = not yet stamped; `'off'` = in no area) and `onIsland boolean`.
- `weeks.ts`: `athensDay(at: Date): string` ("YYYY-MM-DD"), `weekStartAthens(at: Date): string` (the Athens Monday's date), `weekStartInstant(weekStart: string): Date` (the UTC instant of that Monday 00:00 Athens), `nextWeekStartInstant(at: Date): Date`.

- [ ] **Step 1: Write the failing test** `weeks.test.ts`:
  - `weekStartAthens at the boundaries and both clock changes`: `weekStartAthens(new Date("2026-10-25T20:59:59Z")) === "2026-10-19"`; `weekStartAthens(new Date("2026-10-25T22:00:00Z")) === "2026-10-26"` (Athens is UTC+2 after the 25 Oct change); `weekStartAthens(new Date("2026-03-29T20:59:59Z")) === "2026-03-23"`; `weekStartAthens(new Date("2026-03-29T21:00:00Z")) === "2026-03-30"`.
  - `weekStartInstant` round-trips: `weekStartInstant("2026-10-26").toISOString() === "2026-10-25T22:00:00.000Z"`.
  - `athensDay(new Date("2026-10-24T21:30:00Z")) === "2026-10-25"`.
- [ ] **Step 2:** Run it and confirm it fails (module not found).
- [ ] **Step 3:** Implement `weeks.ts` with `Intl.DateTimeFormat("en-CA", { timeZone: STREAK_TIMEZONE })` for the day and a weekday lookup for Monday. Don't add a date library.
- [ ] **Step 4:** Run it and confirm it passes. Commit.
- [ ] **Step 5:** Write `badges.ts` with the tables above, add the two `sightings` columns, and add the index export. Run `pnpm --filter @workspace/db run generate --name weekly_board_and_badges`. Append a rollback block that drops the five tables and the two columns, with every line commented `-- ` and notes written as `-- --` (memory: rollback block comments).
- [ ] **Step 6:** Run `pnpm --filter @workspace/db run migrate:check` and `pnpm --filter @workspace/db test` (up/down/up). Both must pass. Commit.

### Task 2: Where a spot is: area and island

**Files:**
- Create: `artifacts/api-server/src/lib/areas/placeFor.ts`, `placeFor.test.ts`
- Modify: `artifacts/cat-spotter/lib/island.ts` (doc comment only: the server copy now exists)

**Interfaces:**
- Consumes: `areaForIn`, `currentAreas`, `OFF_SYROS` from `namedAreas.ts`.
- Produces: `placeFor(lat: number, lng: number, areas?: readonly NamedArea[]): { areaKey: string; onIsland: boolean }`. `areaKey` is the area key or `"off"`. `onIsland` uses a server copy of `SYROS_RECT`/`SYROS_MARGIN_DEG`/`isOnSyros`, copied unchanged from the client. `isRemote(p: { areaKey: string; onIsland: boolean }): boolean` returns `areaKey === "off" && onIsland`.

- [ ] **Step 1: Failing tests:** Ermoupoli's centre gives `{areaKey: "ermoupoli", onIsland: true}`. A point 3 km from every seed centre but inside the box (take one from Task 0's results, or `37.47, 24.99` checked against the seeds) gives `areaKey "off"`, `onIsland true`, `isRemote true`. Athens (`37.98, 23.73`) gives `onIsland false`, `isRemote false`. Plus a pin test: the server's `SYROS_RECT` and `SYROS_MARGIN_DEG` text equals the client's (read the client file as text, as `badgeProgress.test.ts` does today).
- [ ] **Step 2:** Run the tests and confirm they fail. **Step 3:** Implement. **Step 4:** Run and confirm they pass. Commit.

### Task 3: Once-a-day points and the ledger in the resolve transaction

**Files:**
- Modify: `artifacts/api-server/src/routes/sightings.ts:976-1060` (inside `db.transaction(async (tx) => …)`)
- Create: `artifacts/api-server/src/lib/pointsLedger.ts`
- Test: `artifacts/api-server/src/routes/sightings.pointsLedger.test.ts` (pattern: `sightings.resolve.test.ts`)

**Interfaces:**
- Produces: `awardPoints(tx, { deviceId, sightingId, catId, isNewCat, at }): Promise<{ points: number; repeatToday: boolean }>`. It takes `pg_advisory_xact_lock(hashtext('points:' || deviceId), catId)`, checks for a `points > 0` row for `(deviceId, catId, athensDay(at))`, inserts the ledger row (`source 'live'`), and returns the points. The caller adds `points` to `profiles.points` only when it is above 0.
- The sighting's `areaKey`/`onIsland` are stamped by `placeFor` in the same guarded `pending → resolved` update.
- The response gains `pointsReason: "repeat_today" | null`. `pointsAwarded` is `0` on a repeat.

- [ ] **Step 1: Failing tests:**
  - `first spot of a cat today earns 15 and writes a live ledger row with this week's weekStart`
  - `second spot of the same cat the same Athens day earns 0 with pointsReason repeat_today, and profile points rise by 15 only`
  - `the same cat the next Athens day earns 15 again` (use the sighting `createdAt` override that the existing tests use, or inject `at`)
  - `a new cat earns 25`
  - `concurrent resolves of the same cat on one day award points once` (two `Promise.all` resolves of two pending sightings, same device and cat; the sum of the points is 15)
  - `the resolved sighting has areaKey and onIsland stamped`
- [ ] **Step 2:** Run the tests and confirm they fail. **Step 3:** Implement. Keep `POINTS_*` where they are. **Step 4:** Run this file and `sightings.resolve.test.ts` and confirm they pass.
- [ ] **Step 5: Mutation probe** (silent-failure guard): commit, then delete the `points > 0` existence check in `awardPoints` and confirm `second spot … earns 0` goes red. Then drop the partial unique index from the migration's effect (comment out the insert's conflict handling) and confirm `concurrent resolves …` goes red. Restore with `git checkout`, and record both results in the PR description.
- [ ] **Step 6:** Commit.

### Task 4: Deletion and keep-safe clean up the new tables

**Files:**
- Modify: `artifacts/api-server/src/lib/severPerson.ts:94-108`, `artifacts/api-server/src/lib/keepSafe/move.ts` (the abandon branch near the `RETIRED_SECRET_HASH` update)
- Test: `artifacts/api-server/src/routes/me.delete.test.ts` (extend the fixtures), `artifacts/api-server/src/lib/keepSafe/move.abandon.badges.test.ts` (new)

**Rules:**
- `severPerson`: `delete from spotter_badges`, `badge_moments`. `update points_ledger set device_id = null`, so the cat's history keeps its counts but nothing names the person. `update weekly_results set device_id = null, display_name = null`, so it renders "a spotter".
- Abandon without delete: leave the rows (the credential is retired, so nothing can read them), but delete any `badge_moments` (nothing can play them).

- [ ] **Step 1: Failing tests:** in `me.delete.test.ts`, seed one row in each new table for P, then reuse the existing `leaves no trace of P in any column of any table` test. Add `deleting a podium spotter keeps the frozen week`: the `weekly_results` row count is unchanged, with `device_id` and `display_name` null.
- [ ] **Step 2:** Run the tests and confirm they fail (the column scan finds P). **Step 3:** Implement. **Step 4:** Run and confirm they pass.
- [ ] **Step 5: Mutation probe:** commit, remove the `spotter_badges` delete, and confirm the column scan goes red. Restore.
- [ ] **Step 6:** Commit. Open **PR A** as a draft. Run the api-server and db suites locally, then `gh pr ready`, then wait for a real CI run. It merges before PR B branches off fresh `origin/main` (no stacked PRs).

---

## PR B: Badge engine and backfill (Tasks 5–7)

### Task 5: The badge catalogue and stats

**Files:**
- Create: `artifacts/api-server/src/lib/badges/catalogue.ts`, `artifacts/api-server/src/lib/badges/stats.ts`, `catalogue.test.ts`, `stats.test.ts`
- Modify: `artifacts/api-server/src/lib/badges.ts` (re-export for old imports, then delete once callers move)

**Interfaces (Produces):**
- `type BadgeGroup = "first_steps" | "coming_back" | "weekly" | "finding" | "covering"`. The existing 7 go in `first_steps`, except `ten_discoveries`, which goes in `finding`.
- `interface BadgeStats extends ProfileStats { weeksSpotted: number; areasSpotted: number; areasTotal: number; remoteCats: number; podiums: number; champions: number }`
- `interface BadgeDef { id: string; group: BadgeGroup; stat: keyof BadgeStats | "event"; goal: number }`. `stat: "event"` is for `pathfinder` and `trailblazer`, which are earned at the moment of a spot (Task 6), never from totals. `areas_all`'s goal is computed: `goal = stats.areasTotal`.
- `BADGE_CATALOGUE: readonly BadgeDef[]`, in display order within groups, with goals: `weeks_2/4/8` use `weeksSpotted` with 2/4/8; `podium` uses `podiums` ≥ 1; `champion` uses `champions` ≥ 1; `discover_25/50/100` use `uniqueCatsDiscovered`; `areas_3/8` use `areasSpotted`; `areas_all` needs `areasSpotted >= areasTotal`; `remote_1` and `remote_5` use `remoteCats` (distinct cats).
- `thresholdBadges(stats: BadgeStats): string[]`
- `badgeProgress(stats: BadgeStats, earned: ReadonlySet<string>): { id: string; group: BadgeGroup; earned: boolean; value: number | null; goal: number | null }[]`. An earned badge always reports `value === goal` (spec: complete, never "9 of 10"). Event badges report `value: null, goal: null`.
- `computeBadgeStats(tx, deviceId): Promise<BadgeStats>`:
  - `weeksSpotted` is the distinct `week_start` over this device's ledger rows (live and history).
  - `areasSpotted` is the distinct `sightings.area_key` over resolved sightings, excluding `'off'`, and restricted to **current** areas.
  - `areasTotal` is `currentAreas().length`.
  - `remoteCats` is the distinct `cat_id` over resolved sightings where `area_key = 'off' and on_island`.
  - `podiums` and `champions` come from `weekly_results`.

- [ ] **Step 1: Failing tests** (`catalogue.test.ts`, pure):
  - ids are unique, there are 22 of them, and every id appears in `BADGE_CATALOGUE`
  - `thresholdBadges` with `areasSpotted 21, areasTotal 21` includes `areas_all`, and with `20/21` it doesn't
  - `retiring an area never removes areas_all and progress shows complete` (`earned` contains `areas_all` and the stats say 19/21, so the progress entry is `value 21, goal 21, earned true`)
  - `remote_5 needs 5 distinct cats`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run and confirm they pass.
- [ ] **Step 5:** `stats.test.ts` (database): seed sightings across 3 weeks and 4 areas plus one remote spot, and assert each field. Run until green. Commit.

### Task 6: Award badges inside the transaction, with moments

**Files:**
- Create: `artifacts/api-server/src/lib/badges/award.ts`, `award.test.ts`
- Modify: `artifacts/api-server/src/routes/sightings.ts` (remove `statsBefore`/`badgesBefore` at 882-883 and the post-commit diff at 1116; award inside `tx`), `artifacts/api-server/src/lib/catHelpers.ts` (`profilePayload`)

**Interfaces:**
- `eventBadgesForSpot(tx, { deviceId, catId, isNewCat, areaKey, at }): Promise<string[]>`:
  - `pathfinder` requires `isNewCat`, an `areaKey` other than `"off"`, and no resolved sighting in that `area_key` in `[at − 30 days, at)`, using ledger `earned_at` for live spots.
  - `trailblazer` requires `isNewCat` and no other non-redacted cat whose stamped first sighting has this `area_key`. The area must also have existed before this moment: `namedAreasAt(at)` contains it.
- **Gate:** `eventBadgesForSpot` returns `[]` until `badge_backfill_runs` (Task 7) has `finished_at` set. Before then, older spots have no stamped area and no ledger row, so Trailblazer and Pathfinder would be awarded wrongly. The backfill awards them from history instead. Test: `event badges wait for the backfill`.
- `awardBadges(tx, deviceId, ids: string[], source: "live" | "history" | "week"): Promise<string[]>` inserts with `on conflict do nothing returning badge_id`, so the returned ids are newly earned.
- `queueMoment(tx, { deviceId, kind, badgeIds, weekStart?, place?, weekPoints? }): Promise<void>`
- In resolve: after `awardPoints`, compute `computeBadgeStats` plus `eventBadgesForSpot`, then `awardBadges(..., "live")`. If any badges are new, `queueMoment(kind "badges")`. The response's `newBadges` is that list (same field, now race-free) and gains `momentId: number | null`.
- `profilePayload` returns `badges` from `spotter_badges` (all earned ids), plus `badgeProgress` (from Task 5), `newBadgeIds` (where `seen_at` is null) and `weekPoints` (the sum of this week's ledger points).
- New routes in `routes/profiles.ts`, authed like the other `/profile/:deviceId` writes (`verifyDeviceSecret`):
  - `GET /profile/:deviceId/moments` returns `{ moments: { id, kind, badgeIds, weekStart, place, weekPoints }[] }`, uncelebrated, oldest first, at most 10
  - `POST /profile/:deviceId/moments/:id/celebrated` returns 204
  - `POST /profile/:deviceId/badges/seen` returns 204 and sets `seen_at = now()` on unseen rows

- [ ] **Step 1: Failing tests:**
  - `first spot earns first_sighting once and queues one moment`
  - `concurrent resolves celebrate a new badge once` (two parallel first spots on a fresh device: the union of `newBadges` contains `first_sighting` exactly once across both responses, and there is one moment)
  - `pathfinder: new cat in an area with no spot for 31 days earns it, and 29 days does not`
  - `trailblazer: first cat in an area earns it; an area added after cats existed in it earns nobody`
  - `badges are never removed: deleting the discovered cat leaves discover badges`
  - `moments routes need the device secret`
  - `badges/seen clears newBadgeIds`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run this file plus `sightings.resolve.test.ts` and `profiles.usernames.test.ts`, and confirm they pass.
- [ ] **Step 5: Mutation probe:** commit, change `awardBadges` to a plain `insert` without `on conflict … returning`, and confirm the concurrency test goes red. Restore. Commit.

### Task 7: History backfill, run once from the drain

**Files:**
- Create: `artifacts/api-server/src/lib/badges/backfill.ts`, `backfill.test.ts`
- Modify: `lib/db/src/schema/badges.ts` (add `badgeBackfillRunsTable` (`badge_backfill_runs`): `version integer pk`, `startedAt`, `finishedAt`, `spotters integer`), with migration `0046_weekly_board_and_badges` and a rollback
- Modify: `artifacts/api-server/src/routes/internalMail.ts` (call `runBadgeBackfillOnce()` after the round-up, inside its own try/catch, like the other sweeps)

**Rules (from the spec, §3):**
- Claim `version = 1` with insert-on-conflict-do-nothing in its own transaction. If it's already claimed, return `"already_done"`.
- For every resolved sighting that has no ledger row, insert a ledger row with `points 0` and `source 'history'`, and `athens_day` and `week_start` taken from `sightings.created_at` (the photo date, spec §3). Stamp `area_key`/`on_island` where they're null, using **today's** areas.
- For each spotter: run `thresholdBadges` plus history event badges (the earliest new cat per area for `trailblazer`, under the live rule with `namedAreasAt`; the 30-day check per new cat for `pathfinder`), then `awardBadges(..., "history")`. Queue **one** `kind 'history'` moment with all newly earned ids if there are any. No push.
- It runs in batches of 200 spotters, one transaction each, and is safe to run twice (`on conflict do nothing` everywhere).

- [ ] **Step 1: Failing tests:**
  - `backfill awards weeks and areas from history and queues one history moment`
  - `running backfill twice changes nothing` (row counts equal)
  - `history ledger rows have 0 points so this week's board is empty for them`
  - `trailblazer from history follows the live rule`
  - `a spotter with nothing earns nothing and gets no moment`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run and confirm they pass. Commit.
- [ ] **Step 5:** Open **PR B** (draft, local api-server and db suites, then ready). Merge after PR A.

---

## PR C: Weekly board, close and push (Tasks 8–10)

### Task 8: Ranking and the weekly-board endpoint

**Files:**
- Create: `artifacts/api-server/src/lib/ranking.ts`, `ranking.test.ts`
- Modify: `artifacts/api-server/src/routes/profiles.ts` (`/leaderboard` and the new `/leaderboard/week`), `lib/api-spec/openapi.yaml` (add `WeekBoard` and `LastWeekEntry`; extend `Profile` with `badgeProgress`, `newBadgeIds`, `weekPoints`; extend `ResolveResult` with `pointsReason` and `momentId`; add the moments routes from Task 6), then run `pnpm --filter @workspace/api-spec run codegen`
- Test: `artifacts/api-server/src/routes/leaderboard.week.test.ts`

**Interfaces:**
- `competitionRanks<T>(rows: T[], points: (r: T) => number): (T & { rank: number })[]` takes rows already sorted by points descending and then by the tie-break, and gives equal points an equal rank ("1, 1, 3").
- `GET /leaderboard` (array shape unchanged): filters `points > 0` **in SQL**, takes the top 20, and orders by `points desc`, then the tie-break, which is the latest `points_ledger.earned_at` with points above 0 (earliest first), falling back to `profiles.created_at`, then `spotterCode`. It uses `competitionRanks`.
- `GET /leaderboard/week` returns `{ weekStart: string; endsAt: string; entries: LeaderboardEntry[]; lastWeek: { place: number; name: string | null; points: number }[] }`. `entries` covers this week's ledger, `points > 0`, top 20, with the tie-break being the latest scoring `earned_at` this week (earliest first). `lastWeek` comes from `weekly_results` for the previous week, and is empty if that week hasn't closed. `name` comes from the frozen row (`display_name`, or `null` for "a spotter").

- [ ] **Step 1: Failing tests:**
  - `competitionRanks gives 1,1,3 for 120,120,95`
  - `all-time board shares places on equal points` (this replaces the old "1, 2" ordering; check `ProfileScreen.test.tsx` fixtures for any that relied on it)
  - `zero-point spotters never take a top-20 place`
  - `week board counts only this Athens week's ledger`
  - `week board breaks ties by who reached the total first`
  - `lastWeek is empty before the first close and shows "a spotter" for a deleted winner`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement, then run the codegen. **Step 4:** Run the tests plus `pnpm run typecheck:libs` and confirm they pass. Commit.

### Task 9: Weekly close and the Monday push

**Files:**
- Create: `artifacts/api-server/src/lib/weeklyClose.ts`, `weeklyClose.test.ts`
- Modify: `artifacts/api-server/src/routes/internalMail.ts` (call `closeWeekIfDue()` then `sendWeeklyPushesIfDue()`), `artifacts/api-server/src/app.ts:100` (the opportunistic hook gets a second throttled call, 5 min, to both functions, independent of `ROUND_UP_HOUR`, and off in test unless `WEEKLY_CLOSE_ON_REQUEST=on`)

**Interfaces:**
- `firstEligibleWeek(): Promise<string | null>` is the Athens Monday **after** the week of the earliest `source 'live'` ledger row, so the first full week after the new version is live. This is computed, not a setting, so nothing needs configuring on launch day.
- `closeWeekIfDue(now = new Date()): Promise<"not_due" | "already_closed" | "closed">`. The previous week is `weekStartAthens(now) − 7 days`.
  - Return `not_due` if that's before `firstEligibleWeek()`.
  - In one transaction: claim a `weekly_closes` row (insert on conflict do nothing; if nothing is returned, return `already_closed`).
  - Rank that week's ledger with `competitionRanks` and the Task 8 tie-break, and write every row with `rank <= 3` to `weekly_results`, with `display_name` = username or nickname (the same fallback the board uses).
  - `awardBadges(…, "week")`: `podium` for all, `champion` for rank 1.
  - `queueMoment(kind "week_result", badgeIds = the badges in this result, even if already held, with place and weekPoints)` for each. The spec says to celebrate every podium week.
  - No minimum activity (Samuel).
- `sendWeeklyPushesIfDue(now = new Date()): Promise<"not_due" | "outside_window" | "sent" | "already_sent">`. It acts only for the week that just closed, only when Athens `now` is the Monday that week closed, and only between 08:00 and 20:00. It claims `pushed_at` with `update … where pushed_at is null returning`. It sends `sendPushNotification(token, title, body, { type: "weekly_result", weekStart })` to each placed device with a token. The copy is from i18n keys `pushWeekTitle` and `pushWeekBody1`/`pushWeekBodyPlace`, in English only server-side, as the round-up does today. Check `sightingRoundUp.ts` for how it picks a language; if it's per-device, match it.
- The bell entry is a `notifications` row. **Schema change in this task:** make `notifications.cat_update_id` nullable, and add `kind text not null default 'cat'` and `message text`, with migration `0047` and a rollback. The `GET /notifications/:deviceId` join becomes a left join, and rows with `kind 'week_result'` return `catId: null`. The message never names a place.

- [ ] **Step 1: Failing tests** (use a fixed `now`):
  - `not due before the first eligible week`
  - `closes last week once and freezes the top three with ties`
  - `two closes at once close the week once` (`Promise.all`)
  - `a quiet week with one spotter on 15 points still awards champion`
  - `already-held podium still queues a week_result moment`
  - `push goes out at 08:05 Monday Athens, not at 07:55`
  - `a close at 21:00 Monday sends no push`
  - `a Tuesday run sends no push`
  - `the bell lists a weekly result without a cat`
  - `push and bell text never contain an area name` (assert against every `SEED_AREAS` name)
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run them, plus the existing notifications route tests, and confirm they pass.
- [ ] **Step 5: Mutation probes:** commit, then remove the claim's `on conflict do nothing` and confirm `two closes at once` goes red. Remove the 20:00 bound and confirm `a close at 21:00` goes red. Restore. Commit.

### Task 10: Every reader of "points" and "badges" agrees

This enumerates the invariant's consumers, so nothing reads the old computed list.

- [ ] **Step 1:** `git grep -n "badgesFor\|BADGE_DEFS\|profilesTable.points\|\.badges\b" artifacts/api-server/src artifacts/cat-spotter` lists every reader. Each must read either `spotter_badges` (badges) or `profiles.points` plus the ledger (points). Record the list in the PR description with one line per reader saying how it was checked.
- [ ] **Step 2:** Add `profile points equal the sum of live ledger points plus pre-launch points` as a database test over a seeded device. Commit. Open **PR C** (draft, local suites, then ready). Merge after PR B.

---

## PR D: The app (Tasks 11–16)

Branch from `origin/main` after PR C merges, so the generated client has the new fields.

### Task 11: Badge data on the client from the server

**Files:**
- Modify: `artifacts/cat-spotter/lib/badgeProgress.ts` (drop `BADGE_GOALS`; `badgeViews(profile)` maps `profile.badgeProgress` and `newBadgeIds`), `artifacts/cat-spotter/lib/__tests__/badgeProgress.test.ts` (replace the text-pinning test with one that pins `BADGE_IDS` to the server's `BADGE_CATALOGUE` ids by reading `catalogue.ts` as text for `id: "…"`), `artifacts/cat-spotter/lib/i18n.ts` (`BADGE_IDS` gets all 22, `BADGE_GROUPS`, and an emoji map `BADGE_EMOJI` from the spec's table)
- Modify: `artifacts/cat-spotter/components/profile/shared.tsx` (`BadgeMedal` shows `BADGE_EMOJI[id]` on the existing tone disc, falling back to the Feather icon)

**Interfaces (Produces):** `BadgeView { id; group; earned; isNew; value: number | null; goal: number | null }`, `badgeViews(profile): BadgeView[] | null` (null for an old server with no `badgeProgress`), and `nextInGroup(views, id): BadgeView | null`.

- [ ] **Step 1: Failing tests:**
  - `badgeViews uses server progress and never shows 9 of 10 on an earned badge`
  - `nextInGroup after areas_3 is areas_8; after areas_all it is null`
  - `every BADGE_ID has en, el and fr name, desc and means strings` (extend `i18n.test.ts` with `badge_<id>_means`)
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement, including all 22 × 3 `badge_<id>`, `_desc` and `_means` strings. The `_means` sentence says what the badge is and how it helps the cats (spec §4). The existing 7 keep their current names. **Step 4:** Run them, then the typecheck, and confirm they pass. Commit.

### Task 12: The celebration component

**Files:**
- Create: `artifacts/cat-spotter/components/celebration/BadgeCelebration.tsx`, `components/celebration/Confetti.tsx`, `components/celebration/useCelebrationFeedback.ts`, `assets/sounds/badge.mp3`, `components/__tests__/BadgeCelebration.test.tsx`
- Modify: `artifacts/cat-spotter/package.json` (`npx expo install expo-audio`), `app.json` if the plugin needs it

**Interfaces:**
- `BadgeCelebration({ moment, views, onDone, quiet }: { moment: { kind: "badges" | "week_result" | "history"; badgeIds: string[]; place?: number | null; weekPoints?: number | null }; views: BadgeView[]; onDone: () => void; quiet?: boolean })`. It renders a full-screen `Modal` on the Aegean background (`palette.aegean900`, `aegean600`):
  - For `badges`, it steps through ids showing "1 of N".
  - For `history`, it shows one screen with the medals in a row and `celebrateHistoryTitle` ("Your spots so far have earned you {n} new badges").
  - For `week_result`, it adds `celebrateWeekLine` ("You came {place} last week with {points} points") above the medal.
  - Each screen shows `newBadge`, the name, `_means`, and the "Next:" line from `nextInGroup` with a progress bar, or `celebrateGroupDone`.
  - It has a "Lovely!" button (`celebrateClose`) and a "See all my badges" link that routes to the profile Badges tab.
- `useCelebrationFeedback()` returns `{ play(): void }`. It plays the sound with `expo-audio` only when the sound setting is on (Task 15). On iOS it uses the default ambient category so the silent switch mutes it. It fires `Haptics.notificationAsync(Success)` on native. On web it skips the buzz, and the sound is attempted only after a tap (the button press that opened the screen counts), with the error swallowed.
- Reduced motion: `useReducedMotion()` from reanimated. When it's true, there's no confetti, bounce or shine.
- `quiet` (a replay from the Badges tab) means no confetti, sound or buzz.
- Sound file: a CC0 or public-domain chime under 1 second and 30 KB. Record its source URL and licence in `assets/sounds/README.md`. Samuel hears it in the preview before merge (spec).

- [ ] **Step 1: Failing tests** (`BadgeCelebration.test.tsx`, with `expo-audio` and `expo-haptics` mocked):
  - `steps through two badges with 1 of 2 then 2 of 2 then calls onDone`
  - `history moment shows one screen with all medals`
  - `week moment shows the place line`
  - `quiet replay never plays sound or buzz`
  - `sound off setting plays no sound but still buzzes`
  - `reduced motion renders no confetti`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run and confirm they pass. Commit.

### Task 13: When celebrations play

**Files:**
- Create: `artifacts/cat-spotter/context/CelebrationContext.tsx`, `context/__tests__/CelebrationContext.test.tsx`
- Modify: `artifacts/cat-spotter/app/_layout.tsx` (the provider, rendered after `FirstBadgeOffer`'s gate), `artifacts/cat-spotter/app/review.tsx:552-576` (remove the badge pills; play `momentId`'s moment after the "well done" block has shown and before `SightingQuestions`; add the `pointsReason === "repeat_today"` line `pointsRepeatToday` with the cat's name instead of "+0"), `artifacts/cat-spotter/context/NotificationContext.tsx` (a tap on `data.type === "weekly_result"` opens the app and triggers a moments fetch)

**Rules:**
- On app open and on resume (online only), fetch `GET /profile/:deviceId/moments`. Play them one at a time, only on a resting screen (reuse `canOfferHere` from `FirstBadgeOffer.tsx`), never over the camera or a report. Mark each one `celebrated` after `onDone`.
- After a spot, review.tsx plays its own `momentId` inline, and the context skips that id.
- The first-badge "keep my spots safe" offer opens after the celebration closes, never over it (it already waits for a resting screen; the test pins the order).

- [ ] **Step 1: Failing tests:**
  - `plays queued moments oldest first and marks each celebrated`
  - `does not play on the camera route`
  - `review screen shows well done, then the celebration, then the questions`
  - `repeat_today shows the kind line and no +0`
  - `keep-safe offer waits until the celebration closes`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run them, plus `ReviewScreen.hint.test.tsx`, `FirstBadgeOffer.test.tsx` and `layoutOnboardingGate.test.tsx`, and confirm they pass. Commit.

### Task 14: The Spotters tab, weekly by default

**Files:**
- Modify: `artifacts/cat-spotter/lib/leaderboardView.ts` (accept an entries array for either period; the ranks are the server's shared ranks; `summary` gets `kind 'outside'` for the week using `profile.weekPoints`), `components/profile/SpottersTab.tsx` (a segmented "This week | All time" control with a 44pt hit area, as in SYC-644; the countdown `spottersNewWeekIn`; the empty-week line `spottersWeekEmpty`; the last-week strip `spottersLastWeek`), `app/(tabs)/profile.tsx` (the `useGetLeaderboardWeek` query beside `useGetLeaderboard`)
- Test: `lib/__tests__/leaderboardView.test.ts`, `components/__tests__/ProfileScreen.test.tsx`

**Rules:** It opens on This week every time. The countdown is "in N days" from Athens calendar days, and "in N hours" on the last day (use `endsAt` from the server, never `hours / 24`). The last-week strip shows "a spotter" for a null name. Offline, it uses the existing offline line for both tabs.

- [ ] **Step 1: Failing tests:**
  - `opens on This week`
  - `switching to All time shows the all-time rows`
  - `two people on equal points both show rank 1 and the next shows 3`
  - `empty week shows the friendly line and last week's top three`
  - `countdown says 3 days on Thursday evening and 5 hours on Sunday at 19:00 Athens`
  - `outside top 20 this week shows the outside summary`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run and confirm they pass. Commit.

### Task 15: Badges tab and the sounds setting

**Files:**
- Modify: `components/profile/BadgesTab.tsx` (five group headings, from `BADGE_GROUPS`; a "New" chip where `isNew`; tapping an earned badge opens `BadgeCelebration` with `quiet`; on focus, `POST badges/seen`), `app/settings.tsx` (a new "Celebrations" section between Appearance and Your data, with a `Switch` labelled `settingsCelebrationSounds`)
- Create: `context/CelebrationSettingsContext.tsx`, with AsyncStorage key `cat-spotter/celebration-sounds` and default `true`
- Test: `components/__tests__/BadgesTab.test.tsx` (new), `components/__tests__/ProfileScreen.test.tsx`

- [ ] **Step 1: Failing tests:**
  - `groups 22 badges under five headings`
  - `new badge shows the New chip until the tab has been seen`
  - `tapping an earned badge replays it quietly`
  - `sounds switch defaults on and persists off`
- [ ] **Step 2:** Run them and confirm they fail. **Step 3:** Implement. **Step 4:** Run and confirm they pass. Commit.

### Task 16: Check it in the browser, then ship

- [ ] **Step 1:** Run the full client suite, the typecheck, and `pnpm --filter @workspace/cat-spotter run build:web`.
- [ ] **Step 2:** Start the web preview against a local API with seeded data. Check at 390 px and desktop:
  - the board on This week, All time, an empty week, and ties
  - a spot that earns two badges (well done, then 1 of 2, then 2 of 2, then the questions)
  - a repeat spot (the kind line)
  - the history celebration
  - a week result
  - reduced motion (emulate it)
  - Greek and French (no clipped text)

  Screenshot each one for the PR.
- [ ] **Step 3:** Send Samuel the sound and a screen recording or screenshots before marking it ready (spec: "Samuel hears it in the preview before it merges").
- [ ] **Step 4:** Open **PR D** as a draft, then mark it ready.
- [ ] **Step 5:** Add every new Greek and French string to Johnny's review pack (comment on SYC-346 with the keys).

---

## Rollout (after all four PRs merge)

Order matters. Memory "migrate before republish" says to migrate production before Samuel republishes.

1. Run migrations 0046–0049 on production. Check that `/api/healthz` shows the new commit only after Samuel pulls main in Replit's Git pane and republishes (memories: "Replit sync is Samuel's", "Confirm the live build before smoke").
2. Trigger the drain once (the worker's 2-hourly cron will also do it). Then check `badge_backfill_runs` has `finished_at`, and spot-check two real spotters' badges against their history.
3. There's no setting to flip: the first eligible week is computed from the first live ledger row. Note in SYC-706 the Monday that will be the first close.
4. A wake-up is needed for the first Monday close. Before reporting the launch done, set a scheduled check (scheduled task) for 10:00 Athens on that Monday that verifies a `weekly_closes` row exists and `pushed_at` is set.

## Model delegation

The session runs on Opus. Default to Sonnet. Anything on Opus is justified below.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 0 remote-gap count | Sonnet | one read-only query and a comment | the query and its result are quoted in SYC-706; session spot-checks one row |
| Tasks 1–2 schema, weeks, placeFor | Sonnet | clear signatures and fixed test values | db up/down/up suite, the boundary tests in Review Focus 2, typecheck |
| Task 3 once-a-day points | **Opus** | concurrency inside a money-like counter; a wrong answer is silent (points quietly double or vanish) | tests, plus the mutation probes in Step 5, plus an adversarial reviewer (Sonnet) on the diff |
| Task 4 deletion | Sonnet | a known pattern (`severPerson` lines) | the existing column-scan test, plus the mutation probe in Step 5 |
| Tasks 5–7 badge engine and backfill | **Opus** | three silent-failure risks: double celebration, badges vanishing, a backfill that runs twice | tests, plus the mutation probe in Task 6, plus the double-run test, plus a spot review of the backfill on a copy of production data before release |
| Tasks 8–10 board, close, push | **Opus** for Task 9, Sonnet for 8 and 10 | the close is a once-only job with a time window and outside effects (pushes to real people) | tests and the mutation probes in Task 9; Task 10's reader list is reviewed by the session |
| Task 11 client data and i18n | Sonnet | mechanical mapping and copy | the i18n parity test; Greek and French go to Johnny's pack |
| Tasks 12–15 client UI | Sonnet | standard React Native work against a fixed design | component tests, plus Task 16's browser check at 390 px and desktop by the session |
| Each PR's review before `gh pr ready` | Opus critic agent, in its own worktree (LIF-79) | adversarial review is judgment work; it must not share a tree with the implementer | findings folded in before ready; `/ship` for merge |

Each implementer agent works in its own worktree off fresh `origin/main` and **commits after each step that leaves the tree green**. That instruction is repeated verbatim in every agent prompt.
