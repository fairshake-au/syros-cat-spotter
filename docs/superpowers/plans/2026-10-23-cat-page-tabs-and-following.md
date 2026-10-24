# Cat page in four tabs, and following a cat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after each task (and after each step marked Commit). Write a checkpoint note to `docs/superpowers/plans/2026-10-23-cat-page-tabs-and-following.CHECKPOINT.md` (what's done, what's next) at the end of every task.**

**Goal:** Rebuild the public cat page as four tabs (About · Photos · Story · Map), add Follow / Following with real fans and spotters counts, and fold in the cat-page parts of SYC-509, SYC-510 and SYC-512.

**Architecture:** Four draft PRs. **PR A** moves the server's public days to Syros time. **PR B** adds following on the server: a `cat_unfollows` table, follow/unfollow routes, new count fields, and every piece of cat news reading the follower list. **PR C** (stacked on B) rebuilds the page as tabs, using B's new fields. **PR D** (stacked on C) adds the Follow button. A and B are independent of each other.

**Tech Stack:** Express + Drizzle + Postgres (`artifacts/api-server`, `lib/db`), OpenAPI + orval codegen (`lib/api-spec` → `lib/api-zod`, `lib/api-client-react`), Expo / React Native + react-native-web (`artifacts/cat-spotter`), vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-10-23-cat-page-tabs-design.md` (approved by Samuel, 23 Oct 2026). Executors read the spec and this plan together. Where this plan is silent, the spec decides.

## Global Constraints

- Every PR is opened as a **draft** (`gh pr create --draft`). Run the affected tests locally before pushing. `gh pr ready` once, after review fixes are in. A skipped check is not a pass. Never `gh pr merge --auto`.
- Before `gh pr ready` on A or B, run the **full** api-server suite (`pnpm --filter @workspace/api-server test`); before C or D, the full app suite (`pnpm --filter cat-spotter test`) and `pnpm --filter cat-spotter typecheck`.
- Local test runs on Samuel's Mac need the esbuild workaround (`ESBUILD_BINARY_PATH` from a scratchpad `npm pack` of the darwin esbuild package) and, for api-server, `DATABASE_URL` pointing at a local Postgres, plus `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`.
- Terminology: **"spotter"** only (never "snapper"), **"cat guardian"**, **sterilise** (never desex). French uses tu-form (`lib/__tests__/i18n.test.ts` enforces it).
- Every new string exists in `en`, `el` and `fr` with the same `{placeholders}` (the i18n test enforces it). Greek and French are drafts, flagged for SYC-4.
- Placeholders are filled with `.split('{name}').join(name)` / `.replace('{n}', …)`, as the page does today.
- The map shows the cell, never a pin, except to the owner. Unchanged.
- "{name} lives with me" stays `variant="secondary"`. The needs-help link is never bigger than the main button. "Something wrong on this page?" is never bigger than the needs-help link and always below it.
- Migration **0042** runs on production **before** Samuel republishes. Tell him "don't republish yet" until it has (memory: migrate-before-republish). Neon writes need Samuel to switch the session to "ask" mode.

## Review Focus

1. **A phone that unfollowed, then spots the cat again** must stay unfollowed. Silent-failure risk; mutation probe in Task B3.
2. **A homed cat's owner who had unfollowed, then claims** must hear about sightings again. Task B4.
3. **The "has a home" and owner-edit pushes** must reach followers who never spotted the cat, and must not reach a spotter who unfollowed. Silent-failure risk; mutation probe in Task B5.
4. **A visitor whose phone is in Auckland or California** sees the same day for "You spotted…" and "Last seen" as someone on Syros. Tasks A1 and C1.
5. **A cached or older-server payload without the new fields** (`spottersCount`, `followersCount`, `isFollowing`) shows no fans phrase and no Follow button, never a false 0. Tasks C3 and D1.

---

## PR A — Syros days on the server (branch `claude/syc-624-a-syros-days`, off fresh `origin/main`)

### Task A1: `toPublicDay` cuts the day in Europe/Athens

**Files:**
- Modify: `artifacts/api-server/src/lib/catHelpers.ts:164` (`toPublicDay`)
- Modify: `lib/api-spec/openapi.yaml` (every "UTC calendar date" description, e.g. `CareEvent.at`, `lastSeenAt`, sighting `createdAt`) to say "Syros (Europe/Athens) calendar date"; then run codegen.
- Test: `artifacts/api-server/src/lib/catHelpers.publicDay.test.ts` (new)
- Regenerate: `artifacts/api-server/src/routes/__snapshots__/cats.publicDetail.p3-2.txt`, `publicPayload.p6.txt` (add a changelog line in each test file's header)

**Interfaces:**
- Produces: `toPublicDay(at: Date | string): string` (same signature, returns `YYYY-MM-DD` in Europe/Athens). Callers: `catHelpers.ts:193, 291`, `guardianCatView.ts:229`, `routes/cats.ts:282, 294`. All of them keep calling it unchanged.

- [ ] **Step 1: Write failing tests** `toPublicDay`:
  - `"2026-10-22T22:30:00.000Z"` → `"2026-10-23"` (01:30 Athens, summer time, UTC+3)
  - `"2026-10-22T20:30:00.000Z"` → `"2026-10-22"`
  - `"2026-12-31T22:30:00.000Z"` → `"2027-01-01"` (winter time, UTC+2)
  - `"2026-12-31T21:30:00.000Z"` → `"2026-12-31"`
  - A `Date` input gives the same answer as its ISO string.
  - A bare `"2026-10-22"` input is returned unchanged.
- [ ] **Step 2:** Run `pnpm --filter @workspace/api-server exec vitest run src/lib/catHelpers.publicDay.test.ts`. Expect FAIL on the first and third cases.
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' })` (en-CA formats as `YYYY-MM-DD`). Pass a bare `YYYY-MM-DD` string through untouched.
- [ ] **Step 4:** Run the new test (PASS). Then run `src/routes/cats.publicDetail.test.ts`, `src/routes/publicPayload.p6.test.ts` and `src/lib/guardianCatView*.test.ts`. If a snapshot's day changes, regenerate it with `-u` and confirm in the diff that only day strings changed.
- [ ] **Step 5:** Edit the openapi descriptions, run `pnpm --filter @workspace/api-spec run codegen`, and commit the regenerated files.
- [ ] **Step 6: Commit** `SYC-624 A1: public days are Syros days (toPublicDay in Europe/Athens)`.

