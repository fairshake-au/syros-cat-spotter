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

## Next

3. `artifacts/cat-spotter/components/__tests__/UsernameEditor.test.tsx` —
   same shape for the editor (F1 Cancel always enabled + firm-rejection
   unlock, F5 double tap -> one request), plus F7 (whitespace-normalized
   reconcile: "Cat  Lover" submitted, server returns "Cat Lover",
   accepted as claimed). Note from the LanguageUsernameStep file: probe
   first with `/tmp` DOM dumps if a Pressable's disabled state isn't
   showing up as expected — UsernameEditor's Save/Cancel Pressables have
   no `accessibilityRole`, so they render as plain `<div>` with
   `aria-disabled`/`tabindex`, not a `<button>`; query by text + closest
   ancestor attribute, not `getByRole('button')`.
4. Push branch: `git push -u origin claude/syc-211-username-claim-fixes`.
5. Write the final report for the caller (status of every test today,
   commit SHAs, anything not expressible as a test).

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
