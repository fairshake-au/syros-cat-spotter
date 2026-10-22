# Adversarial review: SYC-44 PR 6.2 (Report an issue: sheet, saved list, confirmations)

Independent reviewer: Sonnet, in its own worktree, at `origin/claude/relaxed-sutherland-722f64` (`38386cf8`), 19 Oct 2026. Committed verbatim by the building session; how each finding was handled is in the PR description.

Checked out `origin/claude/relaxed-sutherland-722f64` at 38386cf8 (detached, own worktree). I ran the 8 named test files (152 pass), the whole app suite (146 files, 1929 tests, all pass), `typecheck:libs` and the app `typecheck` (both clean), and 10 mutation probes. Every probe was restored with `git checkout`, and the tree is clean. I did not do the browser check at 390px and desktop (unchecked). I did not check whether the native-review ticket was filed (unchecked).

**Verdict: needs changes before ready. No Blockers. Two Majors, both in the "a real report is lost or goes silent" class. The core promise holds: the confirmation comes from the server's `hidden`, and nothing says "hidden" before the server answers.**

## Findings

1. **Major, CONFIRMED. "Delete my data" can destroy an unsent issue report the person chose to send, or never asked about.**
   - Where: `context/DeleteMyDataContext.tsx` (the `wipeIssues()` call in `wipePhone`; the `sendReports` wrapper) and `app/delete-my-data.tsx:42`.
   - The send-or-delete choice is built only from `reportQueue.reports.length` (cat reports). Issue reports are never counted.
   - Scenario A: the person has only an unsent "photo shows my child" report, offline. They get no choice. The report is wiped silently, and "send them first" is never tried. The code comment "'Send them first' tried it already" is false here.
   - Scenario B: the person picks "Send, then delete" and the issue report cannot send. `sendAllNow().catch(() => false)` swallows it, the deletion goes ahead, and the report is wiped. For a cat report, "one won't send, nothing is deleted". Issue reports get weaker treatment.
   - Related: `sendAllNow` has no timeout. A Turnstile tap that is never answered holds up the delete flow.
   - Fix: count issue reports in the dialog's report count and choice. Make `sendReports` return false if either list still has items. Wipe issues only on `'delete'`. If the person says nothing, say plainly that unsent issue reports will be lost. Add a test for "only an issue report is pending".

2. **Major, CONFIRMED. If saving fails, nothing tells the person, and a ghost reminder is left behind.**
   - Where: `context/IssueQueueContext.tsx` `submitIssue` (the `scheduleNativeReminder` call comes before `store.mutate`), and `ReportIssueSheet.tsx` `send` (`try/finally`, no `catch`).
   - Saving a new report uses `mutate(..., 'user')`, which throws `QueueWriteError` when storage is full, blocked or read-only.
   - Result: the sheet shows no error, because `send` rethrows into `void send()`. Tapping Report and hide appears to do nothing. The native notification was already scheduled, so 24 hours later the phone says "You have a reported issue that hasn't sent yet" for a report that does not exist.
   - Fix: schedule the reminder only after the mutate succeeds, or cancel it in a `catch`. Catch the error in the sheet and show one honest line, such as "We couldn't save this. Please try again." Add a test.

3. **Minor, PLAUSIBLE. Modal stacking on iOS.**
   - Where: `app/cat/[id].tsx` hero `onReport`, and `SightingPhotos.tsx` `onReport`.
   - The viewer is closed and the sheet opened in the same state batch. The code comment says "one modal at a time", but React renders the old Modal's unmount and the new Modal's mount in one commit. iOS often refuses to present a modal while another is still dismissing, so the sheet may silently not appear. The jsdom tests mock `Modal`, so they cannot show this.
   - Fix: open the sheet after the viewer's dismiss finishes (a short delay or `onDismiss`), and check on a real iOS simulator.

4. **Minor, PLAUSIBLE. `?report=wrong_info` is only read on the first mount.**
   - Where: `app/cat/[id].tsx`, the `useState` initialiser.
   - "Think this cat is alive?" is a link on the cat's own page. If it uses `setParams`, or the same screen instance is reused, the sheet never opens.
   - Fix: add a `useEffect` on `params.report`. Add a test that re-renders with the param set later.

