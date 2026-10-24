# Get Your Spots Back With a Code: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after every task, and write a one-line checkpoint to `docs/superpowers/plans/2026-10-24-syc-664-restore-with-a-code.progress.md` (what's done, what's next) in the same commit.**

**Goal:** A spotter using Cat Spotters from an iPhone home-screen icon gets their spots back by typing an 8-digit code from the restore email into the app.

**Architecture:** The restore email gains an 8-digit code stored as a keyed hash on the existing `mail_tokens` restore row. A new `POST /api/restore/code` checks the code atomically, bound to the asking phone, and swaps a right code for a 256-bit *handle* (a second hash on the same row). From there, the existing peek, redeem and 60-second replay run unchanged, with the handle in place of the link's token. The app's "Get your spots back" screen waits for the code, survives reloads via a 15-minute local flag, and reuses the link page's choose/warn/move states through a shared component.

**Tech Stack:** Express + Drizzle/Postgres (`artifacts/api-server`, `lib/db`), Expo Router / React Native web (`artifacts/cat-spotter`), vitest.

**Spec:** `docs/specs/restore-with-a-code.md` (approved by Samuel, 24 Oct 2026). Review: `docs/specs/reviews/restore-with-a-code-review.md`. Ticket SYC-664.

## Global Constraints

- Code: **exactly 8 digits**, `crypto.randomInt(0, 100_000_000)` zero-padded (Decision A).
- Code hash: `HMAC(fingerprint key, "restore_code:" + token_hash + ":" + code)`, via `fingerprint()` in `lib/mail/fingerprint.ts` (add a `"restore_code"` label).
- Five wrong tries per row (`code_attempts < 5`); at 5, the row's `expires_at = now()`, so the code and the link end together.
- Per-phone cap: shared-limiter bucket `keep_safe_code`, 10 per hour, keyed by device id, consumed **after** `verifyDeviceSecret`, failing closed.
- Live-link cap: 3 per **address per asking phone** (Decision B).
- Every code refusal: `401 {"error":"code_not_valid"}`. The cap: `429 {"error":"too_many_tries"}`. Every `/restore/code` answer is padded to one fixed deadline (800 ms, the same as `restorePadMs`).
- Email subject: `"{code} is your Cat Spotters code"` (Decision D). Body wording as in spec §1, including Decision C's "Only type this code in yourself, or give it to your own child for their phone. If anyone else asks you for this code, they're trying to take someone's spots. Don't give it to them." `askedAt` is formatted `HH:MM` in `Europe/Athens`.
- Waiting flag lifetime: 15 minutes from `askedAt` (`RESTORE_TOKEN_MINUTES`).
- Neither the raw code nor the raw handle ever reaches a log line or stays in the database after sending.
- App copy in en, el and fr (`lib/i18n.ts`). The email is English only (SYC-4). Words: "spotter", never "snapper".
- Open the PR as a draft (`gh pr create --draft`). Run the affected suites locally before pushing (`local-vitest-esbuild` workaround on the Mac).

## Review Focus

1. **Reload between Mail and the app on a phone that already has a spotter.** The flag must route a named phone to `/get-spots-back` on the code box, not to Home. Owned by Task 8.
2. **Pasted code with a space or a trailing newline** ("4829 1376\n" from Mail). It must be stripped to 8 digits, not refused. Owned by Task 7.
3. **A right code typed while an older email's code is also live on this phone.** Each live row is compared, so either code works and a wrong one counts against both. Owned by Task 3.
4. **The app killed after redeem commits, before `adoptRestoredIdentity` writes storage.** On the next open, the stored moving-handle retries through replay and the phone ends up as the restored spotter. Owned by Task 7.
5. **"Delete Nikos" through a code with the first response lost.** The 1.5 s retry must hit the replay by handle, or the phone wipes itself. Owned by Task 4.

---

### Task 1: Schema, code helpers

**Files:**
- Modify: `lib/db/src/schema/email.ts` (`mailTokensTable`)
- Create: `lib/db/migrations/0043_restore_codes.sql` (generated) + `meta/`
- Modify: `artifacts/api-server/src/lib/keepSafe/tokens.ts`, `artifacts/api-server/src/lib/mail/fingerprint.ts`
- Test: `artifacts/api-server/src/lib/keepSafe/tokens.test.ts` (create)