PR A then: full api-server suite, draft PR "SYC-624 A: public days are Syros days", body links the spec section "Also fixed on this page".

---

## PR B — Following on the server (branch `claude/syc-624-b-following`, off fresh `origin/main`)

PR B also carries the spec and this plan: cherry-pick the docs commits from `claude/redesign-individual-cats-pages-115a22` as its first commit.

### Task B1: `cat_unfollows` table, migration 0042 with backfill

**Files:**
- Modify: `lib/db/src/schema/notifications.ts`: add `catUnfollowsTable` beside `catSubscriptionsTable`; export the type `CatUnfollow`. Export through `schema/index.ts` if it doesn't re-export the whole file.
- Create: `lib/db/migrations/0042_cat_unfollows.sql` via `pnpm --filter @workspace/db run generate --name cat_unfollows`. Append the backfill SQL and a commented `-- rollback-begin … -- rollback-end` block, per `lib/db/migrations/README.md`.
- Test: `lib/db` tests (`pnpm --filter @workspace/db test`) and `migrate:check`.

**Interfaces:**
- Produces: `catUnfollowsTable = pgTable("cat_unfollows", { deviceId: text("device_id").notNull(), catId: integer("cat_id").notNull(), createdAt: timestamp(..., { withTimezone: true }).notNull().defaultNow() }, (t) => [primaryKey({ columns: [t.deviceId, t.catId] })])`.

- [ ] **Step 1:** Add the table to the schema and generate the migration.
- [ ] **Step 2:** Append the backfill to `0042`:
  ```sql
  insert into cat_subscriptions (device_id, cat_id)
  select distinct s.device_id, s.cat_id from sightings s
  where s.status = 'resolved' and s.device_id is not null and s.device_id not like 'deleted:%'
    and s.cat_id is not null
  on conflict do nothing;
  ```
  No unfollow records exist yet, so the backfill needs no `not exists`. Say so in a comment.
- [ ] **Step 3:** Run `migrate`, `migrate:check` and `pnpm --filter @workspace/db test` against local Postgres. Expect all green.
- [ ] **Step 4: Commit** `SYC-624 B1: cat_unfollows table and spotter backfill (migration 0042)`.

### Task B2: Follow and unfollow routes, with a courtesy cap

