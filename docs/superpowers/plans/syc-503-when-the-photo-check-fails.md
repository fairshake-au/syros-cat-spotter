# SYC-503 build plan: when the photo check fails

**Spec:** [`docs/specs/when-the-photo-check-fails.md`](../../specs/when-the-photo-check-fails.md), approved by Samuel on 21 Oct 2026 with these choices: D1 A, D2 A (25 points as usual), D3 30 seconds, D4 as recommended.
**Branch:** `claude/inspiring-goldstine-b9108e`, from origin/main 7a2d83ff. **Delivers:** one draft PR.
**Coordination:** none needed. The SYC-502 chip (PR #257) confirmed on 21 Oct that it doesn't touch `app/review.tsx`, so the two can merge in either order. No migration here (SYC-396 PR 3.3a holds 0035).

## Steps

Each step gets its own commit once its tests pass.

**1. Contract.** In `lib/api-spec/openapi.yaml`:
- Add `matchCheck` (`done` | `failed`) and `canRecheck` (boolean) to `CreateSightingResponse`. Its description says clients read `matchCheck` first.
- Add `POST /sightings/{sightingId}/recheck`, which takes `{ deviceId }` and returns `CreateSightingResponse`, with 403, 404, 409 and 429 responses.
- Run `pnpm --filter @workspace/api-spec run codegen` and commit the generated client and zod files.

**2. Time limit (server).** In `lib/matching.ts`:
- Pass `{ timeout: 30_000, maxRetries: 0 }` per request.
- Wrap the call in a single retry that fires only on `APIConnectionError` (not on `APIConnectionTimeoutError`) and on a 5xx `APIError`.
- Log the duration, and whether the call timed out.
- Unit tests mock the client: a timeout is not retried, a connection error is retried once, a 5xx is retried once, and a 4xx is not retried.

**3. Server answers (`routes/sightings.ts`).**
- `computeMatchCandidates` returns `matchCheck` and sets `canRecheck: true` when the check failed.
- The dedupe photo-gone branch returns `failed` with `canRecheck: false`.
- Both send paths include the new fields.
- Tests extend `sightings.upload.test.ts` and `sightings.dedupe.test.ts`, and use the real unreachable base URL (`http://127.0.0.1:9`) for at least one failure case.

**4. Recheck route.**
- Check order, matching resolve: 404, then 403 on a device mismatch, then `verifyDeviceSecret`, then 409 if the sighting is resolved, then 409 unless the stored record has `matcher_failed`.
- Then the per-address `aiLimiter` and `checkDeviceMatchLimit`, returning 429 with Retry-After.
- An in-process lock keyed by sighting id returns 409 to a second request while one is in flight. A single-instance lock is enough for one phone double-tapping; the database guard (`setWhere chosenAt is null`) still protects the record.
- With no photo bytes left, return `failed` / `canRecheck: false`, without calling the matcher and without counting against the limit.
- Otherwise reuse the photo-loading code from the dedupe branch (extracted into a helper, not copied), with the stored lat/lng.
- New `sightings.recheck.test.ts` covers every row of spec §7.

**5. App plumbing.**
- `lib/reviewParams.ts`: build, read, and the catch fallback all carry the two fields. A missing field reads as `done` / `false`.
- `lib/offlineQueue.ts`: add the fields to `PendingSighting`.
- `context/OfflineContext.tsx`: `markReview` stores them, the replace-photo reset clears them, and a new `updateReview(localId, result)` is added for a successful recheck.
- `components/ReviewReadyBanner.tsx` and `spot.tsx` (submit and `reviewPending`) pass them through.
- `lib/waitingCard.ts`: add a `couldntCheck` outcome, which isn't counted.
- `hooks/useResultNudge.ts`: a `couldntCheck` screen shows no nudge.
- `lib/recentPhotos.ts`: no change; the spec says a failed check stays reachable.
- Extend the existing unit tests for each file, including the existing test that every `/review` push goes through the builder.

**6. App screen (`app/review.tsx`).**
- The new "couldn't check" branch goes before "not a cat" and naming. It shows the spotter's photo, "Find this cat in the cat-alogue" (opens the picker), "Check again" (calls recheck; hidden when `canRecheck` is false), and "It's a new cat".
- Recheck states:
  - success: replace the screen data via `router.setParams(buildReviewParams(...))`, and call `updateReview` for a queued item
  - fails again: show the "Still couldn't check" line
  - 429: show the "few minutes" line
  - no signal: say so, as other choices already do
- Naming screen: show the "couldn't check" subtitle whenever the check failed, whichever door led there. The back chevron returns to the couldn't-check screen.
- The spotter's photo replaces 🐈‍⬛ on the naming screen (falls back to the emoji), whether or not the check failed.
- New copy in `lib/i18n.ts` in English, Greek and French. French uses "tu", as elsewhere.
- Component tests in the style of the existing `review` tests.

**7. Browser check.**
- Set up a scratch DB, the built API with the unreachable matcher, and Expo web on my own ports, seeded with made-up cats that have photos.
- Walk through at 390 px and desktop, in English and Greek:
  - a fresh send that fails
  - each of the three actions
  - "Check again" failing again
  - the naming screen's photo and subtitle
  - a queued spot that syncs into the failed state
- For "Check again" succeeding, the API is started a second time pointing at a stub matcher that answers.
- Screenshots go into the PR. Afterwards: stop servers by PID and drop the scratch DB.

**8. Review and PR.**
- An adversarial code review of the whole diff.
- Fold in the fixes.
- Re-run every affected test myself.
- Open a draft PR (`gh pr create --draft`).
- Update SYC-503 with the PR link.
- File the deferred tickets: a team view of new cats named after a failed check, as likely duplicates (SYC-59), and an alert when checks start failing.

## Every place the "failed" answer must survive

Each place below is covered by a test in step 3, 5 or 6. "Done" is the default if a copy drops the field, so each one is a silent failure:

1. the server's fresh-send response
2. the dedupe response, both the normal branch and the photo-gone branch
3. the recheck response
4. `buildReviewParams` (normal and catch fallback)
5. `parseReviewParams`
6. `PendingSighting` via `markReview`
7. `ReviewReadyBanner`
8. `spot.tsx` `reviewPending`
9. `spot.tsx` submit
10. the replace-photo reset (must clear it)
11. `updateReview` after a recheck
12. the review screen's branch order (failed before not-a-cat and before naming)
13. the naming subtitle, reached from every door
14. `waitingCard`
15. `useResultNudge`

## Model delegation

Active model: Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Steps 1–6 implementation | Opus (this session) | Chip rules: subagents can't write files here, and `review.tsx` needs care around the SYC-502 merge. Handing diffs back as text would cost more than writing them. | Tests per step; mutation probes (below); the step 8 review |
| Sweep to confirm the consumer list above is complete (read-only search for every reader of `isCatPhoto` / `candidates` / review route data) | Haiku | Mechanical search, structured answer | I check each hit against the list. Anything new gets added to the list with a test. |
| Greek and French copy check (read-only: tone, "tu", gender agreement, matches existing strings) | Sonnet | Language judgement, cheap | I review it. Native review stays with SYC-4 / SYC-346, as for all new strings. |
| Step 8 adversarial code review | Sonnet | Repeats the spec review's method on the diff; Samuel's default tier for review | I re-run every test it relies on. Disputed findings are written up in the PR. |
| Browser walkthrough and synthesis | Opus (this session) | Judgement on UX, and it needs the browser pane | Screenshots in the PR |

**Mutation probes (required: these are silent-failure guards).** For each item below, break the code deliberately, confirm the named test goes red, then restore it:

- (a) `computeMatchCandidates` reports `done` on failure
- (b) `buildReviewParams`' fallback drops `matchCheck`
- (c) `markReview` drops it
- (d) the review screen checks "naming" before "failed"
- (e) recheck lets a `matcher_failed = false` sighting through
- (f) a timeout is retried

The probes run on a committed tree only, and are restored with `git checkout` (memory: "Commit before probes").
