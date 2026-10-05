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

## Next

2. `artifacts/cat-spotter/components/__tests__/LanguageUsernameStep.test.tsx`
   — onboarding screen tests: F1 (Back always enabled, firm rejection
   unlocks immediately even with the hung original outstanding), F2
   (availability doesn't gate Continue, late answer not discarded, taken
   still disables — guard), F3 (normalized reconcile, never calls
   setUsername with the wrong name), F5 (double tap -> one request).
3. `artifacts/cat-spotter/components/__tests__/UsernameEditor.test.tsx` —
   same shape for the editor, plus F7 (whitespace-normalized reconcile:
   "Cat  Lover" submitted, server returns "Cat Lover", accepted).
4. Push branch: `git push -u origin claude/syc-211-username-claim-fixes`.
5. Write the final report for the caller (status of every test today,
   commit SHAs, anything not expressible as a test).

## Notes / judgment calls

- Server-style normalisation (trim + collapse internal whitespace +
  case-insensitive, from `artifacts/api-server/src/lib/usernames.ts`) isn't
  implemented anywhere on the client today. Per the brief ("don't
  over-specify implementation details"), the F3/F7 tests assert the
  *outcome* (accepted/not accepted, which name `setUsername`/`onClaimed`
  is called with) rather than requiring a specific exported helper name.