5. **Minor, CONFIRMED. `other` from a photo loses which photo it was about.**
   - Where: `lib/issueQueue.ts`, `newPendingIssue` and `PHOTO_ID_REASONS`.
   - The server refuses a photo id with `other` (a 400), so the client correctly drops it. But the sheet still shows the photo thumbnail and the title "Report an issue with this photo". The team then gets a cat-level `other` with no photo.
   - Fix: either do not offer `other` under a photo, or tell the person the note should say which picture, or ask for a server change. Record the decision.

6. **Minor, PLAUSIBLE. The send loop uses a stale snapshot.**
   - Where: `lib/issueQueue.ts` `syncIssues`, `for (const item of [...store.items()])`.
   - The loop does not re-check that the item is still in the store. If `wipeIssues()` (Delete my data) or another tab removes an item mid-loop, the loop can still send it. After a wipe this would send an issue the person chose to delete, under the old device id.
   - Fix: re-read `store.items()` and skip any item no longer present, just before each send.

7. **Minor, CONFIRMED. `send` is guarded by React state (`saving`), so a fast double tap can save two reports.**
   - Where: `ReportIssueSheet.tsx` `send`.
   - The two reports get different clientRefs. The server's 24-hour same-reason dedupe usually hides the harm.
   - Fix: also guard with a `useRef`.

8. **Minor, CONFIRMED. Accessibility.**
   - Where: `ReportIssueSheet.tsx`.
   - The note `TextInput` has no `accessibilityLabel`. Its visible label is a separate `Text`, so a screen reader announces an unnamed field.
   - Focus is not moved between steps (reasons, details, confirm, done).
   - The done/confirmation text is a `role="heading"` but not a live region, so a late change from "Sending" to "hidden" may not be announced.

9. **Minor, PLAUSIBLE. A photo URL that does not match `/api/photos/<id>` silently opens the cat-level sheet.**
   - Where: `photoPublicIdFromUrl` and `forPhoto`.
   - The person tapped "report this photo" but sees cat reasons and sends a cat report. Today every public photo URL has that shape (`photoVisibility.ts:69`).
   - Fix: if a `photoUrl` was given but no id can be read, do not open the sheet, or show an error.

10. **Nit. `CHECKPOINT.md` is committed at the repo root.** The last commit message still says "probes red", but all tests are green at HEAD. Remove the file and fix the note before the PR is marked ready.

11. **Test gaps behind the findings above.**
    - There is no test for a failing `submitIssue`.
    - There is no test for the delete flow with only issue reports pending.
    - There is no test for a late `?report=` param.
    - There is no test for a real Modal.
    - `issueQueue.test.ts` does not itself pin the tokenless-428 rule. That is covered only through `reportQueue.test.ts` on the shared code (probe 5).

## Strings: careful-reader notes (drafts for native review)

- All `issue*` keys exist in en, el and fr (the T6-8 test, and I read the blocks). French and Greek use tu forms.
- The `photo_private` hint is exactly right in English. The confirm step keeps both halves ("everyone" and "until reviewed") in Greek and French.
- The web rewrite works in all three languages.
- Greek:
  - «το μέσα ενός σπιτιού ή κήπου» is colloquial. «το εσωτερικό ενός σπιτιού ή κήπου» reads better.
  - «Αν την αναφέρεις, θα κρυφτεί από όλους» relies on an unnamed feminine "photo". Fine on screen with the thumbnail, but check it as a native reader.
  - «Αυτή η γάτα έχει πεθάνει» is blunt. The native reviewer may prefer a gentler phrase.
  - «Λυπούμαστε πολύ» adds "very" to the spec. It reads fine.
- French:
  - «Ton signalement va la masquer» also has an unnamed "la" (photo). It is fine with the thumbnail, but the reviewer should confirm.
  - «Ce chat est mort» is blunt. «décédé» is a softer alternative.
  - «Syros Cats l'aient examinée» (subjunctive) is correct.
  - «Vraiment ?» is natural.
- Over-promise check: no string claims "hidden" without the server saying so. The offline line is exactly the spec's.

## Checked, no issue

- `reportQueue.ts` refactor, line by line against main:
  - 428 retries once only when a token was sent and `checks428` was 0.
  - Back-off is 1, 5, 15, 30 minutes.
  - `checkDeclinedAt` and `checkBlocked` are set and cleared as before.
  - `checkBlocked` is only set after a tokenless send with the script blocked.
  - A permanent refusal is a strike, and the 428 exclusion is preserved.
  - Check fields clear on success, and the email is removed on success.
  - `confirmationState` is the same through `checkMessage`.
  - Behaviour is unchanged. Probes 5, 6 and 7 turned the cat-report tests red, so they do pin it.
