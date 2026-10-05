# SYC-211 checkpoint — failing tests for username claim fixes

Worktree: `.claude/worktrees/replit-changes-review-17e0fd`
Branch: `claude/syc-211-username-claim-fixes`

## Local test setup (vitest/esbuild/rollup workaround)

- `pnpm install --offline` from repo root fixed up missing `.bin` symlinks
  (vitest wasn't linked into `artifacts/cat-spotter/node_modules/.bin`).
- esbuild darwin-arm64 binary unpacked to the scratchpad and run via
  `ESBUILD_BINARY_PATH=.../scratchpad/package/bin/esbuild`.
- `@rollup/rollup-darwin-arm64@4.62.2` copied into
  `node_modules/.pnpm/rollup@4.62.2/node_modules/@rollup/` (wasn't present
  anywhere in the tree; downloaded via `npm pack` into the scratchpad then
  copied in — not committed, it's a node_modules path).
- Run tests from `artifacts/cat-spotter`:
  `ESBUILD_BINARY_PATH=<scratchpad>/package/bin/esbuild node_modules/.bin/vitest run <path>`

## Done

1. `artifacts/cat-spotter/lib/usernameClaimNetworkTimeout.test.ts` — F1's
   transport-timeout piece. Drives `claimUsername` with global `fetch`
   mocked to hang unless its AbortSignal fires. **Fails today** (hangs
   forever, no timeout in `custom-fetch.ts`). Commit 76075f2.
2. `artifacts/cat-spotter/components/__tests__/LanguageUsernameStep.test.tsx`
   — 7 tests. 5 fail today for the right reason (F1 Back disabled while
   pending/uncertain; F1 firm-409-retry leaves input read-only forever;
   F2 Continue stays disabled while availability is pending/erroring; F3
   onboarding opens as the wrong reconciled name; F5 double tap sends 2
   claim POSTs). 2 pass as guards (known-taken still disables Continue;
   a late availability answer after its own deadline still shows).
   Mock for `@/components/purropolis` Button renders a native
   `<button disabled>` (not react-native-web Text, which drops
   unrecognised `aria-*`/`data-*` props) so `.disabled` is directly
   queryable. Commit c472e46.

3. `artifacts/cat-spotter/components/__tests__/UsernameEditor.test.tsx` —
   4 tests, all fail today for the right reason (F1 Cancel disabled
   while pending/uncertain, F1 firm-409-retry leaves input read-only
   forever, F5 double tap sends 2 requests, F7 "Cat  Lover" -> server
   "Cat Lover" never accepted because the reconcile compare is a strict
   `toLowerCase()` only). Save/Cancel have no `accessibilityRole`, so
   queried by text + the Pressable's own `aria-disabled` attribute, not
   `getByRole('button')`. Commit 5dfacd2.
4. Regression check: `lib/usernameClaim.test.ts`,
   `components/__tests__/OnboardingFlow.test.tsx`,
   `components/__tests__/SafetyStep.test.tsx` — all still pass (18/18).
   Combined run of all 3 new files: 10 failed / 2 passed, consistent
   with the per-file counts — no cross-file interference.

## Implementation (fix pass, 5 Oct)

Done (commits on this branch, all pushed):

- 8fa2cd3 F1 transport timeout: `lib/api-client-react/src/custom-fetch.ts`
  aborts the username claim/read/availability routes after 30 s
  (`USERNAME_REQUEST_TIMEOUT_MS`), rejects with `RequestTimeoutError` (no
  status = unclear). Route-scoped plus a per-call `timeoutMs`; no global
  default, so uploads are unchanged. Abort is also raced, so a runtime that
  ignores the signal still settles.
- d441fbd F1/F2/F3/F5 onboarding + `lib/usernameNormalize.ts` (server
  normalisation mirror) + rewritten `lib/usernameClaim.ts` + shared
  `hooks/useUsernameClaim.ts`.
- 0085f25 F1/F5/F7 editor on the shared hook.
- a783f46, a164f49 extra tests (companion reconcile tests, claim unit tests).

Timers now: transport 30 s ends every request; CLAIM_WAIT_MS 8 s and
RECONCILE_WAIT_MS 4 s are UI waits only; the onboarding availability check
has no UI deadline (late answers kept). The editor keeps its 5 s
availability wait and availability gate (F2 was onboarding-only).

### Test status

- 11 of the 12 new tests pass. **Not passing, by design:**
  `LanguageUsernameStep.test.tsx > F3`. In its own scenario the
  follow-up read after the late network failure reports the server holds
  NameA, the name the spotter submitted. Approved behaviour 3 says to accept
  a reconciled name equal to the submitted one, so onboarding correctly
  opens as NameA (phone and server agree), and the test's
  `not.toHaveBeenCalledWith('NameA')` fails. A probe confirmed
  `setUsername('NameA')` happens at the late-failure step, before NameB is
  ever typed. No correct implementation passes it. Left unedited per the
  brief; needs Samuel's call. Suggested fix: make that test's late-failure
  read return `{ username: null }` (server didn't save NameA). That exact
  scenario is already pinned in `LanguageUsernameStep.reconcile.test.tsx`.
- Full app suite: 70 files, 682 tests, 1 failure (the above). CI typecheck
  (`typecheck:libs`, cat-spotter, api-server): all exit 0.

### Mutation check (each applied alone, run, reverted with git checkout)

Script: scratchpad `mutate.py`. The original F3 test fails in every run
(baseline) and is not counted.

| # | Mutation | Caught by |
|---|---|---|
| M0 | remove F5 ref guard | both F5 tests |
| M1 | remove transport timeout | NetworkTimeout test + 2 customFetch.timeout tests |
| M2 | default acceptor `() => true` | 2 reconcile component tests + 2 unit tests |
| M3 | drop latest-name guard | stale-late-success unit test |
| M4 | normaliser = `toLowerCase` only | editor F7, normalise tests, reconcile tests |
| M5 | firm rejection keeps lock | both F1 firm-rejection tests |
| M6 | Back disabled again | F1 Back test |
| M7 | Cancel disabled again | F1 Cancel test |
| M8 | Continue gated on `available` | F2 not-gated test |
| M9 | known-taken no longer disables | F2 guard test |
| M10 | late unclear failure skips read | 2 component + 2 unit tests |
| M11 | failed read unlocks | read-fails-stays-locked test |
| M12 | unlock with same-name request open | survived at first; killed by new test (a164f49) |
| M13 | 5xx treated as firm | notSaved/unknown unit test |
| M14 | recovery read overrides sent claim | survived at first; killed by new test (a164f49) |

All reverted; `git status` clean after the run.

## Next

- Samuel: decide on the contradicting F3 test (see above).
- Not done (out of scope / deferred): F4 auto re-check while uncertain;
  `usernameCheckFailed` copy still says "try another name" even though
  Continue now works; editor availability gate and 5 s wait (F2 not
  applied to the editor); F6 log redaction; P1.

## Hang hazard (read before running vitest again)

A test with NO fake timers and a mock dependency that never settles
(`() => new Promise(() => {})`) will hang the vitest process for real
wall-clock time until its default 5s test timeout — or longer if
something awaits the hung promise directly. Always wrap the run command
in `timeout 120 ...` and pass `--testTimeout=20000` to vitest so a
runaway test can't stall the session again.

## Notes / judgment calls

- Server-style normalisation (trim + collapse internal whitespace +
  case-insensitive, from `artifacts/api-server/src/lib/usernames.ts`) isn't
  implemented anywhere on the client today. Per the brief ("don't
  over-specify implementation details"), the F3/F7 tests assert the
  *outcome* (accepted/not accepted, which name `setUsername`/`onClaimed`
  is called with) rather than requiring a specific exported helper name.