**Files:**
- Modify: `lib/api-spec/openapi.yaml`: paths `POST /cats/{catId}/follow` (operationId `followCat`) and `POST /cats/{catId}/unfollow` (operationId `unfollowCat`), body `FollowCatBody { deviceId: string }`, response `FollowState { isFollowing: boolean, followersCount: integer }`. Errors: 404 (no cat), 400, 401/403/410 (from `verifyDeviceSecret`), 403 `{ code: "OWNER_CANNOT_UNFOLLOW" }`, 429, 503. Run codegen.
- Modify: `artifacts/api-server/src/middlewares/rateLimit.ts`: add `FOLLOW_DEVICE_LIMIT = 50`, `FOLLOW_ADDRESS_LIMIT = 300`, `FOLLOW_WINDOW_MS = 24*60*60*1000`; `declareLimit` both, sliding; `checkFollowLimit(deviceId: string, address: string, now = Date.now()): Promise<boolean>`; `_resetFollowLimitForTests()`. Copy `checkClaimLimit`; the address key comes from `addressKey`.
- Create: `artifacts/api-server/src/lib/following.ts`:
  - `follow(tx, { deviceId, catId }): Promise<void>`: delete the `cat_unfollows` row, insert `cat_subscriptions` `on conflict do nothing`.
  - `unfollow(tx, { deviceId, catId }): Promise<void>`: delete the `cat_subscriptions` row, insert `cat_unfollows` `on conflict do nothing`.
  - `followersCount(catId: number, exec = db): Promise<number>`: `count(*)` from `cat_subscriptions` where `cat_id = catId and device_id not like 'deleted:%'`.
  - `isFollowing(deviceId: string, catId: number, exec = db): Promise<boolean>`.
- Modify: `artifacts/api-server/src/routes/cats.ts`: two handlers modelled on `let-go` (`cats.ts:520`). In order: `PER_PHONE` header, catId check, zod `FollowCatBody`, `verifyDeviceSecret`, `checkFollowLimit` (try/catch → 503 with `Retry-After: 5`; refused → 429), then a transaction that locks the cat row (404 if missing). Unfollow refuses with 403 `OWNER_CANNOT_UNFOLLOW` when `cat.ownerDeviceId === deviceId`. Both answer `FollowState`.
- Test: `artifacts/api-server/src/routes/cats.follow.test.ts` (new). Use the device/secret pattern from `cats.claim.test.ts`.

- [ ] **Step 1: Write failing tests:**
  - follow adds a `cat_subscriptions` row and answers `{ isFollowing: true, followersCount: n+1 }`; following twice keeps one row (double tap).
  - unfollow removes the row, writes `cat_unfollows`, and answers `{ isFollowing: false }`.
  - follow after unfollow deletes the `cat_unfollows` row.
  - The owner's unfollow → 403 `OWNER_CANNOT_UNFOLLOW`, and the row stays.
  - Missing cat → 404. No secret → 401. A `deleted:` id → 410.
  - The 51st follow-or-unfollow call in a day from one phone → 429. Re-follow counts as a call.
  - `followersCount` ignores a `deleted:%` row (insert one by hand).
- [ ] **Step 2:** Run `pnpm --filter @workspace/api-server exec vitest run src/routes/cats.follow.test.ts`. Expect FAIL (404 on the routes).
- [ ] **Step 3:** Implement the openapi paths + codegen, the limiter, `lib/following.ts` and the routes.
- [ ] **Step 4:** Run the test (PASS).
- [ ] **Step 5: Commit** `SYC-624 B2: follow and unfollow routes with a courtesy cap`.

### Task B3: Unfollowing sticks when the phone spots the cat again

**Files:**
- Modify: `artifacts/api-server/src/routes/sightings.ts:~1037`: the resolve transaction's `cat_subscriptions` insert skips a pair that has a `cat_unfollows` row. Use `insert … select … where not exists (select 1 from cat_unfollows …) on conflict do nothing`.
- Test: `artifacts/api-server/src/routes/sightings.unfollowSticks.test.ts` (new)

- [ ] **Step 1: Write failing test** `a phone that unfollowed is not re-followed by a new confirmed sighting`: phone spots and resolves (row exists) → unfollow → spot and resolve again → no `cat_subscriptions` row. Control: a phone that never unfollowed gets its row.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it (PASS).
- [ ] **Step 5: Mutation probe:** temporarily remove the `not exists` clause, run the test, and confirm it goes red. Restore. Note the result in the checkpoint file.
- [ ] **Step 6: Commit** `SYC-624 B3: an unfollow sticks through later sightings`.

### Task B4: Claiming makes the claimer a follower

**Files:**
- Modify: `artifacts/api-server/src/routes/cats.ts` claim route: inside the transaction after `writeObservation` (~line 447+), call `follow(tx, { deviceId, catId })` from `lib/following.ts`. Also call it on the "already the owner" early-return path (~line 395), so an owner who somehow lost the row gets it back.
- Test: add to `artifacts/api-server/src/routes/cats.claim.v2.test.ts`.

- [ ] **Step 1: Write failing tests:**
  - `claiming after unfollowing restores the follow`: spot → unfollow → claim → the `cat_subscriptions` row exists and no `cat_unfollows` row.
  - `the owner hears live sightings after an unfollow then a claim`: call `fanOutNotifications` with a sighting update and assert a `notifications` row for the owner.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (PASS), plus all of `cats.claim*.test.ts`.
