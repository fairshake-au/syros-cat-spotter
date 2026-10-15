# SYC-170 PR 1.2 (PR #171): independent adversarial review

Reviewer: Sonnet, own worktree, branch `claude/syc-170-pr-1-2-review` at `a237ed5`.
Principle tested: the client must never be what stops a real cat-in-trouble report, and a refused check must never count as a strike.

Test run (app suite, `cd artifacts/cat-spotter && pnpm exec vitest run`):
`Test Files  102 passed (102)` / `Tests  1149 passed (1149)`. (Needed darwin rollup, lightningcss and esbuild binaries copied in, as briefed.)

## Findings

| # | Finding | Severity | Status / where |
|---|---------|----------|----------------|
| 1 | An unanswered tap on one report ends the whole sync pass, so every later report AND the photo upload of already-accepted reports are starved. The sheet re-pops about every 80 s. | Major | CONFIRMED `lib/reportQueue.ts:264` (`return`), repro below |
| 2 | In `enforce`, the 428 loop sends 2 POSTs per minute per waiting report (one pass per 60 s, each with an instant resend), even when the first send had no token. The report limiter is 10 per IP per hour, so one stuck report fills the IP's hourly allowance in about 5 minutes. After that every report from that connection, including ones with a good token, gets 429 "busy". | Major | CONFIRMED by reading `reportQueue.ts:231`, `ReportQueueContext.tsx:256`, `api-server/src/routes/reports.ts:66-72`, `lib/limits.ts:412` (every request is counted). Not reachable while production is `observe` |
| 3 | In `enforce`, any host with no key (ad-blocker, launch domain, EU `.replit.app` address, trailing-dot host) is stuck for ever with only "we'll try again". The report is never lost, but nothing can ever make it go. No readiness guard before the flip. | Major (gate for the enforce flip, not for merge) | PLAUSIBLE `lib/turnstileConfig.ts:62-70`, `lib/turnstile.web.ts:127`, `api-server/src/lib/turnstile.ts` default hostnames |
| 4 | The PR's first mutation probe no longer works. Removing `s !== 428` from `isPermanentRefusal` stays green (27 passed), because the later early 428 branch in `syncReports` catches 428 first. The two guards are redundant and each hides the other. | Minor (test/PR-body accuracy) | CONFIRMED `reportQueue.ts:158` and `:252` |
| 5 | A hung (neither loaded nor errored) Cloudflare script costs every send a full 20 s, because the pending `scriptLoad` is shared and never expires. On a weak island connection a cat report waits 20 s before it is even tried. | Minor | PLAUSIBLE `lib/turnstile.web.ts:47`, `CHALLENGE_TIMEOUT_MS` |
| 6 | No unit test of the real widget path: token callback, `before-interactive` showing the sheet, `after-interactive` hiding it, a draft meeting a tap resolving null, and cleanup. Only script failure, widget error and the unanswered tap are tested. The tap path was checked by hand in the browser only. | Minor | CONFIRMED `lib/__tests__/turnstile.scriptFailure.test.ts` (3 tests) |
| 7 | A widget error or `unsupported` event arriving after a tap was asked (and before the tap completes) counts as an "unanswered tap" and rejects, which feeds finding 1. | Minor | PLAUSIBLE `turnstile.web.ts:154-160` |

## Detail