**Interfaces:**
- Produces: columns `code_hash text null`, `code_attempts integer not null default 0`, `handle_hash text null` with unique index `mail_tokens_handle_hash_idx` where `handle_hash is not null`.
- Produces: `newCode(): string` (8 digits), `codeHash(tokenHash: string, code: string): string`, `isCodeShaped(raw: unknown): raw is string` (`/^\d{8}$/`), `RESTORE_CODE_DIGITS = 8`, `RESTORE_CODE_TRIES = 5`.

- [ ] **Step 1:** Write tests: `newCode()` always matches `/^\d{8}$/` over 1,000 draws and includes a leading-zero case when `randomInt` is stubbed to 42 → `"00000042"`; `codeHash(a, c) !== codeHash(b, c)` for different token hashes; `isCodeShaped("4829 1376") === false` (the server takes digits only; the app strips spaces).
- [ ] **Step 2:** Run `pnpm --filter @workspace/api-server exec vitest run src/lib/keepSafe/tokens.test.ts`. Expect FAIL (not defined).
- [ ] **Step 3:** Add the label `"restore_code"` to `FingerprintLabel`. Implement the helpers. Add the columns and index to the schema. Run `pnpm --filter @workspace/db run generate --name restore_codes` and add the rollback block (`-- --` comments; see memory `rollback-block-comments`): drop the index, then the three columns.
- [ ] **Step 4:** Run the tokens test (PASS) and `pnpm --filter @workspace/db test -- runner` (rollback restores the schema). Run `migrate:check` with `DATABASE_URL` set.
- [ ] **Step 5:** Commit.

### Task 2: Request issues a code; email carries it; outbox clears it

**Files:**
- Modify: `artifacts/api-server/src/lib/keepSafe/service.ts` (`requestRestore`), `lib/mail/outbox.ts` (`KeepSafePayload`, `enqueueKeepSafeMail`, `processKeepSafe`, the give-up at ~498, the sent-settle at ~556, the expiry sweep at ~832–834), `lib/mail/keepSafeTemplates.ts` (`restoreLink`)
- Test: `lib/mail/keepSafeMail.test.ts`, `routes/keepSafe.takeover.test.ts` (or a new `routes/keepSafe.request.test.ts`)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `KeepSafePayload` gains `code?: string; askedAt?: string`. `enqueueKeepSafeMail(tx, { …, code?: string, askedAt?: string })`. `restoreLink` params `{ restoreUrl, code, askedAt }`, where `code` must match `/^\d{8}$/` and `askedAt` must match `/^\d{2}:\d{2}$/`, or it throws.

