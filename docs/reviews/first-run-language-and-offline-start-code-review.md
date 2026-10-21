# Adversarial code review: SYC-155/SYC-506

> Independent review (Opus subagent, read-only), 21 Oct 2026, of `git diff 7a2d83ff..2eac55e6 -- artifacts/` on branch `claude/happy-blackburn-7e1a3f`. Saved by the parent session. What was done about each finding is in "Resolution" at the end.

**Plain-English summary.** Most of this works. The language now follows the phone, Welcome has a working language switch, and a name picked offline gets saved later. Typecheck is clean and all 776 tests in the touched folders pass. One real bug: if someone picks a name offline and then uses "Delete my data" while the app is still saving that name, the brand-new spotter can come back wearing the old, deleted spotter's name, which the server never saved. The same weak spot can, rarely, put the old name over a restored spotter after "Get your spots back". There are also two smaller logic slips in the name-saving rules, one misleading note, a few test gaps and some out-of-date comments.

## F1 — Blocking — A save that finishes after "Delete my data" puts the old name on the new spotter (CONFIRMED)
`hooks/useHeldNameSaver.ts`: the "same spotter?" check reads `latest.current`, refreshed only on render. `<HeldNameSaver/>` unmounts as soon as `heldUsername` clears, on `/restore`, on the Done screen and when `moved`, so the ref keeps the old identity and the check passes. Cleanup sets `active=false`, but the apply path ignores it. `DeleteMyDataContext` does not wait for the claim lock. Reproduced: mounted as `_layout` does, `resetIdentity()` mid-claim, then the claim resolved: `expected 'SunnyTabby' to be null`. Fix: apply only while the run is current; better, compare a live identity generation bumped by `resetIdentity`/`startAgain`/`adoptRestoredIdentity`. Test the saver unmounting mid-claim.

## F2 — Should-fix — Restore stops waiting after 35 s; one save run can take much longer (PLAUSIBLE)
`runBackgroundClaim` holds the lock for the whole run (up to 7 sequential requests, 30 s transport timeout each); `waitForUsernameClaimToSettle` gives up at 35 s and restore carries on. With F1, a late success lands on the restored spotter. Fix: check identity between requests inside `saveHeldName`; correct the "restore waits for it" comment.

## F3 — Should-fix — A refused name gets numbered and sent again (CONFIRMED)
`lib/heldNameSave.ts`: 409 always numbers `held`. Held refused (400) → suggestion taken (409) → `Badname47` is sent. Breaks spec ("refused names go straight to a suggestion"). Also, a taken suggestion numbers `held` instead of trying another suggestion. Fix: once refused or on suggestions, a 409 gets another suggestion.

## F4 — Should-fix — Note blames "someone else" when the server already had another name for this phone (CONFIRMED)
Adopting a different existing name sets `reason: 'taken'` ("Someone already had Bob, so you're Alice"), though Bob may be free (an earlier lost-answer claim, or another tab). Fix: no note, or neutral wording; test it.

## F5 — Should-fix — Spec-listed tests missing; the restore test passes for the wrong reason (CONFIRMED by reading)
Missing: gate with a held name, email offer waiting for a saved name, restore with a held name, Me note. The "save ends after a restore" test keeps the hook mounted, so it cannot catch F1.

## F6 — Nit — `numbered(held)` can repeat the same number; `suggest()` can repeat (PLAUSIBLE)
## F7 — Nit — Retry every 60 s forever, no backoff; 429 retried at a fixed minute (PLAUSIBLE)
## F8 — Nit — Queued sightings wait while the name is held; if saving keeps failing they never upload; on restore with a held name they upload under the restored spotter without a warning (PLAUSIBLE, by design)
## F9 — Nit — Out-of-date comments in `steps.ts`, `OnboardingFlow.tsx`, `DeviceContext.isReady` (CONFIRMED)
## F10 — Nit — "Change it" can reopen the editor by itself when the editor remounts (offline → online) (PLAUSIBLE)
## F11 — Nit — Two tabs: a tab opened before the hold can claim a different name on its own name screen; the lock doesn't cover it (PLAUSIBLE)

## Checked and fine
LanguageContext (guess never stored; ready always true; Hermes Intl fallback; no static web output). Welcome switch semantics on native and web. `ApiError` carries `.status`; firm statuses right; local rules match the server. Name screen cannot hold while a claim is open; saver and Me editor cannot overlap. `get-spots-back` and `HomeScreenNudgeBanner` use the saved name. `tsc` clean; 66 files, 776 tests pass.

## Verdict
Not ready to merge: fix F1 with an unmount test; F2–F5 cheap and worth fixing before merge; F6–F11 to Linear.

## Resolution (parent session, 21 Oct 2026)

| Finding | What was done |
|---|---|
| F1 | Fixed. `DeviceContext.identityGeneration()` (live, bumped by Delete my data, Start again, restore). The save captures it, `saveHeldName` checks it before and after every request (`abandoned`), and the saver applies nothing once it changes. New tests mount the saver as `_layout` does and change identity mid-claim (reset and restore). Mutation probe: removing both checks turns 3 tests red. Removing only the saver's final check is still caught by the save's own checks, by design. |
| F2 | Fixed by the same check between requests; the `runBackgroundClaim` comment is corrected (restore waits up to 35 s; the save stops itself after). |
| F3 | Fixed: a refused name is never numbered; a taken suggestion gets another suggestion. Tests added. |
| F4 | Fixed: adopting a name the server already has for this phone shows no note. Test added. |
| F5 | Gate tests added (`layoutOnboardingGate.test.tsx`: held name passes onboarding, no email offer before the name is saved, waits for language), each mutation-probed. Restore needs no change, because it reads only the saved `username`. The Me tab has no component tests in the repo; it was checked in the browser (en, el, fr). |
| F6 | Fixed: names are redrawn (up to 10 times) to avoid repeats. Test added. |
| F7 | Backoff added (1, 2, 5, then 10 minutes). `Retry-After` on 429 filed as SYC-536. |
| F8, F11 | Filed as SYC-536. |
| F9 | Comments updated. |
| F10 | Fixed: the editor remembers the last request it handled. |

Full cat-spotter suite after fixes: 156 files, 2021 tests pass; typecheck clean.
