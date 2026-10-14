# SYC-170 PR 1.1 (#151): adversarial review

Reviewer: Opus, own worktree (`agent-abf85a7ab81eb625b`, branch `claude/syc-170-pr-1-1-review` off `origin/claude/syc-170-pr-1-1` at `2207e53`). 14 Oct 2026.
Read: plan `syc-44-report-an-issue.md` Slice 1 / PR 1.1, small calls, Review outcome rows 2, 15, 16; spec `report-an-issue.md` §9.2, §9.5; PR body; the whole diff.
Local runs (local Postgres only): the PR's 4 Turnstile suites 90/90; reports, team.queue, mail, internalMail and welfare suites 214/214; 19 throwaway probe tests (not committed, listed below).

**Mission: get a row into the welfare queue, or an email out, without a valid token, other than through a genuine Cloudflare outage.** I didn't find a way to do it with a missing, malformed, replayed or wrong-form token, or through the resend path. The one way in that's left: the PR counts Cloudflare's `internal-error` code as "unreachable", **even when it comes with a code that's the sender's fault** (finding 2). Whether a sender can make Cloudflare return that code is unknown, so this one is a design call rather than a proven hole. The other findings are about getting through review and merge, and about how emails reach the team during an outage.

## Findings

| # | Finding | Severity | Status, where |
|---|---|---|---|
| 1 | Migration number clashes with `main`: `main` already has `0018_cat_home_pin` (#142), and #150 also uses 0018 | Blocker (mechanical) | CONFIRMED, `lib/db/migrations/0018_report_token_checked.sql`, `meta/_journal.json` idx 18, `meta/0018_snapshot.json` |
| 2 | `internal-error` counts as unreachable, so the report is accepted unchecked, even alongside `invalid-input-response` | Major | CONFIRMED behaviour (probe: 201, `token_checked=false`, for `["invalid-input-response","internal-error"]`); PLAUSIBLE that a sender can trigger it. `artifacts/api-server/src/lib/turnstile.ts:53`, `:143` |
| 3 | Unchecked reports past the hour's 10 that arrive after the "waiting" email was queued get no email at all, ever, unless another one overflows more than an hour later | Major | CONFIRMED (probe: 2 more overflow reports 20 minutes in → 0 new emails, still 0 an hour on). `artifacts/api-server/src/lib/mail/outbox.ts:158` |
| 4 | In production `/_challenge` serves Cloudflare's always-passes TEST sitekey instead of answering 503: the website's production run never sets `NODE_ENV` | Minor | CONFIRMED. `artifacts/cat-spotter/server/challenge-page.js:35`; `artifacts/cat-spotter/.replit-artifact/artifact.toml:21-22`; `server/prelaunch.js:26` says so too |
| 5 | Nothing caps the total number of unchecked rows across all addresses; an "unreachable" that's actually caused by load (or by a Cloudflare `429`) has no global fence | Minor | PLAUSIBLE. `artifacts/api-server/src/routes/reports.ts:146-154` |
| 6 | The unchecked list has no limit: every open unchecked row is loaded and drawn on the page | Minor | CONFIRMED. `artifacts/api-server/src/lib/welfareQueue.ts:329-331` |
| 7 | Queue-page wording "Every report above passed the safety check" is wrong for `null` rows (sent before Turnstile, or in `off`/`observe`) | Minor | CONFIRMED. `artifacts/api-server/src/lib/teamPages/queuePage.ts:257` |
| 8 | A "waiting" email that fails for good never shows the mail banner (`mailHealth().failed` needs a report row, and this email has none) | Minor | CONFIRMED. `artifacts/api-server/src/lib/welfareQueue.ts:201-209` |
| 9 | Photo follow-ups for the 10 capped unchecked alerts don't count toward the cap (so up to 20 unchecked emails an hour, not 10) | Minor | CONFIRMED. `artifacts/api-server/src/routes/reports.ts:418` (`enqueueWelfareAlert(... "photo")` has no `unchecked` flag; the count at `outbox.ts:141-145` looks only at `kind='alert'`) |
| 10 | Forward note for SYC-105 PR 2.1: when the unchecked limit moves to Postgres, a counter error must refuse (503), not let the report through. Review row 16's fail-open rule is for the ordinary report limit, not for this fence | Minor | PLAUSIBLE (future). `artifacts/api-server/src/lib/uncheckedLimit.ts:49` |

### 1. Migration number (Blocker, mechanical)

**What.** The PR body says the migration was renumbered to 0018 after SYC-209 took 0017. Since then `main` has also gained `0018_cat_home_pin` (#142, `5c2ebb1`), and the branch is 3 commits behind. PR #150 (`0018_rate_limit_counters`) clashes in the same way.
**Why.** `_journal.json` will conflict, the snapshot chain is wrong (this PR's `0018_snapshot.json` doesn't include `cat_home_pin`), and `migrate:check` / the runner will refuse it.
**Fix.** Rebase on `main`. Delete `0018_report_token_checked.sql`, `meta/0018_snapshot.json` and the journal entry, then run `generate --name report_token_checked` again, which gives `0019_report_token_checked` with a fresh `when`. Keep the rollback block. Whichever of #151 and #150 merges second does the same again and becomes `0020_…` (the README says the runner refuses a migration older than one already merged, rather than skipping it, so regenerating is required, not just renaming). Correct the PR body's "0018" and the "0017" in commit `79834d9`'s message in the squash text.

### 2. `internal-error` becomes "unchecked" (Major)

**What.** `CLOUDFLARE_ERRORS = {"internal-error"}` (`turnstile.ts:53`). `callSiteverify` returns `no_answer` whenever `success !== true` and **any** code is `internal-error` (`:143`), so the request is retried and then accepted unchecked. A probe with `error-codes: ["invalid-input-response", "internal-error"]` got `201` and `token_checked=false`. The sender's own fault, the invalid token, was outweighed by the other code.
**Why.** Spec §9.5 defines "unreachable" as a timeout or a 5xx, things only our server can see. `internal-error` is an answer Cloudflare gave about a token the sender chose. Cloudflare doesn't document what makes it happen, so we can't rule out that a carefully made-up token causes it. If one does, a script gets 3 unchecked reports an hour from every address (`/56` for IPv6), plus individual emails up to the cap, which is exactly what §9.5 was written to stop. And it would fail silently: the app treats it as sent. The two kinds of mistake don't cost the same. Treating a real Cloudflare internal error as `rejected` costs a retry, and the phone keeps the report. Treating a sender-made one as `unreachable` lets the script in. In a real Cloudflare incident the phone usually can't get a token at all, so its send carries no token and gets `428` anyway. Counting `internal-error` as unreachable therefore helps real people very little.
**Fix.** Remove `internal-error` from `CLOUDFLARE_ERRORS` (count it as `rejected`, so 428), or at the very least count it as unreachable only when it's the **only** code. Add a T1-1 case for `["internal-error"]` and for the mixed codes. This undoes departure 2 in the PR body, so it's for Samuel to decide. My recommendation is to treat it as rejected.

### 3. Overflow reports after the "waiting" email get no email (Major)

**What.** `enqueueUncheckedWelfareAlert` returns `"none"` whenever a waiting row was **created** in the last hour (`outbox.ts:158`), even if that row has already been sent. The waiting email's count is fixed when it's first tried, 15 minutes after the first overflow report. So in a long outage, overflow reports from minute ~15 to minute 60 aren't counted in that email, and no later email is queued unless another overflow report arrives after the hour is up. Probe: 11 reports (10 alerts plus 1 waiting email sent), then 2 more 20 minutes later → still 11 emails; an hour later with nothing new → still 11.
**Why.** The small call says the "waiting" email exists so that "an outage never silences a real hurt-cat report entirely". These reports sit in the dashboard's unchecked list, but nobody is told about them.
**Fix.** When a waiting row exists in the hour but is already `sent` (or its count is already fixed), queue the next waiting email with `next_attempt_at = <that row's created_at> + 1 hour`, unless one is already queued for the future. Keep the "one per hour" cap by checking for any waiting row that's still queued. Add a test: overflow, drain, a later overflow inside the hour, then step the clock past the hour and expect a second waiting email that counts the later reports.

### 4. `/_challenge` serves the test sitekey in production (Minor)

**What.** `sitekeyFor` returns `TEST_SITEKEY` unless `NODE_ENV === 'production'` (`challenge-page.js:35`). The website's production service runs `node server/serve-web.js` with no `NODE_ENV` (`artifact.toml:21-22`; `prelaunch.js:26` relies on exactly this). So in production without `TURNSTILE_SITEKEY` the page doesn't answer 503 as the PR body says. It gives every phone a dummy token. The serve-web test hides this by setting `NODE_ENV: 'production'` explicitly (`serve-web.test.ts:697-702`).
**Why.** This fails closed, so nothing gets in: a dummy token fails siteverify with the real secret, so the send is `428`. But phones would sit in a silent `428` loop instead of the clear 503 the plan relies on, and nothing on health checks would show it.
**Fix.** Use the same rule as the gate: the test key only when `NODE_ENV` is exactly `development` or `test`, otherwise `null` (so 503). Change the test to use an env with no `NODE_ENV`.

### 5. No total cap on unchecked rows (Minor)

**What.** The only fence is per address (3 an hour for reports, 10 for drafts). Our server's own load decides "unreachable": if it's swamped, the 3-second timeouts fire. A Cloudflare `429` counts as unreachable too, and siteverify's rate limits aren't documented. Someone with many addresses who makes many siteverify calls may be able to turn their own junk tokens into unchecked rows. The 10/h `reportLimiter` and 60/h `draftLimiter` slow each address but don't stop this.
**Why.** This is within the spec's accepted risk (rows land in the fenced list, and emails are capped), so it's Minor. But the cost of the list grows with the number of addresses.
**Fix (cheap).** Add a total cap on unchecked rows across all addresses, for example 30 an hour. Past it, answer `503 turnstile_unavailable`, which the app already retries with no strike, so nothing is lost. Put it in the same `takeUncheckedAllowance` so 2.1 moves both together. Otherwise, record the accepted risk in the PR.

### 6. Unchecked list is unbounded (Minor)

**What.** `welfareQueue.ts:329-331` has no `.limit()`. The checked drafts have `DRAFT_LIMIT` and the closed list has `CLOSED_LIMIT`, but open unchecked reports don't. **Fix.** Add a limit and a separate count (the `<h2>` count then shows the total, not `reports.length`).

### 7. Wrong reassurance on the queue page (Minor)

**What.** `queuePage.ts:257` says "None. Every report above passed the safety check." Rows with `token_checked = null` (sent before Turnstile, or in `off`/`observe`, including an observe-mode `rejected`) are in the list above. **Fix.** "None. No report arrived while the safety check was unreachable."

### 8. A failed "waiting" email is invisible (Minor)

**What.** `mailHealth().failed` counts only failed rows whose report is open (`welfareQueue.ts:201-209`). The waiting row has `report_id = null`, so if it fails for good, no banner appears. `late` does catch it while it's queued. **Fix.** Add `or (report_id is null and payload->>'kind' = 'unchecked_waiting')` to the `failed` filter.

### 9. Photo follow-ups outside the cap (Minor)

**What.** The 10 unchecked reports that got alerts can each also get one photo follow-up (`reports.ts:418`). Those follow-ups are queued without `unchecked: true`, so the cap count doesn't see them. That's at most 20 unchecked emails an hour, not 10. There's one photo per report (`onConflictDoNothing` on `report_id`), so it's bounded. **Fix.** Either pass `unchecked: true` on the photo follow-up and count every `kind` in the cap, or write the 10→20 bound down in the code comment.

### 10. When the limit moves to Postgres (2.1), it must fail closed (Minor, forward)

Review row 16 says "Welfare reports go through on a counter error". That's right for the ordinary per-address report limit. It's wrong for the unchecked fence: if the counter errors, an unchecked report should get `503` (retried with no strike), never be accepted without limit. Whichever of 1.1 and 2.1 merges second should carry this over, with a test.

## Departures in the PR body, judged

| Departure | Verdict |
|---|---|
| `/api/healthz` gives `turnstile: { mode, secret }` | Fine. It leaks nothing useful: `observe` is honoured only while the gate is on, and with the gate on an outsider can't reach `/api/reports` anyway |
| `internal-error` counted as unreachable | **Disagree**: finding 2 |
| Observe stores `true` / `false` / `null` | Fine. Unreachable rows in observe skip the limit, which is right, since observe refuses nothing and only runs while the gate is on |
| "Across both forms" means one form for now | Fine |
| A closed unchecked report sits with the closed ones, tagged | Fine |
| Waiting email after 15 minutes, count fixed at the first try | The fixed count is right (stable idempotency key). Together with the "one per hour by creation time" rule it causes finding 3 |
| The photo follow-up is suppressed for overflow reports | Right, and tested. See finding 9 for the 10 that did get alerts |
| `/_challenge` taken from the spike with `DENY` / `frame-ancestors 'none'` restored and no `postMessage` to a parent | Headers checked in code and tests. The production sitekey fallback is finding 4 |
| Migration regenerated as 0018 | Out of date again: finding 1 |

## Checked and found correct

- **Token type confusion:** an array, an object, a number, `null`, `true`, a space, a tab, a non-ASCII character, 2,049 characters: all `428`, with **no siteverify call** and nothing written (probe). A form-encoded body (`express.urlencoded` is on) with `turnstileToken[]=x` fails the body check (400), since `lat`/`lng` must be numbers.
- **Length and format checks before the fetch:** `turnstile.ts:166-168`, then the fetch at `:173`. The secret check comes first, so a missing secret is 503 even with no token. That's correct: it's our fault.
- **Hostname compared exactly:** `APPTEST.catspotters.com`, `apptest.catspotters.com.`, `…:443`, a leading space, `evil-apptest.catspotters.com`, `catspotters.com`: all `428` (probe). The list is lower-cased and the reply isn't, so the comparison is strict, which is the safe way round.
- **Action and cdata compared exactly:** upper case, a trailing space, `null`, `success: "true"` and `success: 1` are all `428` (probe).
- **`idempotency_key`:** the same on the retry and a new one per check; no `remoteip` sent (probe: `[k1, k1, k2]`).
- **Timeouts can't stack:** a siteverify that never answers costs 6,075 ms end to end (probe). `AbortSignal.timeout` covers reading the body too, and there's only ever one retry. Only one `verifyTurnstile` call per request.
- **Resend and duplicate paths:** a sent report's resend with no token gets 200 (T1-4). A draft that exists still needs a token for submit (T1-4, and my probe with a checked draft: 428, and the draft stays a draft). The same `clientRef` from another device needs its own token (probe: 428). A draft token can't submit (the action differs), and a token can't move to another report (cdata = clientRef). A replay is `timeout-or-duplicate`, so `rejected`. The upsert's `setWhere is_draft = true` means a sent row is never rewritten. No other code path inserts into `welfare_reports` or turns a draft into a sent report (grep: only `routes/reports.ts`; `welfareActions`/`welfareTie` update sent rows behind team sign-in).
- **Mode in production:** `turnstileMode()` treats anything but exactly `development`/`test` as production (including no `NODE_ENV`), and honours `off`/`observe` only while `gateEnabled()`, the same function the API gate uses, so the two can't disagree. Unknown values become `enforce`. T1-7 covers turning the gate off.
- **Photo PUT:** tied to the device and to a sent report; it writes no report row; one photo per report; a follow-up only when the report had its own alert.
- **Healthz:** only `mode` and `configured`/`not_configured`; never the secret, the hostname list or the token.
- **Logs:** the diff's only new log calls are the three in `logVerdict` (`turnstile.ts:252-254`) and the start-up lines. Their fields are the outcome, the mode, the action, Cloudflare's hostname, three booleans and Cloudflare's codes (at most 10). Network errors log only the error's `name`. T1-6 checks every outcome with the production redaction settings.
- **The alert cap's race between two processes:** `pg_advisory_xact_lock` is held for the whole database, and the count statement runs after the lock is taken under READ COMMITTED (no other isolation level is set anywhere). So a second process sees the first one's committed insert. `markSent` spreads the payload, so `unchecked: true` survives in the count.
- **`welfare_alert` "waiting" rows and `overdueWelfareAlerts`:** the waiting row is handled before the `report_id === null → report_gone` branch. `overdueWelfareAlerts` counts it only while it's still queued an hour after creation, which is correct (due after 15 minutes). The keep-safe sweep never deletes `welfare_alert` rows, so the hour's count is stable.
- **Queue page:** the unchecked section comes after the open, drafts and closed lists; newest first, never in the urgent-first order; drafts folded in a `<details>`; the count shows at zero; cards go through the existing `reportCard`/`draftCard` escaping; the wording is static. T1-8 checks the order.
- **The unchecked limit:** per address, with IPv6 grouped by `/56` via `ipKeyGenerator` (T1-3); separate `report`/`draft` buckets; `trust proxy 4` (a prepended `X-Forwarded-For` is ignored). It forgets its counts on restart, by design until 2.1, and a sender can't cause a restart.
- **Migration 0018 rollback:** additive and nullable; old code ignores the column, so "roll the app back first" is right, and the commented `DROP COLUMN` is correct (only the number needs to change: finding 1).
- **Mutation probes, re-run by hand and each restored with `git checkout`:**
  - removing the hostname comparison turns 5 tests red: T1-1 `team.` for report and draft, plus 3 unit tests;
  - token before the duplicate check on submit: T1-4 "resend … original 200" turns red;
  - token before the duplicate check on the draft route: T1-4 "late draft call … 204" turns red.

## Probes run (throwaway, not committed)

A copy of `reports.turnstile.test.ts`'s setup, plus 19 cases: the 9 token shapes, the form-encoded array, `internal-error` alone and with other codes, 6 hostname variants, 8 action/cdata/success variants, another device's `clientRef`, checked draft then submit with no token, the idempotency key, a siteverify that never answers (timing), and the waiting-email gap. Re-create from this list if needed.