- [ ] **Step 5: Commit** `SYC-624 B4: claiming a cat makes you a follower`.

### Task B5: "Has a home" and owner-edit pushes go to followers

**Files:**
- Modify: `artifacts/api-server/src/lib/notifications.ts` `notifyCatSpotters`: read recipients from `catSubscriptionsTable` where `catId`, `deviceId != actingDeviceId`, `deviceId not like 'deleted:%'`. Keep the `isResolvedDeceased` early return. Rename it to `notifyCatFollowers` (same signature) and update both callers (`cats.ts:~494`, `~659`) and the `vi.mock` in `cats.claim.test.ts` and `cats.deviceAuth.test.ts`.
- Test: `artifacts/api-server/src/lib/notifications.followers.test.ts` (new); adjust `cats.claim.test.ts` push assertions to seed follow rows rather than only sightings.

- [ ] **Step 1: Write failing tests** for `notifyCatFollowers`. Mock `sendPushNotification`; seed push tokens.
  - A follower who never spotted gets the push.
  - A spotter who unfollowed doesn't.
  - The acting phone doesn't.
  - A `deleted:` row doesn't.
  - A deceased cat sends nothing.
- [ ] **Step 2:** Run. Expect FAIL on the first two.
- [ ] **Step 3:** Implement, and rename at the call sites.
- [ ] **Step 4:** Run the new test, `cats.claim.test.ts` and `cats.deviceAuth.test.ts` (PASS).
- [ ] **Step 5: Mutation probe:** point the query back at `sightingsTable` and confirm the first two tests go red. Restore. Note it in the checkpoint.
- [ ] **Step 6: Commit** `SYC-624 B5: every cat push goes to followers`.

### Task B6: New fields on the cat page response

**Files:**
- Modify: `lib/api-spec/openapi.yaml` `CatDetail` (~1303). Add **optional** `spottersCount: integer` ("Distinct phones with a confirmed sighting"), `followersCount: integer` ("Phones following this cat now"), and `isFollowing: boolean` ("This phone follows this cat; absent unless the phone proved its id"). Keep `fansCount` required, re-described as "Deprecated: distinct spotting phones, kept for older app versions; same as spottersCount". Run codegen.
- Modify: `artifacts/api-server/src/routes/cats.ts` GET `/cats/:catId` (~262-277): add `followersCount(catId)` to the `Promise.all`; `spottersCount: fans`. Extend `detailViewer` to return `isFollowing: boolean | undefined`: `undefined` when not proven, `true` for the owner branch (they always follow), otherwise `isFollowing(deviceId, cat.id)`. Leave `isFollowing` out of the JSON when it's `undefined`.
- Modify tests: `src/routes/cats.claim.v2.test.ts` (`detail()` helper cases), `src/routes/me.delete.test.ts:354/510` (type gains the new fields; deletion lowers `followersCount` and `spottersCount` by 1); regenerate `cats.publicDetail.p3-2.txt` and `publicPayload.p6.txt` (the public payload has `spottersCount` and `followersCount`, never `isFollowing`).

- [ ] **Step 1: Write failing tests** in `cats.claim.v2.test.ts`:
  - The public request has no `isFollowing`.
  - A proven follower gets `isFollowing: true`; a proven non-follower gets `false`; the owner gets `true`.
  - `spottersCount === fansCount`.
  - `followersCount` counts follows of non-spotters.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement openapi + codegen + route.
- [ ] **Step 4:** Run the file, plus `me.delete.test.ts` and the two snapshot tests (regenerate with `-u`, check the diff shows only the new fields).
- [ ] **Step 5: Commit** `SYC-624 B6: spottersCount, followersCount and isFollowing on the cat page`.

### Task B7: "Delete my data" removes unfollow records; restore keeps follows

**Files:**
- Modify: `artifacts/api-server/src/lib/severPerson.ts:94-96`: add `delete from cat_unfollows where device_id = ${deviceId}` next to the `cat_subscriptions` delete.
- Test: extend `artifacts/api-server/src/routes/me.delete.test.ts`; add a case to the keep-safe move tests (`src/lib/keepSafe/*.test.ts`, whichever covers `move.ts` redeem).

- [ ] **Step 1: Write failing tests:**
  - After delete-my-data, the phone has no `cat_unfollows` rows and no `cat_subscriptions` rows.
  - After a keep-safe redeem on a new phone, the follows and unfollow records made under the spotter's id still apply. Ask `isFollowing` with the redeemed credentials.
- [ ] **Step 2:** Run. Expect FAIL on the first; the second should already pass. Record that it passes without code, as the spec predicts.
- [ ] **Step 3:** Implement the delete.
- [ ] **Step 4:** Run (PASS).
- [ ] **Step 5: Commit** `SYC-624 B7: delete-my-data removes unfollow records`.