- [ ] **Step 1:** Write tests:
  - `restoreLink({restoreUrl, code:"48291376", askedAt:"14:32"})`: subject is `"48291376 is your Cat Spotters code"`, and text and html contain the code, "You asked for it at 14:32" and Decision C's sentence. A code of `"4829137"` or `"<b>"` throws.
  - A known-address request inserts a row with non-null `code_hash`, and the outbox payload holds `code`. After send, give-up and expiry sweep, the payload has no `code` key (assert `payload ? 'code'` is false for each of the three).
  - Decision B: four requests from phone A, then one from phone B, for the same address. B's row stays live, and only A's oldest is expired.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** In `requestRestore`, generate the code, store `codeHash(hashToken(token), code)`, compute `askedAt` with `Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Athens',hour:'2-digit',minute:'2-digit'})`, and add `and device_id = ${input.askingDeviceId}` to the oldest-expires subquery. In the outbox, carry `code`/`askedAt` and add `code` to all three clearings (the SQL sweep's `?` list too). In the template, implement the spec §1 wording.
- [ ] **Step 4:** Run both test files. PASS.
- [ ] **Step 5: Mutation probe.** Remove `code` from the expiry sweep's `?` list and confirm the sweep test goes red. Restore.
- [ ] **Step 6:** Commit.

### Task 3: `POST /api/restore/code`

**Files:**
- Create: `artifacts/api-server/src/lib/keepSafe/code.ts`
- Modify: `artifacts/api-server/src/routes/keepSafe.ts`
- Test: `artifacts/api-server/src/routes/keepSafe.code.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 (`codeHash`, `isCodeShaped`, `RESTORE_CODE_TRIES`), `newToken`, `hashToken`, `consume` from `lib/limits.ts`.
- Produces: `exchangeCode(input: { callerDeviceId: string; code: string }): Promise<{ ok: true; handle: string } | { ok: false }>`. Route: `POST /api/restore/code`, body `{deviceId, code}` plus the `x-device-secret` header, answering `200 {"handle": string}` | `401 {"error":"code_not_valid"}` | `429 {"error":"too_many_tries"}`, with every answer padded to 800 ms. Test hooks: `__setCodePadForTest(ms | null)`, `__setCodeCapForTest(n | null)` (both throw outside `NODE_ENV=test`, like `__setRestorePadForTest`).

- [ ] **Step 1:** Write tests (spec "Tests" list, server half):
  - `right code → handle`: the right code from the asking phone returns a 43-char handle, and `handle_hash` is set on the row.
  - `same code, other phone → code_not_valid`: the body is identical to a wrong code's.
  - `unknown vs known address`: seven wrong codes each give identical status and body, and durations within ±100 ms of each other (pad on, 800 ms).
  - `five wrong then right → refused`: the row's `expires_at <= now()`, and `/restore/peek` with the link's token answers `link_not_valid`.
  - `20 parallel wrong → code_attempts = 5`: with the per-phone cap raised for this test only (`__setCodeCapForTest(100)`), so only the row's own limit can stop them, fire 20 concurrent wrong codes from one phone. Assert `code_attempts === 5`, and that a spy on the comparison was called at most 5 times.
  - `cap`: the 11th code in an hour gives `too_many_tries`, for any address. A request with that phone's id and no secret gets 401 from device auth and doesn't consume its bucket.
  - `two live rows`: the right code for either row works, and one wrong code increments both.
  - `log redaction`: the captured pino lines contain neither the code nor the handle.
- [ ] **Step 2:** Run `…vitest run src/routes/keepSafe.code.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement `exchangeCode` in one transaction, in this order:
  1. the atomic `update … set code_attempts = code_attempts + 1 where purpose='restore' and device_id=$caller and used_at is null and expires_at > now() and code_attempts < 5 returning token_hash, code_hash, code_attempts`;
  2. compare `codeHash(row.token_hash, code)` with `crypto.timingSafeEqual`;
  3. on a match, `code_attempts = code_attempts - 1` and `handle_hash = hashToken(handle)` for that row;
  4. on no match, `expires_at = now()` where `code_attempts >= 5`.

  The route runs `verifyDeviceSecret`, then `consume('keep_safe_code', deviceId, 10, 3600_000)` (declare the bucket once at module load), then strips nothing (the app strips), then `isCodeShaped`, then `exchangeCode`, then pads. **Deviation from spec (minor, flagged):** a right code is not refunded to the per-phone bucket. It ends the flow, so at most one of the ten is spent on success.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5: Mutation probes.** (a) Drop `and code_attempts < 5` and confirm the parallel test goes red. (b) Make the no-rows branch return a different body and confirm the unknown/known test goes red. (c) Log the code once and confirm the redaction test goes red. Restore each.
- [ ] **Step 6:** Commit.

### Task 4: Peek, redeem and replay accept a handle

**Files:**
- Modify: `artifacts/api-server/src/lib/keepSafe/move.ts` (`readToken` line ~71, `replayAfterMove` ~171, the spend ~236, `replaced_secret_hash` ~264)
- Test: `artifacts/api-server/src/routes/keepSafe.code.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3 handles.
- Produces: a private helper `rowIs(raw: string)` → the SQL fragment `(token_hash = h or handle_hash = h)` with `h = hashToken(raw)`, used at all four sites. Routes are unchanged, because a handle is token-shaped (43 chars).

Every consumer of "find the restore row from what the client holds" is one of these four sites. `sever.ts:33–35` selects by device id, not by token, so it needs no change. Confirm with `git grep -n "token_hash" artifacts/api-server/src`.

- [ ] **Step 1:** Write tests:
  - `peek with handle`: `openedOnAskingPhone: true` and the same spotters as the link gives.
  - `redeem with handle moves the spots`, and the link's token then answers `link_not_valid` at peek.
  - `redeem with handle from another phone`: still allowed, because a handle is a link-equivalent secret held only by the asking phone (assert the behaviour, and document it in a code comment).
  - `Delete Nikos via handle, first response dropped`: `__setMoveHookForTest` makes the first redeem succeed but the client discards the reply. The retry after 1.5 s with the same handle is answered by `replayAfterMove`, and the phone ends up as the restored spotter (not 410).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Introduce `rowIs` and use it at the four sites. `choiceId(raw, …)` stays as is: it's derived from whichever secret the client holds, and stable for it.
- [ ] **Step 4:** Run this file and the whole keep-safe set: `…vitest run src/routes/keepSafe src/lib/mail/keepSafeMail.test.ts src/app.tokenLogRedaction.test.ts src/lib/resolve.restore.test.ts`. PASS.
- [ ] **Step 5: Mutation probe.** Revert `replayAfterMove` alone to `token_hash =` and confirm the Delete Nikos test goes red. Restore.
- [ ] **Step 6:** Commit.

### Task 5: App client and the waiting store

**Files:**
- Modify: `artifacts/cat-spotter/lib/keepSafe.ts`
- Create: `artifacts/cat-spotter/lib/restoreWaiting.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/restoreWaiting.test.ts` (create), `lib/__tests__/keepSafe.timeout.test.ts` (extend if the timeout wrapper applies)

**Interfaces:**
- Produces in `lib/keepSafe.ts`: `exchangeRestoreCode(deviceId: string, code: string): Promise<{ handle: string }>`, `isCodeNotValid(e: unknown): boolean`, `isTooManyTries(e: unknown): boolean`, `normaliseCode(input: string): string` (strips all whitespace).
- Produces in `lib/restoreWaiting.ts` (localStorage key `cat-spotter/restore-waiting`, JSON, every access wrapped in try/catch):
  - `type RestoreWaiting = { askedAt: number; requests: number; wrongTries: number; movingHandle?: string }`
  - `readWaiting(now?: number): RestoreWaiting | null` (null once `now - askedAt > 15 min`; clears the key then)
  - `noteRequest(now?: number): RestoreWaiting` (a new `askedAt`, `requests + 1` within the window, else 1; resets `wrongTries`)
  - `noteWrongTry(): RestoreWaiting`
  - `setMovingHandle(handle: string | null): void`
  - `clearWaiting(): void`

- [ ] **Step 1:** Write tests: the 15-minute expiry at 14:59 vs 15:01; `noteRequest` ×4 within 15 min → `requests === 4`; storage that throws on every call → the functions return null or defaults without throwing; `normaliseCode(" 4829 1376\n") === "48291376"`.
- [ ] **Step 2:** Run `pnpm --filter cat-spotter exec vitest run lib/__tests__/restoreWaiting.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 6: Extract the shared chooser from the link page

**Files:**
- Create: `artifacts/cat-spotter/components/keepSafe/RestoreChooser.tsx`
- Modify: `artifacts/cat-spotter/app/restore.tsx`
- Test: `components/__tests__/KeepSafe.test.tsx` (must pass **unchanged**)

**Interfaces:**
- Produces: `RestoreChooser({ secret, fromCode }: { secret: string; fromCode?: boolean })`. It owns peek, the `already-here` / `in-app` / `confirm-different` / `copied` / `choose` / `moving` / `not-valid` / `failed` states, SYC-266's keep/delete choice, `holdIdentityDeleted`, the retry after a lost answer, and the final `window.location.replace('/')`. With `fromCode`, the in-app-browser advice is skipped (the person is already in the app), and a handle's peek always says `openedOnAskingPhone: true`, so the code path never shows the link-only states.
- `app/restore.tsx` keeps only token taking (fragment, sessionStorage, `?t=`, history clearing) and renders `<RestoreChooser secret={token} />`.

- [ ] **Step 1:** Run `KeepSafe.test.tsx` now and record the pass count.
- [ ] **Step 2:** Move the code. No behaviour change.
- [ ] **Step 3:** Rerun. The same count passes, with no test edits. `pnpm --filter cat-spotter exec tsc --noEmit` is clean.
- [ ] **Step 4:** Commit.

### Task 7: The code screen

**Files:**
- Modify: `artifacts/cat-spotter/components/keepSafe/RestoreRequestScreen.tsx`, `lib/i18n.ts`
- Test: `components/__tests__/KeepSafe.test.tsx` (new `describe('code screen')`)

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: `RestoreRequestScreen({ onBack, intro, startOnCode? }: { …; startOnCode?: boolean })`. Its states are `address` → `code` → `chooser` (renders `<RestoreChooser secret={handle} />`). testIDs: `restore-code-input`, `restore-code-submit`, `restore-have-code`, `restore-code-refused`, `restore-code-dead`, `restore-too-many`, `restore-asked-thrice`.

Behaviour (spec §2–§4):
- "Email me a code" → `requestRestore`, then `noteRequest()`, then the code state. When `readWaiting()?.requests >= 3` before sending, show the `restoreAskedThrice` message instead of sending.
- "I already have a code" (`restore-have-code`) → the code state with no request.
- A single `TextInput`: `inputMode="numeric"`, `autoComplete="one-time-code"`, `textContentType="oneTimeCode"`, `maxLength={10}`. It auto-submits when `normaliseCode(value).length === 8`. Submit is disabled while a check is in flight, and an unchanged code is never re-sent.
- `code_not_valid` → `noteWrongTry()`. Below 5, show `restoreCodeRefused`; at 5, show `restoreCodeDead` with "Email me a new code" (back to the address state). `too_many_tries` → `restoreTooManyTries`.
- A right code → `setMovingHandle(handle)` → `<RestoreChooser secret={handle} fromCode />`. Clear the flag on success.
- **Resume:** when mounted with `readWaiting()?.movingHandle`, go straight to the chooser with that handle (Review Focus 4).

New strings (en, el, fr): `restoreAskBody` ("…and we'll email it a code."), `restoreAskSend` ("Email me a code"), `restoreCodeTitle` ("Check your email"), `restoreCodeBody` (spec §2 text), `restoreCodeSubmit` ("Get my spots back"), `restoreCodeResend`, `restoreHaveCode` ("I already have a code"), `restoreHaveCodeNote` ("Use the code from an email you asked for on this phone."), `restoreCodeRefused`, `restoreCodeDead`, `restoreCodeNewEmail`, `restoreTooManyTries`, `restoreAskedThrice`. Remove `restoreAskSent` (and its uses). Help & info has no restore wording that mentions a link (grep of `lib/i18n.ts`, 24 Oct), so nothing changes there.

- [ ] **Step 1:** Write tests:
  - the address → code flow;
  - "4829 1376" pasted auto-submits once with `"48291376"` (Review Focus 2);
  - the button is disabled in flight;
  - five refusals show `restore-code-dead`;
  - 429 shows `restore-too-many`;
  - the fourth request shows `restore-asked-thrice` and makes no fetch;
  - a right code shows the chooser button naming the spotter;
  - mounting with a stored `movingHandle` calls redeem through the chooser (Review Focus 4);
  - Greek and French render with no missing keys (the existing i18n completeness test, if present; otherwise assert the keys exist in all three).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `KeepSafe.test.tsx`, `KeepSafeRoute.test.tsx` and `OnboardingFlow.test.tsx`. PASS.
- [ ] **Step 5:** Commit.

### Task 8: Reopen on the code box after a reload; clear on identity change

**Files:**
- Modify: `components/onboarding/OnboardingFlow.tsx`, `app/_layout.tsx` (`OnboardingGate`), `app/get-spots-back.tsx`, `context/DeviceContext.tsx` (`startAgain` ~436, `adoptRestoredIdentity` ~458, `resetIdentity` ~478)
- Test: `components/__tests__/OnboardingFlow.test.tsx`, `components/__tests__/KeepSafeRoute.test.tsx`, `context/__tests__/DeviceContext.resetIdentity.test.tsx`

**Interfaces:**
- Consumes: `readWaiting`, `clearWaiting` (Task 5); `startOnCode` (Task 7).

Behaviour:
- `OnboardingFlow` starts at `'restore'` with `startOnCode` when `readWaiting()` is live at mount.
- `OnboardingGate`: a named phone with a live flag, on any path other than `/get-spots-back` and `/restore`, gets `router.replace('/get-spots-back')` once per app start.
- `get-spots-back.tsx` passes `startOnCode` when the flag is live.
- `clearWaiting()` in `startAgain`, `adoptRestoredIdentity` and `resetIdentity`.

- [ ] **Step 1:** Write tests:
  - a fresh phone with a live flag opens on `restore-code-input`;
  - an expired flag opens on Welcome;
  - a named phone with a live flag is sent to `/get-spots-back` on the code box (Review Focus 1);
  - each of the three identity changes clears the key.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three files and the DeviceContext set. PASS.
- [ ] **Step 5: Mutation probe.** Remove `clearWaiting()` from `resetIdentity` and confirm its test goes red. Restore.
- [ ] **Step 6:** Commit.

### Task 9: Link page and password page point icon users back to the app

**Files:**
- Modify: `components/keepSafe/RestoreChooser.tsx` (`confirm-different`, `in-app`, `copied` states), `lib/i18n.ts`, `server/prelaunch-page.js`
- Test: `components/__tests__/KeepSafe.test.tsx`; the prelaunch page test (`server/__tests__/` if present, else `lib/__tests__/customFetch.prelaunch.test.ts`'s neighbour; create `server/__tests__/prelaunchPage.test.ts` if none)

Behaviour:
- `confirm-different` gets a third button, `restoreUseIcon` ("I use the Cat Spotters icon on my home screen"). It switches to a state showing `restoreUseIconAdvice` ("Go back to Cat Spotters from your home screen and type the code from this email there."). Nothing is peeked again or moved.
- `restoreDifferentCopied`/`…You`, `restoreInAppWarning` and `restoreCopyFailed` gain "…or type the code from the email into Cat Spotters." (en, el, fr).
- `prelaunch-page.js`: when `location.pathname` matches `/restore`, add one line above the password box (`id="restore-code-hint"`): "Use Cat Spotters from an icon on your home screen? Go back to it and type the 8-digit code from the email." The page is rendered server-side, so key the line on the requested path in the render function.

- [ ] **Step 1:** Write tests: tapping `restoreUseIcon` shows the advice and makes no redeem call; the password page for `/restore` contains `restore-code-hint` and the page for `/` doesn't.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit.

### Task 10: Whole-branch check, browser round trip, draft PR

- [ ] **Step 1:** Run the full suites: `pnpm --filter @workspace/api-server test` (with CI's env vars and a local `DATABASE_URL`), `pnpm --filter cat-spotter test`, `pnpm --filter @workspace/db test`, and `tsc --noEmit` in both apps. Record the pass counts.
- [ ] **Step 2:** Run the browser round trip with the fake mail endpoint (`docs/runbooks` / memory `local-preview-with-planted-link`): from first-run, and again from Settings on a named spotter. Each time: email → read the code from the fake outbox → type it → spots back. Then reload mid-wait and check the code box returns. Screenshots at 390px and desktop.
- [ ] **Step 3:** Open the PR as a draft (`gh pr create --draft`), titled `SYC-664: get your spots back with a code`. The body lists the spec, the review, the decisions, the one flagged deviation (Task 3) and the real-iPhone check left for Samuel.
- [ ] **Step 4:** Run the adversarial review of the whole branch (see Model delegation), fold in the findings, then `gh pr ready`.

---

## Model delegation

Session model: Opus. Tasks run one at a time in this session's worktree (memory `chip-builds-in-session-worktree`). Each subagent's prompt restates: **commit after each task and update the progress file.**

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1: schema, migration, helpers | Sonnet | Clear spec, follows the migrations README | Session model reruns the tokens test, `db test` runner and `migrate:check` itself (memory `rerun-delegated-tests`); spot-reviews the rollback block |
| Task 2: request, outbox, template | Sonnet | Standard change across known sites; every clearing site is named | Tests rerun by session model; **mutation probe** on the sweep (Step 5), because a missed clearing is a silent failure |
| Task 3: `/restore/code` | **Opus** | Security-critical: atomic counting, the enumeration-proof single refusal, timing pad. The review's two blockers live here | Tests + three **mutation probes** (Step 5), run by the session model; the final adversarial review attacks this endpoint first |
| Task 4: handle in move.ts | **Opus** | Subtle: the replay is what stops "Delete Nikos" wiping a phone, and all four lookup sites must change together | Tests + **mutation probe** on the replay; `git grep token_hash` enumeration rechecked by session model |
| Task 5: client lib + waiting store | Sonnet | Small, well specified | Tests rerun by session model |
| Task 6: extract `RestoreChooser` | Sonnet | Behaviour-preserving move | Existing `KeepSafe.test.tsx` passes unchanged, with the same count; diff spot-review by session model |
| Task 7: code screen + strings | Sonnet | UI with exact behaviour and copy given | Tests rerun; session model checks the el/fr strings read naturally and match the en meaning |
| Task 8: reload re-entry | Sonnet | Three small, named edits | Tests + **mutation probe** on the clearing; browser reload check in Task 10 |
| Task 9: link page + password page | Haiku | Copy and one conditional line, fully specified | Tests rerun by session model |
| Task 10: suites, browser round trip, PR | Session (Opus) | Judgment on what the browser shows; owns the integration | Probe: the real round trip in the browser pane at both widths |
| Whole-branch adversarial review | **Opus**, fresh worktree of its own (LIF-79) | Security review of an account-recovery path; must refute, not confirm | Findings folded in before `gh pr ready` |

Consumers of the "a code or handle finds the row" invariant, enumerated (where else must this hold?): `readToken`, `replayAfterMove`, the redeem spend, the `replaced_secret_hash` write (all in `move.ts`). `sever.ts` selects by device id, so it's unaffected. Consumers of "the raw code is never at rest": the outbox payload's three clearings (give-up, sent, sweep) and every log call in `code.ts` and `routes/keepSafe.ts`.
