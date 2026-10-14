# SYC-105 PR 2.1 (#150): independent adversarial review

Reviewer: Claude (Opus, independent of the builder, own worktree `agent-a39d0538878187548`, branch `claude/syc-105-pr-2-1-review` off `origin/claude/syc-105-pr-2-1` at `c346484`). 14 Oct 2026.

Inputs: plan `docs/superpowers/plans/syc-44-report-an-issue.md` (Slice 2, the photoLimiter small call, review rows 4 and 16), the PR body, `git diff origin/main...HEAD`, express-rate-limit 8.6.0 source. Probes: `artifacts/api-server/src/lib/limits.review.test.ts` on this branch (not for merge; R1 to R5 below). All local runs against local Postgres (throwaway databases), never Neon.

## Findings

| # | Finding | Severity | Status, file:line |
|---|---|---|---|
| 1 | The PR no longer merges cleanly: main's SYC-130 (#142) landed `0018_cat_home_pin`, so `0018_rate_limit_counters` collides (add/add conflict in `meta/0018_snapshot.json`, conflict in `_journal.json`), and #142's new in-memory `checkClaimLimit` Map auto-merges untouched into `rateLimit.ts`, leaving a per-process limiter the plan says "whichever merges second" must move | Blocker | CONFIRMED, `git merge-tree origin/main origin/claude/syc-105-pr-2-1`; main `middlewares/rateLimit.ts:173-203`, `routes/cats.ts:417` |
| 2 | The sweep deletes any window longer than 3 hours while it is still live. `COUNTER_KEEP_HOURS = 3` is safe for today's 15-minute and 1-hour windows, but the claim limit that must move here (finding 1) is a 24-hour window, and Slice 5's "15 hides a day" stands on this store. A day's count is wiped by the first sweep after 03:00 UTC, so a daily limit becomes roughly a 3-hour one | Major | CONFIRMED (probe R3), `lib/limits.ts:269,274-278` |
| 3 | `consume(…, tx)` writes and caches the day's salt inside the caller's transaction. If that transaction rolls back (exactly the "rolled-back report doesn't use the hide limit" case Slice 5 plans), the salt row is gone but stays in this server's cache; the next server makes a different salt for the same day, and one address gets two counters for the rest of the day (limit doubled). An uncommitted salt insert also makes every other server's first salt lookup of the day wait on that transaction | Major (latent: no caller passes `tx` yet; Slice 5 will) | CONFIRMED (probe R2), `lib/limits.ts:64-77, 79-82, 103-104` |
| 4 | Four test files still call the now-async reset helpers without `await` (floating promises): a `DELETE` racing the test's first requests, and a possible unhandled rejection after `pool.end()` | Minor | CONFIRMED, `routes/me.delete.test.ts:354`, `routes/sightings.aiLimiter.test.ts:59`, `routes/sightings.matchHardening.test.ts:88`, `routes/photoVisibility.test.ts:248` |
| 5 | Test setup clears counts only `beforeEach`, so a file's `beforeAll` (which often seeds by HTTP from 127.0.0.1) starts with whatever the previous file's last test counted. Before, each file started from empty memory. It doesn't mask a cross-file leak (clearing per test is stricter than per file), but it adds an order dependence; the `catch {}` also swallows a real failure to clear | Minor | PLAUSIBLE, `test/setup.ts:20-26` |
| 6 | No guard on window length or bucket names. Nothing stops a caller passing a `windowMs` over `COUNTER_KEEP_HOURS` (finding 2) or one that doesn't divide a day, or two `sharedLimiter`s reusing one bucket name (silently sharing a budget) | Minor | CONFIRMED by reading, `lib/limits.ts:94-114, 241-264` |
| 7 | T2-6 covers the report, draft and keep-safe peek, but not the other fail-closed paths (AI limiter, per-device match, delete-me, new-phone cap off the welfare routes) nor `PUT /reports/:id/photo` failing open. Probe R5 shows the AI limiter, `POST /sightings` and `DELETE /me` do answer 503 + `Retry-After: 5` today; nothing pins it | Minor | CONFIRMED (gap), `lib/limits.test.ts:172-221` |
| 8 | "No address is ever stored" is true in the letter only. The salt sits in the same database as the hashed keys, so anyone with database read access (or Neon's restore history) can recover an IPv4 address from a key in about 2^32 hashes while the row and its salt both exist (rows ≤3 h, salts ≤~48 h). Acceptable for the plan's design, but the PR body and schema comment should say "not stored in the clear" | Minor | CONFIRMED by reading, `lib/limits.ts:22-28`, `lib/db/src/schema/rateLimits.ts:13-17` |
| 9 | A pre-existing supertest transport flake (`socket hang up`, `Parse Error: Expected HTTP/`) in keepSafe.takeover: 2/30 on the branch, 1/30 on main. Not caused by this PR | Minor (pre-existing; ticket it) | CONFIRMED, see "Flaky tests" below |

## Each finding: what, why it matters, fix

### 1. Merge conflict with SYC-130, and the claim limiter left in memory (Blocker)

**What.** `origin/main` is at `5c2ebb1`; the PR's merge base is `c803728`. Since then #142 (SYC-130) added `lib/db/migrations/0018_cat_home_pin.sql` with its own `meta/0018_snapshot.json` and journal entry, and a per-device claim limiter in `middlewares/rateLimit.ts` (`CLAIM_LIMIT = 5`, `CLAIM_WINDOW_MS = 24 h`, an in-memory `Map` with the lazy sweep). `git merge-tree` shows conflicts in the snapshot and journal only. `rateLimit.ts` merges *cleanly*, which is the dangerous part: the claim limiter would ship as a per-process Map, so "one limit means one limit" stops being true the moment the one-instance pin is lifted (SYC-105 step 4).

**Why.** The PR can't merge as is, and resolving only the textual conflicts leaves a limiter behind. The plan says SYC-130 and SYC-2 limiters use the shared factory if they merge first.

**Fix.** Rebase on main; renumber to `0019_rate_limit_counters` and regenerate the snapshot (`drizzle-kit generate` against main's 0018 snapshot), re-run `migrate:check` and `runner.test.ts`. Move `checkClaimLimit` onto `consume("claim", deviceId, CLAIM_LIMIT, CLAIM_WINDOW_MS)` (fail closed, 503, like the device-match limit), make `_resetClaimLimitForTests` async and await it at its three callers. This depends on finding 2 being fixed first, since the claim window is 24 hours. Note too that a clock-aligned 24-hour window resets at 00:00 UTC (02:00/03:00 Athens), not 24 hours after the first claim.

### 2. The sweep deletes live windows longer than 3 hours (Major)

**What.** `sweepRateLimits` deletes `window_start < now() - 3 hours` regardless of the window's length. A 24-hour window starts at 00:00 UTC, so from 03:00 UTC the hourly sweep deletes it. Probe R3, run at about 06:00 UTC: 15 consumes, the 16th refused, sweep, the 17th is allowed with `hits = 1`.

**Why.** Harmless for every limiter in this PR (15 min, 1 h). But finding 1 brings a 24-hour limiter onto the store now, and Slice 5's address hide limit ("15 a day") is planned on it. Both would quietly become about 3-hour limits. Nothing fails; abuse limits just stop holding.

**Fix.** Store the window's end: add `window_ms int` (or `expires_at timestamptz`) to the row, and sweep `where window_start + window_ms * interval '1 millisecond' < now() - interval '1 hour'` (or `expires_at < now()`). A cheaper option is to make `consume` refuse any `windowMs` over `COUNTER_KEEP_HOURS` and raise the constant to 25 hours. The salt sweep (`day < today - 1`) is then also fine for windows up to 24 hours. Add a test: a 24-hour window survives the sweep at 05:00 and goes after it ends.

### 3. A salt cached from a rolled-back transaction splits one key's count (Major, latent)

**What.** `saltFor(day, exec)` runs `insert … on conflict do nothing` and `select` on the executor it's given (`tx` when the caller passes one) and caches the result in a module-level Map. Probe R2: inside a transaction on a fresh day, `consume(..., tx)`, then roll back. `rate_limit_salts` has no row for that day, but this process keeps the cached salt. A second instance (fresh module graph) then creates a new salt for that day. One address in one window ends up with **2 rows**, so each server allows the full limit. It lasts until the day ends.

There's a second effect while the transaction is open. Any other connection inserting the same day's salt waits on the uncommitted unique key until that transaction ends.

**Why.** Slice 5 plans exactly this: "address hide limits … consumed in the same transaction … so a rolled-back report doesn't use them up", plus the "Photo hidden" mail cap "counted with `consume()` inside the report's transaction". The first such rollback on a server's first touch of the day splits the hide limit across servers.

**Fix.** Always get the salt on the pool, never through `tx`: `hashKey(key, start, db)` in `consume`, `peek` and `reset`, so the salt commits on its own. Only the counter upsert should use `tx`. Add R2 as a regression test.

### 4. Un-awaited reset helpers (Minor)

**What.** `_resetNewDeviceLimitForTests` and `_resetDeviceMatchLimitForTests` are async now. Four `beforeEach` hooks became `async` but don't `await` them. **Fix.** Add `await` at the four call sites (or delete those calls, since `setup.ts` already clears everything).

### 5. `beforeAll` isn't covered by the clear (Minor)

**What.** Vitest runs setup-file `beforeEach` before each test, not before a file's `beforeAll`. Counts from the previous file's last test carry into the next file's `beforeAll` seeding. **Fix.** Also register a `beforeAll(clear)` in `setup.ts`. Narrow the `catch` to the "no database / stubbed module" case, or log it.

### 6. No guards on `windowMs` or bucket names (Minor)

**Fix.** In `consume`/`sharedLimiter`, throw at creation if `windowMs` exceeds what the sweep keeps, or doesn't divide 24 h (the "a window never straddles two salts" comment assumes it does). Keep a module-level `Set` of bucket names in `sharedLimiter` and throw on a duplicate.

### 7. Fail-mode tests cover three routes only (Minor)

**Fix.** Extend T2-6 with: `POST /cats/name-suggestions` 503, `PUT /reports/:id/photo` from a never-seen phone accepted while broken, a non-welfare `verifyDeviceSecret` bind (e.g. `POST /sightings` past `aiLimiter`, or `GET /notifications/:id`) 503, and `DELETE /me` 503. R5 in the probe file is a starting point.

### 8. Salted hash next to its salt (Minor)

**Fix.** Wording only, unless Samuel wants more: say "stored only as a salted hash, the salt kept for two days". If stronger is wanted, hold the salt only in memory, derived from a configured secret plus the day (HMAC). The plan deliberately avoided a new secret, so wording is the recommendation.

### 9. Supertest transport flake (Minor, pre-existing)

**What.** keepSafe.takeover occasionally fails on a transport error, not an assertion, on main as well as the branch (numbers below). **Fix.** A separate ticket. A likely cause is supertest opening a new ephemeral server per request under load on macOS. Not a reason to hold this PR.

## Flaky tests: branch vs origin/main (10 runs each, file alone)

Each file run alone (`vitest run <file>`), serially, branch worktree vs a detached `origin/main` (`5c2ebb1`) worktree, same local Postgres. keepSafe.takeover got 20 extra runs per side after the first 10 showed one failure.

| File | Branch | origin/main |
|---|---|---|
| `routes/keepSafe.takeover.test.ts` (first 10) | 9 pass, 1 fail | 10 pass, 0 fail |
| `routes/keepSafe.takeover.test.ts` (next 20) | 19 pass, 1 fail | 19 pass, 1 fail |
| **keepSafe.takeover total (30)** | **28 pass, 2 fail** | **29 pass, 1 fail** |
| `lib/sightingRoundUp.test.ts` (10) | 10 pass, 0 fail | 10 pass, 0 fail |

**Verdict: the branch doesn't make them flakier.** Every keep-safe failure, on both sides, was a transport error from supertest's throwaway HTTP server, not an assertion. The branch had `socket hang up` (test "2. … within 60 s") and `Parse Error: Expected HTTP/` (test "4. … device_moved"); main had `Parse Error: Expected HTTP/` (test "11b. Delete Nikos"). Each was a different test each time. "Two simultaneous redeems" never failed in 60 runs. 2 vs 1 in 30 is noise, and the failure mode exists on main. sightingRoundUp didn't fail alone on either side; the builder's failure was in a full run, so it's probably load or timing on a slow machine. The supertest transport flake is pre-existing and worth a ticket (finding 9).

## Mutation probes (re-run by the reviewer, each reverted)

| Break | Expected (PR body) | Reviewer's result |
|---|---|---|
| Count per process in memory (`consume` returns from a module Map) | T2-1 red (+ T2-2, 3, 4, 6) | T2-1, T2-2, T2-3, T2-4, T2-6 red; T2-5 green. **Matches** |
| Key on the raw address (`keyGenerator: req => req.ip` and `addressKey` = identity) | T2-5 red, only T2-5 | `limits.test.ts`: T2-5 only. `newDeviceLimit.test.ts`: its two grouping tests also red. **Matches** (and the cap is double-pinned) |
| Raw address in `sharedLimiter` only (`addressKey` kept) | (extra) | T2-5 red (`expected 201 to be 429`) |
| Report limiter `failOpen: false` | T2-6 red, only T2-6 | T2-6 only (`expected 503 to be 201`). **Matches** |
| Welfare new-phone cap `limiterFailsOpen: false` | (extra) | T2-6 red (`expected 503 to be 201`) |
| Draft limiter `failOpen: false` | (extra) | T2-6 red (`expected 503 to be 204`) |

Each was reverted with `git checkout --`, and the tree was clean after each.

## Checked and found correct

- **Atomicity.** `consume` is one `insert … on conflict (bucket, key, window_start) do update set hits = hits + 1 returning hits`. No read-then-write. The salt is `insert … on conflict do nothing` then `select`, race-safe. Probe R1: 50 parallel consumes with limit 10 gave exactly 10 allowed and 50 distinct hit counts. On a cold day, split across two module graphs (two pools, two salt caches), it gave one row and exactly 10 allowed.
- **Boundaries.** Windows are epoch-aligned, so every server picks the same one. The salt is the window-*start* day's, so a window never uses two salts, and salt rotation can't break an in-progress window. The 15-minute and 1-hour windows divide a day. Athens vs UTC makes no difference for them (Athens is a whole-hour offset). Probe R4: 10 at 10:59:59 and 10 at 11:00:00 are all allowed (2× at the boundary). That matches the old express-rate-limit `MemoryStore` and the old Maps, which were also fixed windows (anchored at the key's first hit), and so allowed the same 2× burst. Acceptable.
- **Keys.** Every moved express-rate-limit limiter (ai, handoff, delete_me, keep_safe_peek, keep_safe_redeem, report, report_draft) still uses the library's default key generator, `ipKeyGenerator(req.ip, 56)`: IPv6 by /56, IPv4-mapped as IPv4. The new-device cap uses `addressKey` = `ipKeyGenerator`, the same as before. The device-match limit still keys on the `verifiedDeviceId` returned by `verifyDeviceSecret` (`routes/sightings.ts:477`), never the IP or raw body. `aiLimiter` is still one budget shared by `POST /sightings` and `POST /cats/name-suggestions` (one bucket, as before one MemoryStore). `trust proxy: 4` is unchanged. Buckets are unique and the bucket is part of the primary key.
- **Fail modes.** The report and draft limiters, and `verifyDeviceSecret`'s new-phone cap on `POST /reports`, `POST /reports/draft` and `PUT /reports/:id/photo`, fail open (T2-6). Every other path fails closed with 503 + `Retry-After: 5`. That covers `sharedLimiter` (the store rethrows, express-rate-limit's `handleAsyncErrors` passes it to the wrapper's callback), device match (`sightings.ts` try/catch), the new-phone cap elsewhere (`deviceAuth.ts` try/catch), and the reset-at lookups (`.catch(() => undefined)`). Probe R5 confirmed 503s on name-suggestions, `/sightings` and `DELETE /me` with the table gone. `sweepRateLimitsIfDue` never throws. No path found where a counter error becomes a 500 or an unhandled rejection in production code. `PostgresStore.decrement` is unused (no skip options) and swallows its errors anyway.
- **Everything moved.** On this branch the only `express-rate-limit` instance outside `lib/limits.ts` is `photoLimiter`. Its options are byte-identical to main (only a comment added). The device-match and new-device Maps are gone, and no other limiter Map is left. (Main's new claim Map is finding 1.)
- **The sweep.** It runs at most hourly per server (module `lastSweep`, set before running), and T2-4 pins it. It deletes windows that started over 3 h ago, safe for every window in this PR (≤1 h). It deletes salts for days before yesterday, and no live ≤1 h window can use them. Its clock (`now()` in the database) vs the app's `Date.now()` only matters to within skew.
- **Test setup.** Clearing per test is stricter than the old per-file memory, so it can't hide a leak within a test, and T2-1 and T2-2 each run within one test, so they still mean what they say. Bucket uniqueness means a cross-limiter leak would still show within a single test. (Order dependence: finding 5.)
- **Migration 0018.** Two `CREATE TABLE`s, matching `lib/db/src/schema/rateLimits.ts`. The rollback block has every line commented, drops both tables, and its note says to roll the app back first. `migrate:check` passes ("19 migration(s); the schema code, the snapshots and the SQL agree"), and `lib/db` `runner.test.ts` passes 25/25 (up/down/up over every migration). Both are on the branch as it stands; they must be re-run after the renumber (finding 1).
- **Tests on the branch.** `limits.test.ts`, the middlewares tests and the probe file pass locally (78 + 6).

## Re-check, 14 Oct 2026 (PR head `a30c6c8`)

Same reviewer and worktree; the review branch was reset onto `origin/claude/syc-105-pr-2-1` at `a30c6c8`, with this doc and the probe file brought over. The probes were rewritten so R2 and R3 now assert the *fixed* behaviour, and S1–S7 were added for the sliding mode (`artifacts/api-server/src/lib/limits.review.test.ts`): **16/16 pass**. `migrate:check` ok (20 migrations); `lib/db` `runner.test.ts` 25/25 (up/down/up including `0019_rate_limit_counters`). `git merge-tree` against today's `origin/main` (`db08fab`) is clean, and the three commits since (SYC-166 slice 3, SYC-231, the SYC-209 plan) add no migration and no limiter. Full api-server suite locally, with the probe file included: **1555 passed, 1 skipped, 1 failed (106 files)**. The one failure is in `keepSafe.takeover` ("SYC-262: Forget this address…"), `Parse Error: Expected HTTP/`. That's the same pre-existing supertest transport flake as finding 9 (also seen on main), not an assertion.

| # | Finding | Severity | Status, file:line |
|---|---|---|---|
| 1 | Merge conflict with SYC-130; claim limiter left in memory | Blocker | **FIXED.** Rebased onto main (`7b675ae`), migration renumbered to `0019`, snapshot regenerated, `migrate:check` ok. `checkClaimLimit` is on `consume` (sliding, `rateLimit.ts:173-187`) and fails closed with 503 (`routes/cats.ts:418-427`, tested in `cats.claim.v2.test.ts:563`) |
| 2 | Sweep deletes live windows longer than 3 h | Major | **FIXED.** Rows carry `window_ms`. The sweep keeps a row for its window plus max(window, 1 h) (`lib/limits.ts:380-385`). R3: a fixed day window is still refusing at 23:59 after a sweep and gone two days later. S4: yesterday's sliding row survives a sweep at 23:59 today |
| 3 | Salt cached from a rolled-back transaction | Major | **FIXED.** The salt is always made on the pool (`lib/limits.ts:93-111`). R2: the salt row survives the rollback, and the two later consumes from two module graphs share one row (`hits = 2`) |
| 4 | Un-awaited async reset helpers | Minor | **FIXED.** No un-awaited call left (grep) |
| 5 | Counters not cleared before `beforeAll`; failures swallowed | Minor | **FIXED.** `beforeAll` and `beforeEach` both clear, and errors propagate (`test/setup.ts:18-24`) |
| 6 | No guard on window length or bucket names | Minor | **PARTLY FIXED.** `assertWindow` refuses windows that don't divide a day (S7c), and a bucket re-registered with *different* settings or mode throws (S7a). A second `sharedLimiter` with the **same** bucket name and settings is still accepted and silently shares the budget (S7b). The builder's test asserts this on purpose (`limits.test.ts:320`), because `consume` re-registers on every call. Fix if wanted: a separate "owner" set in `sharedLimiter` (`lib/limits.ts:337-338`) |
| 7 | Fail-closed paths untested | Minor | **FIXED.** New test covers both AI routes, delete-me and the new-phone cap on `GET /notifications` (`limits.test.ts:238-262`). T2-6 adds `PUT /reports/:id/photo` from a never-seen phone (`limits.test.ts:224-231`). Claim 503 is in `cats.claim.v2.test.ts:563` |
| 8 | "No address stored" overstated | Minor | **FIXED** (`lib/limits.ts:22-29`, schema comment, PR body). One sentence is now wrong; see N4 |
| N1 | **Refused requests are counted in sliding mode and carry into the next window.** The upsert increments on every call, refused or not. In sliding mode that count weighs on the whole next day. Probe S5: 50 claim attempts on day 1 (45 refused) and the phone is still refused at 12:00 **and 21:00 on day 2**; it's free only after about 21:36. That's a regression from the SYC-130 Map it replaces, which counted nothing once refused, so the phone was free 24 h after its first claim. It matters more for Slice 5's address hide limit (a busy shared address stays hide-limited into the next day). Fixed mode isn't affected (the count resets at the boundary) | Minor | CONFIRMED (S5), `lib/limits.ts:172-179`. **Fix:** in sliding mode cap the stored count, e.g. `do update set hits = least(rate_limit_counters.hits + 1, ${limit + 1})`, so a refused request can't push the carry-over above "one over the limit"; add S5 as a test |
| N2 | **"The 6th call within any 24 hours returns false" isn't what the sliding estimate does.** The previous window is weighted as if its requests were spread evenly. Probe S6: 5 claims at 23:00, then 2 more allowed at 12:00 next day = **7 in 13 hours**. The worst case is about 9 in a rolling 24 h (vs 10 in 2 minutes with a fixed window). A big improvement on bursts, but an approximation. The builder's own tests (5 at 23:59, 6th at 00:01 refused) are correct | Minor | CONFIRMED (S6), `middlewares/rateLimit.ts:175` (also the test name "5 per 24 hours", `limits.test.ts:330`). **Fix:** wording, e.g. "about 5 per rolling 24 hours (sliding-window estimate)", unless an exact rolling limit is wanted |
| N3 | In sliding mode `resetAt` is the end of the *current* window, so `Retry-After`/`RateLimit-Reset` (via `sharedLimiter`) and `peek().resetAt` can tell a client to retry while the weighted previous window still refuses it (worse with N1). No route uses a sliding `sharedLimiter` today, and the claim 429 sends no `Retry-After`, so it's latent | Minor | PLAUSIBLE (by reading), `lib/limits.ts:188, 223`. **Fix:** compute the earliest time the estimate drops to `limit` (solve `prev·(1 − t/W) + cur ≤ limit`), or document that it's a lower bound |
| N4 | Stale comments: the header still says "Fixed windows, aligned to the clock" with no mention of sliding (`lib/limits.ts:34-35`). "Counter rows go within about an hour of their window ending" (`lib/limits.ts:29`, and the PR body) is wrong for day-long rows, which are kept a further whole window (about two days in all, `lib/limits.ts:365-372`). The privacy wording should say day-long (claim) rows are kept about 2 days | Minor (wording) | CONFIRMED, `lib/limits.ts:29, 34-35`; PR body "No address is ever stored in the clear" paragraph |
| N5 | `registerBucket` runs inside `consume`, so a mis-registered bucket (fixed vs sliding, or different limit) only shows up at request time, inside the callers' try/catch. On a welfare route it logs and fails open (no limit at all); elsewhere it's a 503 on every request. A programming error, not a runtime one, and it should fail at boot | Minor | PLAUSIBLE (by reading), `lib/limits.ts:154, 338`; callers `routes/reports.ts` (failOpen), `middlewares/newDeviceLimit.ts`. **Fix:** register the function-call limiters (device match, new device, claim) once at module load as `sharedLimiter` does, so a clash throws on import |

### Sliding mode: the specific questions

- **Is the previous-window read in the same statement as the increment?** Yes. A single statement: a CTE `insert … on conflict do update … returning hits` plus a scalar sub-select of the previous window's row (`lib/limits.ts:172-185`). There's no read-then-write gap for the current count. The previous window is no longer written (bar clock skew between servers), so reading it from the statement snapshot is exact. **S1:** 50 parallel `checkClaimLimit` on a fresh key gives exactly 5 allowed. With 2 claims the previous day, at 06:00 across two module graphs, it gives exactly 3 allowed (1.5 + 3 ≤ 5 < 1.5 + 4).
- **Is the previous window's salt correct across midnight?** Yes. `prevHashed` uses `dayOf(prevStart)`, i.e. yesterday's salt for a day window, and the salt sweep keeps `day >= today − 1`. **S3:** 5 claims at 23:00, then a fresh process with an empty salt cache (salts read from the database) at 00:30: refused (5 × (1 − 0.5/24) + 1 ≈ 5.9).
- **Does `<= limit` count correctly?** Yes. **S2:** `[true ×5, false]` on a fresh key. The returned `hits` is `ceil(estimate)`, and since `limit` is an integer, `ceil(e) <= limit ⇔ e <= limit`, so express-rate-limit's own comparison agrees with `allowed`.
- **Can the sweep delete the previous window while it's still needed?** No. A row goes when `window_start + window_ms + max(window_ms, 1 h) < now`. For a day window that's 2 days after its start, exactly when it stops being "previous". **S4** confirms both sides.
- **Is fixed vs sliding registration enforced?** Yes, within a process: the claim bucket used in fixed mode throws "registered twice" (**S7a**). Same-settings duplicates are allowed (finding 6 remainder). It's checked at request time, not boot (N5).

### Anything bypassing the store after the rebase

`grep` for `express-rate-limit`, `rateLimit(`, and `{ count, resetAt }`-style Maps in `artifacts/api-server/src` (non-test): the only express-rate-limit instance outside `lib/limits.ts` is `photoLimiter`, with options unchanged. The only Maps in `lib/limits.ts` are the bucket registry and the salt cache, neither of which is a counter. SYC-2 PR 1.2 (#143), pulled in by the rebase, adds no limiter. Nothing bypasses the store.