PR B then:
- Run the full api-server suite. If a new file names `welfare_reports`, add it to the welfareKindGuard ALLOWLIST (memory).
- Open the draft PR "SYC-624 B: following a cat (server)".
- The body lists every consumer of the follower list and how each is covered:
  - `fanOutNotifications`: unchanged, reads the list.
  - `sendDailyRoundUp`: unchanged, reads the list.
  - `news/nightly.ts`: unchanged, reads the list.
  - `notifyCatFollowers`: B5.
  - Resolve insert: B3.
  - Claim: B4.
  - `severPerson`: B7.
  - Keep-safe move: B7, no code.
  - Merge: none exists (SYC-59 comment).
- The body also includes the line "Migration 0042: don't republish until it's on production".

---

## PR C — The page in four tabs (branch `claude/syc-624-c-tabs`, stacked on B)

All files under `artifacts/cat-spotter/` unless stated.

### Task C1: One date formatter for the page

**Files:**
- Create: `lib/catPageDates.ts`:
  - `formatDay(day: string, language: Language): string`. A bare `YYYY-MM-DD` is formatted from its parts, using `Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })` on `Date.UTC(y, m-1, d)`, so no phone zone can shift it. The locale map is `en → 'en-GB'`, `el → 'el-GR'`, `fr → 'fr-FR'`.
  - `formatInstant(iso: string, language: Language): string`. The same style with `timeZone: 'Europe/Athens'`.
  - `formatMonthYear(day: string, language: Language): string`. `{ month: 'short', year: 'numeric', timeZone: 'UTC' }`.
  - `formatPublicDate(value: string, language: Language): string`. Calls `formatDay` for a bare date and `formatInstant` otherwise.
- Modify: `app/cat/[id].tsx:201, 292, 356, 471, 538, 555`, `components/SightingPhotos.tsx:55` and `components/MoreToAdd.tsx:70, 150`. Each uses the matching formatter with `language` from `useLanguage()`. Exact instants (`takenAt`, `highlighted.createdAt`) use `formatInstant`; everything else uses `formatPublicDate` / `formatMonthYear`.
- Test: `lib/__tests__/catPageDates.test.ts` (new); update `components/__tests__/CatPagePhotos.test.tsx:196` to expect `formatDay('2026-09-01','en')`.

- [ ] **Step 1: Write failing tests** with `process.env.TZ` set per case (vitest `vi.stubEnv`, or run each case through a child formatter with an explicit zone):
  - `formatDay('2026-10-21','en') === '21 Oct 2026'` with TZ `Pacific/Auckland` and with `America/Los_Angeles`.
  - `formatInstant('2026-10-22T22:30:00.000Z','en') === '23 Oct 2026'`.
  - `formatInstant('2026-10-22T20:30:00.000Z','en') === '22 Oct 2026'`.
  - `formatMonthYear('2026-03-14','en') === 'Mar 2026'`.
  - Greek and French produce non-empty strings containing `2026`.