### 1. Head-of-line blocking on an unanswered tap (Major)
What: in `syncReports`, a `ChallengeUnavailable` does `return` (line 264). The loop is oldest first, so report A with an unanswered tap stops B, C, and any `status: 'photo'` item whose text the server already accepted. Next pass (60 s later) A asks for a tap again, so the same thing repeats, and a person who is in another tab or has moved on gets a sheet every ~80 s.
Proof: scratch test (not committed): A queued with the check throwing `ChallengeUnavailable` for A's clientRef only, B queued and C in `photo` state, both able to succeed. After 5 passes: `submit calls 0 upload calls 0`. B (a possibly urgent, brand-new report) and C's photo were never tried.
Why it matters: the client, not the server, is what held B back, and the cause is another report's tap. The comment justifies it as "the rest would meet the same wait", but a tap is asked per widget, not per page, so B's own check may well pass without a tap.
Fix: `continue` instead of `return` for `ChallengeUnavailable`, but process every `photo` item and every `queued` item that has no tap pending first; or, simpler, order the pass photos first, then queued oldest first, and give a pass a total time budget (about 45 s) rather than ending it. Also remember a `tapDeclinedAt` on the item and skip it for a few minutes so the sheet does not re-pop every 80 s. Add a test shaped like the repro.

### 2. 428 retry amplification against the 10-per-hour IP limiter (Major, enforce only)
What: each pass sends the text, gets 428, gets a fresh token and sends again straight away (line 231). That is 2 POSTs per waiting report per minute. When the first token was `null` (no key, blocked script) the instant resend is pointless: it will 428 again. `reportLimiter` (10/hour/IP, fixed window, counts every request) is exhausted in about 5 minutes. From then on this IP, shared by everyone on the same ferry, hotel or mobile carrier address, gets 429 for the rest of the hour, so even a report with a perfectly good token is delayed up to an hour. No strike and nothing is lost, which is why it is Major and not Blocker, but "a refused check must not stop other real reports" fails.
Fix: resend instantly only if the first send carried a token. Add per-item back-off after consecutive 428s (1, 2, 5, 15 minutes, held in memory or as a `nextTryAt` on the item). Cap resends so one item cannot exceed ~4 POSTs per hour.

### 3. Enforce with an unmapped host never lets a report through (Major, a gate for the flip)
What: the client intentionally sends tokenless on an unmapped host, and `enforce` answers 428 for ever; the person sees "your report is still saved and we'll try again", which can never come true. Hosts in play: only `apptest.catspotters.com` is mapped; `TURNSTILE_HOSTNAMES` defaults to the same single host. A future launch domain, the EU Replit `.replit.app` address, `www.`, or a trailing-dot host all return null. An ad-blocker has the same effect on a mapped host.
Fix: before enabling `enforce`, add a checklist item and a test or startup check that the deployed host is in both lists. For the ad-blocker case, give the message an action (try another browser or call a vet from the list) so "we'll try again" is not the only line. Consider an enforce kill switch decision recorded on the ticket.

### 4. Stale mutation probe (Minor)
Removing only `&& s !== 428` from `isPermanentRefusal` now passes all 27 queue tests. Removing it AND the early `|| statusOf(err) === 428` makes three tests red (T1-9 `expected 'failed' to be 'queued'`, the unknown-host enforce test, the script-failure 428 test). Fix: correct the PR body's probe description, and drop one of the two guards or add a test that calls `isPermanentRefusal(428)` directly (export it).

### 5. Hung script (Minor)
Fix: put a load timeout (say 8 s) on `loadScript`, forget the promise on timeout, and return null early so a send is not delayed 20 s when the script is simply not arriving.

### 6. Missing widget-path unit test (Minor)
Add a fake `globalThis.turnstile` that captures the render params: assert `action` and `cData` are passed unmodified, `callback('tok')` resolves the token and removes the sheet, `before-interactive-callback` shows the sheet for a report and resolves null for `welfare_draft`, `after-interactive-callback` hides it, and two calls render two widgets (no token reuse).

### 7. Error after a tap was asked (Minor)
Treat `error` and `unsupported` as tokenless (resolve null) whatever `tapAsked` says; only the timeout while the sheet is visible should reject.

## Checked and found correct