- What the client sends matches the server (`issues.ts` ~84-87):
  - Photo id only for photo_private, photo_inappropriate, photo_not_cat and wrong_cat.
  - A note is capped at 1000.
  - clientRef `r-<16 hex>` is at least 8 characters.
  - A photo reason always has an id, because the photo reasons are only offered when an id was read.
- Status handling: a 429 sets `busy` and is never a strike. A 5xx or no signal is retried, and no signal stops the loop. A 400/404/422 is a strike, and after 3 the item is `failed` with Try again. A 428 and ChallengeUnavailable are never strikes.
- The reminder is cancelled on accept before the item is removed. It is also cancelled on wipe. The web reminder banner is wired.
- Cross-tab: the upload lock plus a `mutate` that re-reads storage. A duplicate send of one clientRef is idempotent on the server.
- The "never bigger than NeedsHelpLink" rule has a test.
- The hurt-first link goes to `/report`. The `wrong_info` note label reads "What do you know?".
- Greek capitals go through `displayUpperCase`.

## Mutation probes

| # | Mutation (restored after each) | Result |
|---|---|---|
| 1 | Send the photo id for every reason, including `other` (`newPendingIssue`) | RED (2 tests in `issueQueue.test.ts`) |
| 2 | Drop the confirm step (Send always sends) | RED (2 tests, `ReportIssueSheet.test.tsx`) |
| 3 | Choose the confirmation from the reason (hiding reason means "hidden") | RED (3 tests: sheet and lib T6-5) |
| 4 | Make the offline text say "The photo is hidden…" | RED (4 tests: T6-6 and T6-8) |
| 5 | Break the shared 428 rule (resend even with no token, or after a first 428) | RED, but only in `reportQueue.test.ts` (2 tests). `issueQueue.test.ts` stays green |
| 6 | Make a 428 a refusal (`isPermanentRefusal`) | RED (2 tests, one in each queue's tests) |
| 7 | Ignore the 428 back-off (`restingFromCheck` ignores `nextTryAt`) | RED (1 test in `reportQueue.test.ts`) |
| 8 | Do not cancel the native reminder on accept | RED (1 test in `IssueQueueContext.test.tsx`) |
| 9 | Remove `wipeIssues()` from the delete flow | RED (2 tests in `DeleteMyDataContext.test.tsx`) |
| 10 | Remove `onReportPhoto` from the cat page | RED (1 test in `CatPagePhotos.test.tsx`) |

The probes show the tests are real for the claims they make. The gaps are the failure paths in findings 1, 2, 4 and 6, which no test reaches.

---

# Ship review (`/ship`, 19 Oct 2026): a second independent critic on the final version

Sonnet, in its own worktree, at `527f9229`. **Verdict: MERGE.** No blocker or major. The first review's two Majors were confirmed fixed. The critic ran both typechecks (clean), the whole app suite (147 files, 1,943 tests, all pass) and 9 mutation probes.

| # | Finding | Outcome |
|---|---|---|
| 1 | Minor: the retry-path wipe of issue reports (after an interrupted deletion) had no test; probe P1 stayed green | **Fixed**: test added, P1 now red |
| 2 | Minor: the double-tap ref guard had no test; probe P5 stayed green | **Fixed**: two taps in one act, P5 now red |
| 3 | Minor: the live region had no test; probe P9 stayed green | **Fixed**: test added, P9 now red |
| 4 | Minor (wording): the Delete my data screen calls an issue report a "cat report" | **Filed** for a copy decision (not changed here: the screen's wording is reviewed copy) |
| 5 | Nit: the "couldn't save" line stayed after going back | **Fixed**, tested |
| 6 | Nit: the send-loop comment claimed to cover another tab | **Fixed** (comment) |
| 7 | Nit: `CHECKPOINT.md` committed | **Removed** before ready |
| 8 | Nit, plausible: the iOS handoff timer has no cleanup | No change: a state update after leaving the screen is ignored by React 18; real-device check is SYC-488 |

**Core promises re-verified on the final code:** the confirmation comes only from the server's `hidden`; the `reportQueue.ts` refactor is unchanged since the first review; nothing the app sends meets a permanent 400 from `routes/issues.ts` on `main`; a failed save leaves no ghost report or reminder; Delete my data never wipes an issue report unasked.