- [ ] **Step 2:** Run `pnpm --filter cat-spotter exec vitest run lib/__tests__/catPageDates.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement and replace the call sites.
- [ ] **Step 4:** Run the new test and `components/__tests__/{CatPagePhotos,MoreToAdd,SightingPhotos}.test.tsx` (PASS).
- [ ] **Step 5: Commit** `SYC-624 C1: one date style, in Syros time, on the cat page`.

### Task C2: New strings

**Files:**
- Modify: `lib/i18n.ts` (`en` 11-783, `el` 785-1521, `fr` 1523-2260). Add each key in all three, with the English from the spec's Copy table and the drafts the spec gives for Greek and French tab labels. Draft the rest.
  - Keys: `catTabAbout`, `catTabPhotos`, `catTabStory`, `catTabMap`, `catTabPhotosA11y` ("Photos, {n}"), `catBannerSeePhotos`, `catBannerSeeStory`, `catSpottedTimesBy`, `catSpottedTimesByOne`, `catSpottedTimes`, `catSpottedOnce`, `catFans`, `catFansOne`, `reportNeedsHelpNamed`, `reportIssueLink`, `reportIssuePhotoLink`, `backA11y` ("Back").
  - Change `noNotifications` to "No notifications yet. Spot or follow a cat to get its news." (plus el/fr drafts).
  - Leave `reportIssue`, `reportIssuePhoto`, `timesSpottedStat`, `fansStat` and `sightingsHistory` in place. No unused-key check exists.
- Test: `lib/__tests__/i18n.test.ts` (existing).

- [ ] **Step 1:** Add the keys.
- [ ] **Step 2:** Run `lib/__tests__/i18n.test.ts` (PASS: same keys, same placeholders, tu-form).
- [ ] **Step 3: Commit** `SYC-624 C2: cat page strings (tabs, counts, link wording)`.

### Task C3: Split the page into tab components

**Files:**
- Create: `components/catPage/CatTabBar.tsx`:
  - Props: `{ tabs: { key: CatTab; emoji: string; label: string; badge?: number; a11yLabel: string }[]; selected: CatTab; onSelect: (k: CatTab) => void }`.
  - `role="tablist"`, each tab `role="tab"` with `aria-selected`, `aria-controls`, `id`; `accessibilityRole`/`accessibilityState` on native.
  - Min height 44, emoji above label, emoji `aria-hidden`.
  - Label `adjustsFontSizeToFit` with `minimumFontScale` to reach 10px, `numberOfLines={1}`, no ellipsis on web (`textOverflow: 'clip'`, font shrinks via a measured fallback step).
  - Arrow keys left/right move selection on web (roving `tabIndex`).
  - `export type CatTab = 'about' | 'photos' | 'story' | 'map'`.
- Create: `components/catPage/AboutTab.tsx`, `PhotosTab.tsx`, `StoryTab.tsx`, `MapTab.tsx`. Each takes the data it renders as props and holds no fetching. Move the JSX from `[id].tsx` per the spec's sections 3–6.
- Create: `lib/catPageFacts.ts`:
  - `seenQuietLine(t, { sightingsCount?: number; spottersCount?: number; followersCount?: number }): string | null` implements the spec's Seen-row cases exactly.
  - `visiblePhotoCount(sightings: Sighting[]): number` = Σ `(photoUrl && !photoHidden && !photoRemoved ? 1 : 0) + (extraPhotos ?? []).filter(e => !!e.photoUrl).length`.
- Modify: `app/cat/[id].tsx`:
  - Holds `const [tab, setTab] = useState<CatTab>('about')`.
  - Renders the hero, then `CatTabBar` as a separate direct child of the `ScrollView` with `stickyHeaderIndices={[1]}`, then only the selected tab's component inside `role="tabpanel"` / `aria-labelledby`.
  - The back `IconButton` moves out of the hero into an absolutely positioned overlay outside the `ScrollView` (top: `insets.top + 8`, size `lg` = 48), labelled `t('backA11y')`.
  - Switching tab: `scrollRef.current?.scrollTo({ y: Math.min(currentY, heroHeight), animated: false })` only when `currentY > heroHeight`.
  - Hide the Story tab when `careTimeline === undefined`.
  - Remove `catCode`, `StatTile`, the tags row, the discovered-by row and the `sightingsHistory` title.
- Create: `components/catPage/QuestionCards.tsx`: props `{ cat: { id: number; name: string; photoUrl: string | null }; homeAction: 'claim' | 'askStreet' | 'askHomed' | null; claimDisabled: boolean; onHome: () => void; homeCardRef: React.Ref<View> }`. It renders the 🩹 "{name} needs help" card and, when `homeAction !== null`, the 🏠 "{name} lives with me" card (`t('claimCat')`). Two equal columns, or full width when there's one. Each card is a `Pressable` with `role="button"`, min height 44, emoji `aria-hidden`, and text that may wrap. The help card reuses `NeedsHelpLink`'s press behaviour: extract its handoff-and-navigate logic into an exported `useOpenNeedsHelp(cat)` hook in `components/report/NeedsHelpLink.tsx`, so the link and the card share it. testIDs: `needs-help-card`, `lives-with-me-card`.
- Create: `lib/catPageFacts.ts` also exports `homeActionFor({ isOwner, canClaim, claimCooldown, lifeStatus, hasHome }): 'claim' | 'askStreet' | 'askHomed' | null`, implementing the spec's four cases: owner / `in_care` / `deceased` / cooldown → null; `canClaim` → 'claim'; `hasHome` → 'askHomed'; street → 'askStreet'.
- Modify: `components/report/ReportIssueLink.tsx`: uses `t('reportIssueLink')`, and its flag icon becomes a 🚩 emoji (`aria-hidden`) in front of the text. Render it as the last item of every tab panel. `components/PhotoViewer.tsx`'s report link uses `t('reportIssuePhotoLink')`.
- Modify: `components/purropolis/Button` is unchanged. The spot button gets `iconLeft={<Feather name="camera" size={18} color={colors.primaryForeground} aria-hidden />}`.
- Modify tests: the three `CatPage*.test.tsx` mocks must export everything the page now imports from `@/components/purropolis` (add `IconButton` as a real component so the back label can be asserted). Add a `switchTab(name)` helper that clicks `[role="tab"]` by text. Move the Photos assertions behind `switchTab('Photos')`. Update text expectations: `en.reportIssueLink`, and the cards. `CatPageClaim.test.tsx`'s `claim-ask-link` and claim-button assertions move to `lives-with-me-card` (same sheets opened, same focus return, same offline line). `CatPageSpotted.test.tsx`'s order check becomes: 'Last seen' before `spotted-cat-button`, before `needs-help-card`. `CatPagePhotos.test.tsx`'s order check becomes: `needs-help-card` before `report-issue-link`.
- Test: `components/__tests__/CatPageTabs.test.tsx` (new), `lib/__tests__/catPageFacts.test.ts` (new).

- [ ] **Step 1: Write failing tests** in `catPageFacts.test.ts`, one for each Seen-row case in the spec:
  - (14, 6, 9) → 'Spotted 14 times by 6 spotters · 9 fans'
  - (14, 1, 0) → 'Spotted 14 times by 1 spotter'
  - (1, 1, 1) → 'Spotted once · 1 fan'
  - (5, 0, 2) → 'Spotted 5 times · 2 fans'
  - (0, 0, 0) → null
  - (14, undefined, undefined) → 'Spotted 14 times'
  - `visiblePhotoCount` for one cover + 2 extras + 1 hidden + 1 removed = 3.
- [ ] **Step 2: Write failing tests** in `CatPageTabs.test.tsx`:
  - About is selected first, and only its panel is in the DOM.
  - Each tab shows its own content (Photos: `sighting-cover`; Story: "Agatha’s story"; Map: AppMap stub mounted only after selecting Map).
  - The Photos badge equals `visiblePhotoCount`, and there's no badge at 0.
  - The Story tab is absent when `careTimeline` is undefined.
  - No `SYR-` text anywhere.
  - The update banner shows on About for `?updateId=`, and its "See photos" link selects Photos.
  - `?report=wrong_info` opens the sheet, and the sheet stays open when the tab changes.
  - The tab choice survives a re-render with new `h.data`.
  - `homeActionFor` returns each of its four answers (in `catPageFacts.test.ts`), and the page shows the 🏠 card only for 'claim' / 'askStreet' / 'askHomed', with the help card full width otherwise.
  - "Something wrong on this page?" is the last item in each of the four panels.
  - The back button's label is "Back".
  - The spot button exists and its icon is `aria-hidden`.
  - A payload with only `fansCount` (no new fields) shows "Spotted 14 times" and no fans phrase.
- [ ] **Step 3:** Run both. Expect FAIL.
- [ ] **Step 4:** Implement the components, `[id].tsx`, the link labels and the test-mock updates.
- [ ] **Step 5:** Run `pnpm --filter cat-spotter test` (full app suite, PASS) and `pnpm --filter cat-spotter typecheck`.
- [ ] **Step 6: Commit** `SYC-624 C3: the cat page in four tabs`.

### Task C4: Look and readability (SYC-509 parts)

**Files:**
- Modify: `components/catPage/AboutTab.tsx` and the shared quiet styles. Quiet text on this page uses `palette.stone700` (#47596a) in light mode. Pick a dark-mode value from `constants/colors.ts` that reaches 4.5:1 on `aegean950`, and add it as a page-local constant with a comment showing both contrast ratios.
- Card styling for `QuestionCards` (card background, thin border, rounded); check that it is visibly quieter than the main button at 360 px in Greek (`Η Agatha χρειάζεται βοήθεια` wraps cleanly).
- Facts-card icons and Story icons get `aria-hidden`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Screenshots** in the browser pane: 360 px, 390 px and desktop; en and el; light and dark. Include the About, Photos, Story and Map tabs for a seeded cat, scrolled to show the sticky tab row and the fixed back button. Check that `Φωτογραφίες` fits at 360 px without clipping, and that the first screen at 390 px shows the photo, the name, the tab row and the start of the facts card. Save them to `docs/screenshots/syc-624-c/`.
- [ ] **Step 3: Commit** `SYC-624 C4: readable grey, question cards styling, screenshots`.

PR C then: open the draft PR "SYC-624 C: a cat's page in four tabs", stacked on B, with the screenshots in the body. It stays a draft until B merges.

---

## PR D — The Follow button (branch `claude/syc-624-d-follow`, stacked on C)

### Task D1: Follow / Following in the photo header

**Files:**
- Create: `components/catPage/FollowButton.tsx`:
  - Props: `{ catId: number; catName: string; deviceId: string; isFollowing: boolean; isOnline: boolean }`.
  - Uses generated `useFollowCat` / `useUnfollowCat` with `networkMode: 'always'`.
  - Optimistic: flip local state, then `queryClient.setQueriesData({ queryKey: getGetCatQueryKey(catId) }, prev => prev ? { ...prev, isFollowing, followersCount } : prev)` on success, using the server's `FollowState`. On error, roll back and show `t('followFailed')` for 4 s.
  - Disabled offline, with `t('followNeedsConnection')`.
  - Labels `♡ Follow` / `♥ Following` (hearts as Feather `heart` outline/filled, `aria-hidden`).
  - `accessibilityRole="switch"`-style toggle: `role="button"`, `aria-pressed={isFollowing}`, label `t('followA11y')` with `{name}`.
  - Min 44 × 44.
- Modify: `app/cat/[id].tsx`: render `FollowButton` in the fixed overlay at the top right, opposite Back. Hide it when:
  - `data.isFollowing === undefined` (unknown phone or older server);
  - the phone is the owner;
  - the cat has died and `isFollowing` is false (`lifeStatus` deceased per `lib/catStatusLines.ts`).
- Modify: `lib/i18n.ts`: add `followCat`, `followingCat`, `followA11y`, `followNeedsConnection` and `followFailed` (all three languages).
- Test: `components/__tests__/FollowButton.test.tsx` (new); extend `CatPageTabs.test.tsx`. Wrap renders in a `QueryClientProvider` with a fresh `QueryClient`; mock the two generated hooks.

- [ ] **Step 1: Write failing tests:**
  - Tapping Follow calls `followCat` with `{ catId, data: { deviceId } }` and shows "Following".
  - A refused call rolls back and shows the failure note.
  - Offline: disabled, with the connection note.
  - `aria-pressed` reflects the state.
  - Page level: hidden for the owner, hidden when `isFollowing` is undefined, hidden on a deceased cat when not following, and shown as "Following" on a deceased cat when following.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter cat-spotter test` and `typecheck` (PASS).