- **Paths from tap to queue exit.** Send text then photo: the item leaves only after 200/201, or after the permanent-refusal rule (not 401/403/408/428/429, three strikes). A 428 (first, second, or tokenless) never reaches the strike code: confirmed by the live probe in finding 4. A 503 stays retryable (not in the permanent range). `ChallengeUnavailable` marks `checkUnavailable`, no strike, nothing dropped.
- **App closed mid-check:** nothing is mutated before success, so the item is still `queued` on reload. **Text accepted but status write lost:** resend with the same clientRef; the server's duplicate check (`reports.ts:269`) comes before the token gate, so it gets its original answer with no token needed.
- **Two tabs:** `ifLockFree(REPORT_UPLOAD_LOCK)` means one tab runs the pass; the other skips. The sheet is created by the tab that holds the lock (apart from drafts, which are best effort).
- **24-hour reminder:** `dueReminders` covers `queued` and `failed`, so a report stuck in `check` still gets its reminder.
- **Drafts versus submits:** draft sends tokenless when a tap would be needed (never interrupts), uses action `welfare_draft` and the same clientRef; a failure is swallowed as before. Report and draft use different actions, matching the server's per-action check. `clientRef` is `r-<hex>`, valid for Cloudflare's cData pattern.
- **Photo after text:** the photo PUT carries no token and the server route has none, so a token problem can never block a photo.
- **Token never persisted or reused:** the token is a local const inside `sendText`; `PendingReport` has no token field (`isPendingReport` checked, saved JSON asserted in T1-11); each `getTurnstileToken` renders a fresh widget and tears it down; the 428 resend calls it again. `ChallengeUnavailable` messages carry only a short reason, never the token. The sheet DOM is removed on every exit path (`cleanup`, `finally`).
- **Script and sitekey safety:** `SCRIPT_URL` is a constant; `action` is a typed union and `cdata` is the report's own clientRef; no page, URL or query parameter reaches the sitekey. `sitekeyForHost` uses the exact production host, exact dev hosts or the two Replit dev suffixes; the lookalikes (`apptest.catspotters.com.evil.example`, `evil-apptest...`, `localhost.evil.com`, `replit.dev.evil.com`) return null (test present, and passed in my run). The `cat-spotter/turnstile-test-key` override is consulted only inside the dev-host branch and must be one of exactly three published test keys: on `apptest.catspotters.com` it returns the production key whatever is stored (asserted in `turnstileConfig.test.ts`, passed). `/_challenge` falls back to the production key only, and a test keeps the two constants equal.
- **App CSP:** the website sets only `frame-ancestors 'none'` on app pages, so Cloudflare's script and frame are not blocked.
- **i18n:** `reportCheckUnavailable` and `turnstileTapLine` exist in en, el and fr (`i18n.ts` lines 515-516, 1065-1066, 1612-1613). French uses "tu" (`coche la case`, `Ton signalement`, `tu es`). `savedWording` rewrites only on web (`Platform.OS === 'web'`), in all three languages, including the shared welfare-guidance `confirmation.offline` copy ("saved on your phone" becomes "saved in this browser", `sur ton téléphone` becomes `dans ce navigateur`, `στο κινητό σου` becomes `σε αυτό το πρόγραμμα περιήγησης`), and for `reportBusy` and `reportFailed`. A grep found no other report-queue string on the web that still says phone (the remaining "phone" strings belong to sighting screens, outside this PR). The language for the sheet line is read from the same `cat-spotter/language` key that `LanguageContext` writes.
- **Native:** `lib/turnstile.ts` is `async () => null`; Metro picks `.web.ts` only on the web; `savedWording` is a no-op off web; the queue sends no token field when null. No other iOS or Android behaviour changes.
- **Server side:** only a comment changed in `api-server/src/lib/turnstile.ts`.
- **PR mutation probes:** probe 2 (unmapped host throws) goes red: `turnstile.unknownHost.test.ts` 1 failed, `promise rejected ... instead of resolving`. Probe 3 (no-tap failure rejects) goes red: `turnstile.scriptFailure.test.ts` 2 failed (script load failure, widget error with no tap). Probe 1 as written in the PR does NOT go red (finding 4); with both 428 guards removed it goes red (3 failures). Files restored; working tree clean before this document.
