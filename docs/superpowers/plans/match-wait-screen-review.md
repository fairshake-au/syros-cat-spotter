# Adversarial review: the match-wait screen plan (SYC-36, SYC-48)

**Reviewer:** an independent Sonnet agent, read-only, 15 October 2026. It was asked to refute the plan, not confirm it. It read the plan at commit `c130f52`, both approved specs and their review, the launch plan (PR #172), and the code on `origin/main`. It queried no database or live site, and fetched one public Google Play page.

**Verdict, in its words (condensed):** the copy is exact, most code claims are accurate, and the design is largely faithful to the specs. Before approval the plan needed fixes: a pre-launch gate that silently breaks the donation button for testers (the one blocker), a device-id log leak, tests the repo's test setup can't run, a dropped spec rule, a self-contradictory result-screen lifecycle, under-specified server queries, stale migration facts, and sharper decisions. "The PR 1 / PR 2 split itself is sound."

**What it confirmed holds:**
- Appendix A matches both specs word for word: all 60 fact strings and every key row, diffed by script with zero differences.
- The core ten, the sign-off nine and the four-fact worst case are correct.
- Appendix B's button names match `feedNudgeHelp`.
- The Google Play quote is real (it fetched answer 9858738 itself).
- These claims check out: C1, C2, C5, C7, C8, C10, `deviceAuth.ts:86`, `app.ts:30`, the `review.tsx` order and `DEPLOYMENT.md:51`.

**How the findings were checked.** Before acting, the main claims were re-checked against the code by the plan's author (Opus):
- `middlewares/prelaunchGate.ts:84-122` exempts only healthz, `/api/internal`, `/api/team` and `/api/mail`.
- `lib/logger.ts:61-62` redacts device ids only after `profiles|notifications|profile|keep-safe`.
- `artifacts/cat-spotter/vitest.config.ts:15-22` includes only `lib/**/*.test.ts`, `context`, `components`, `hooks` and `server`, in a `node` environment.
- PR #181 merged at 14:57 UTC on 15 Oct (`851c24a`), with `0025_mail_deliveries.sql` now on `main`.
- `apiOrigin()` is at `lib/urls.ts:15`.
- `GREEK_TIME_ZONE` is at `lib/photoClock.ts:29`.
- The launch plan has Johnny's corrections back Tue 27 and applied Wed 28 (feature freeze), with the final publish Thu 29.

## Findings and what happened to each

| # | Severity | Finding (condensed) | What happened |
|---|---|---|---|
| 1 | **Blocker** | The pre-launch gate (`prelaunchGate.ts`) blocks `/api/go/feed`: the phone's browser carries neither the website cookie nor the `X-Prelaunch-Key` header, so a native tester gets a `401` JSON page instead of the donation page until the gate comes off on 31 Oct. The plan never mentioned the gate, and its local-server test would hide it. The no-link fallback (the website's Help tab) has the same problem | **Fixed, and made a decision.** New **Decision 3**: exempt exactly `GET`/`HEAD /api/go/feed` from the gate (recommended), with a gate test; or accept a dead button for testers before launch. A live check after the gate comes off is added either way. The no-link fallback is now a plain page in the server's own words, so it doesn't land on the gated website (small call 5) |
| 2 | Major | `/api/app-settings/:deviceId/signals` puts the device id in request logs: `DEVICE_ID_IN_PATH` doesn't cover it (SYC-109 treats the id as a credential). No rate limit named | **Fixed.** `app-settings` added to the redaction pattern with a case in `app.logRedaction.test.ts`, listed under "Every place the guards must hold". The signals route gets a shared limiter bucket |
| 3 | Major | Several promised tests can't run: `vitest.config.ts` only picks up `lib/**/*.test.ts` and `.test.tsx` under `context`, `components` and `hooks`, in a `node` environment. `app/` screens aren't rendered in tests (the repo reads `spot.tsx` as source text, e.g. `spotRetake.test.ts`). `lib/__tests__/feedNudge.test.tsx` would never run | **Fixed.** Tests restated in three kinds: pure functions (`chooseForWait`, `chooseForResult` with `sightingId`/`localId`/screen inputs, a new `shouldShowWaitingCard`); components (`components/__tests__/WaitingCard.test.tsx`, `FeedNudge.test.tsx`, following the existing component tests); and source-order scans for placement in `spot.tsx`/`review.tsx`, **labelled as the weak kind**, backed by the browser-pane check. Mutation probes rewritten to match |
| 4 | Major | A spec rule was dropped: "a claim made in this session also sets it on the phone straight away" (`feeding-nudge.md` §3.2, §9). Signals were fetched only at app start, so a null `firstSpotDate` or stale claim flag lived until restart; `firstSpotDate: null` had no defined meaning | **Fixed.** A successful claim sets `hasClaimedCat` locally at once. Signals are re-fetched on start, on returning to the foreground, on reconnect, after a claim and after an identity change. `firstSpotDate: null` with signals loaded means "no spots yet": a visitor (first spot is today). Each has a test |
| 5 | Major | An app opened with no signal has never loaded settings, so every wait shows the uncounted no-link nudge and all facts show, including unapproved sign-off facts | **Fixed, and one part made a decision.** Settings are re-fetched on reconnect and on foreground, so the gap closes at the first signal. Hiding sign-off facts until settings load would change the spec's default, so it's **Decision 4** (recommended: hide them) |
| 6 | Major | Migration and collision facts stale: #181 merged; 0025 is on `main`; new open PRs #183, #184, #185 | **Fixed.** Rebased on `origin/main` `8899205`. Header, collision table and migration note updated: the next free number on `main` is 0026 today, still taken only after rebasing and agreeing with live sessions. #183 and #185 added to the collision table (#184 is the dashboard layout work) |
| 7 | Major | Queries under-specified. `hasClaimedCat` should also match `authority_scope = 'owner_of_this_cat'` (as `newestActiveOwnerHomed` does). A let-go leaves the original `homed` row with its device id, so "ever claimed" works, but the plan should say so and test it. `firstSpotDate` inner-joins photos, which have no foreign key and may be deleted: use a LEFT JOIN with `COALESCE(photos.created_at, sightings.created_at)`. `bind:false` on a never-bound phone answers **403** "Device secret does not match", not `{false, null}`; the app must read a plain 403 as "unknown" and only `device_moved` as moved | **Fixed** as described. Queued offline sightings take their arrival date (the sync time); now documented. The 403 case is a named test on both sides |
| 8 | Major | The result-screen lifecycle contradicted itself (decided "once at mount, then `pendingResult` cleared" vs "back arrow shows it again"). Unspecified: unreadable record, where "countable" lives, settings loading between wait and result | **Fixed.** Visibility is `review.tsx` component state (naming, the picker and the reward screen are state toggles in one component, so the back arrow returns to the same state). A remount or web refresh doesn't show it again, and that's intended. `pendingResult` now carries `{ sightingId, nudge: 'full' \| 'noLink' \| null, countable }`, decided at the wait, so the result screen shows the same form the wait did. An unreadable record writes no `pendingResult`, so nothing shows |
| 9 | Minor/Major | Clearing `waiting` when `send` returns flashes the map back during `savePendingPhoto` and `recordRecentPhoto` before navigation. Time in the background counted towards the 3-second rule | **Fixed.** `waiting` clears in the existing `finally`; the outcome is still taken from when `send` returned. On-screen time counts only while the app is active |
| 10 | Minor | Stale in-memory state after "Delete my data": the old identity's signals stay until re-fetched, so the new identity reads as a resident | **Fixed.** Settings, signals and the card record are keyed by device id in memory and reset when it changes. Test beside `deleteMyData`. A restore onto a new phone shows the full nudge again; stated as accepted |
| 11 | Minor | `API_BASE` doesn't exist: use `apiOrigin()` (`lib/urls.ts`); `noStrayApiCallers.test.ts` polices this. The redirect needs `Cache-Control: no-store` and ideally `Referrer-Policy`. `logRouteDuration` is typed for cat routes only, and pino-http already logs `responseTime`, so the timing line was redundant | **Fixed.** `apiOrigin()`; `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on the redirect; the timing line dropped (Decision 2 C now reads the existing log line) |
| 12 | Minor | The policy sentence "we don't record … their phone" is true of our own code (no IP in the redirect's log line, no limiter), but Replit and edge access logs are unchecked. The per-day table is richer than the "bare count" Samuel approved and should get his explicit nod. Neon cold starts past the 500 ms cap silently under-count | **Fixed.** The sentence is scoped to "Cat Spotters doesn't keep…", with platform logs marked unchecked. Per day vs one total is now **Decision 5**. The under-count on a cold start is stated as accepted |
| 13 | Minor | Decisions: jargon ("Replit", "republish", "SYC-96", p50/p90, file paths); "about 10 minutes" unsourced; Claude's ability to set Replit settings unchecked; the risk that a late yes from Syros Cats can't go live before the Thu 29 final publish not stated. Decision 2 omitted that M0 runs on a Mac, not the live server, that a p90 from 10 samples is the second-highest value, that the matching key is unchecked locally, and that a Neon branch needs "ask" mode. Small calls 3, 5 and 6 change what partial answers do or what is counted, so they're Samuel's | **Fixed.** Decisions 1 and 2 rewritten in plain English with those risks. "About 10 minutes" removed; "can Claude change these settings itself" labelled **unchecked**. Two small calls became **Decision 5** (counting per day) and **Decision 6** (one switch for button and figures). The old-phone fallback stays a small call (it only affects a phone with out-of-date settings) |
| 14 | Minor | Schedule: PR 1 is large and the slack thin, so name what drops first. The "Config, Thu 22 evening" row read as an extra publish. PR 1 ships unused code (signals, `pendingResult`, the nudge behind a flag). The new "publish slot for Johnny" ticket duplicates the launch plan's Wed 28 slot | **Fixed.** What drops first is named: the daily one-liner moves to the first week of November, then the nudge's result-screen buttons (the words-only form ships). Settings are set before the Fri 23 publish, not as a publish of their own. The unused code is listed. The duplicate ticket is dropped in favour of the launch plan's Wed 28 slot |
| 15 | Nit/Minor | Reshuffle with one or zero visible facts; a stored order when fact ids are added, removed or hidden; `_layout.tsx` provider wiring; reuse `GREEK_TIME_ZONE`; line refs slightly off (LocationPicker 1017-1020, optimise 513-520) | **Fixed.** With one visible fact it repeats; with none the card shows the eyebrow only. A stored order drops unknown ids and appends new ones in random places. Provider added to `_layout.tsx`. `athensDay` reuses the existing zone constant. Line refs corrected |
| 16 | — | Appendix B Greek and French are fine; no canonical-fact violations (€50–60, "cat guardian", "spotter") | No change needed |
| 17 | Minor | Feeding-nudge tests 15 and 19 not listed explicitly in the PR 2 table; starter-facts test 13's "layout test" can't be written | **Fixed.** PR 2 now lists every one of the 19 tests by number. Facts test 13 is a source-order scan (weak) plus the browser-pane check |

## Not taken up

None. Every finding was folded in, or turned into a decision for Samuel (findings 1, 5, 12 and 13 became Decisions 3, 4, 5 and 6).

## After Samuel's decisions (15 October 2026)

Samuel answered the plan's six decisions through question prompts. Each is recorded on SYC-36 with his exact selection. Two findings above read differently in the light of those answers:
- **Finding 5:** Decision 4 was answered "Keep the spec: nothing hidden". A phone first opened with no signal can still show an unconfirmed fact. He accepted that risk.
- **Finding 13:** Decision 1 was answered "Dashboard page for Syros Cats", then "Page after launch". Decision 6 was answered "show both and I'll confirm with them", which the plan reads as "on at launch".

## Second review, on the final text (before merge)

**Reviewer:** an independent Sonnet agent, read-only, on commit `da195e8b` against `origin/main` `691042ea`.

**Verdict, condensed:** no blockers. It confirmed:
- findings 1–17 above are fixed in the text;
- the decisions are built in consistently, except the places listed below;
- seeding a value in a migration is tolerated, because `migrate:check` compares the schema, not data, and 0006 and 0011 already insert rows.

| # | Severity | Finding (condensed) | What happened |
|---|---|---|---|
| R2-1 | Major | "In plain English" still said the nudge ships without figures or a button if Syros Cats haven't answered by 22 Oct, which contradicts Decision 6 | **Fixed:** now says on at launch, and off only on a no |
| R2-2 | Major | The Decision 6 override of the spec's default was flagged only at §1 and §7. It sits in §1, §5.2, §7, §8 and §10, with no row in the disagreement table. Small call 3 adds a server default the spec lacks | **Fixed:** new row C13, saying the plan wins where it differs. Dated amendment notes added in this PR to `feeding-nudge.md` (top, §5.2, §7) and `starter-facts.md` §9 |
| R2-3 | Major | Production migrations run through `db-ops` **before** the publish, not after. CI test databases will carry the seeded link | **Fixed:** the ship table now says `db-ops migrate` runs before the publish. The seed SQL (`ON CONFLICT DO NOTHING`), the rollback, and "tests delete the seed first" are written in |
| R2-4 | Major | "Claude edits with one SQL statement" had no documented production path, and was easy to get wrong with jsonb | **Fixed:** a new allowlisted `db-ops set-setting` command that checks key and value shape and upserts, plus a runbook step. A wrongly shaped value reads as missing, never an error |
| R2-5 | Major | "Reaches phones within about a minute" doesn't hold when the response is cached for 5 minutes and phones re-fetch only on start, foreground or reconnect | **Fixed:** cache cut to 60 seconds; the wording says when a phone actually picks a change up; a cache reset is added for tests |
| R2-6 | Minor | `GREEK_TIME_ZONE` isn't exported | **Fixed:** uses `CAMPAIGN_TIMEZONE` |
| R2-7 | Minor | Stale `i18n.ts` line numbers | **Fixed** (:1025, :1583; :815, :1372) |
| R2-8 | Minor | Stale base commit and PR states (#178, #180 and #184 merged; #188 holds 0026) | **Fixed:** rebased on `691042ea`; header, collision table and migration number (0027 or higher) refreshed |
| R2-9 | Minor | `none` vs an empty list for "show all facts" | **Fixed:** an empty list everywhere |
| R2-10 | Minor | Signals failures also include 400, 401 and 429 | **Fixed:** "any answer but 200 means unknown", with 401 and 429 tests |
| R2-11 | Minor | This file didn't record Samuel's answers | **Fixed:** the section above |
| R2-12 | Nit | The status line said Decision 6 went "differently" | **Fixed:** "as recommended in shape, but on at launch" |
| R2-13 | Nit | "Recommendation: A" sat under a chosen B (Decisions 1 and 4) | **Fixed:** marked "not chosen" |
| R2-14 | Nit | The Decision 6 box didn't state the accepted risk | **Fixed:** figures and button go live before Syros Cats answer; Google Play's point is still unchecked; the switch is the safety net |
| R2-15 | Nit | The gate match should be exact and raw, like the health check | **Fixed:** with tests for `/api/go/feed/` and `/API/GO/FEED` |
| R2-16 | Nit | String counts in Model delegation | **Fixed** |