- [ ] **Step 5: Probe:** with local api-server + app web preview (memory: dashboard-preview-cookie-host and web-offline-simulation for the offline case), follow a seeded cat, reload, and see "Following" and the fans count up by 1. Unfollow and see it go back. Spot that cat again from the same phone (local sighting resolve) and see it stay "Follow". Screenshot at 390 px.
- [ ] **Step 6: Commit** `SYC-624 D1: Follow and Following on the cat page`.

PR D then: open the draft PR "SYC-624 D: follow a cat", stacked on C.

---

## After the PRs

- Comment on SYC-59: merge must move `cat_subscriptions` and `cat_unfollows` to the surviving cat.
- Comment on SYC-66: the privacy policy must cover follows of cats a phone never spotted and unfollow records (spec "Privacy").
- Comment on SYC-510: the cat-page parts are done; the picker and match screen SYR numbers are still open.
- Run migration 0042 on production (db-ops workflow, Neon snapshot first, "ask" mode) **before** Samuel republishes. Then `/api/healthz` shows the new commit, then smoke-test following on the test site.
- New Greek and French strings go into the SYC-4 / SYC-346 review pack.

## Model delegation

Session model: Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| A1 Syros days | Sonnet | small, fully specified, one function plus snapshots | Its tests; session-model spot review of the snapshot diff (only day strings may change) |
| B1–B2 table, migration, routes, limiter | Sonnet | standard route and migration work with an existing pattern to copy | Tests; `migrate:check`; session-model diff review |
| B3 unfollow sticks, B5 followers' pushes | Sonnet | small code change, but each guards a **silent** failure | **Mutation probes** (written into B3 step 5 and B5 step 5) plus tests; consumer list in the PR B body |
| B4, B6, B7 claim follow, new fields, deletion | Sonnet | clear spec, existing helpers | Tests (including `me.delete.test.ts`); spot review |
| C1–C2 dates and strings | Sonnet | mechanical with exact test values | Tests and the i18n test |
| C3 tab split | Sonnet | biggest change, but the spec pins every behaviour and the tests pin each one | Full app suite and typecheck; session-model review of `[id].tsx` before commit |
| C4 visual pass and screenshots | Session model (Opus) | judging fit and contrast at three widths, in two languages and themes, needs eyes on the result | Screenshots saved in the repo and shown to Samuel |
| D1 Follow button | Sonnet | clear component with a mutation pattern to copy | Tests plus the end-to-end probe in step 5 |
| Per-PR adversarial review before `gh pr ready` | Opus, one fresh reviewer per PR in its own worktree (never shared) | escalation: B changes who gets notified about cats and adds personal data, and C/D rebuild the most-used public page; a reviewer must be able to refute subtle notification and privacy reasoning | Findings folded in before ready; the reviewer proves at least one test can fail |
| Final integration, Linear sync, production migration | Session model (Opus) | needs the whole picture and live checks | `/api/healthz` commit check, smoke after republish |

Every agent prompt restates: **commit after each task, and write the checkpoint note.**
