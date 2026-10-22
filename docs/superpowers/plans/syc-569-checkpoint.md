# SYC-569 checkpoint

Updated after every task. Resume from the last commit plus this file.

## Part 1 (SYC-571)

- [x] T1.1 "Does {name} live with you?" link and `ClaimAskSheet` (en/el/fr keys drafted inline; `claimAskSpotNow` added but not rendered). Docs `claiming-a-cat.md` §4.1 and §6 updated.
  - Judgement: added a `claimAskClose` key ("OK") because no OK key existed; added `ClaimAskLink` in the same file as the sheet.
  - Judgement: the spec's SYC-483 pattern isn't in the code (no SYC-483 mention anywhere). Used the PhotoTipsCard pattern instead: Modal plus `accessibilityViewIsModal`, `role="dialog"`, `aria-modal`, and the cat page focuses the link on close.
- [x] T1.2 ear-tip copy: `earTipWhy` replaces `earTipUsuallyLeft`; question and caption reworded (en/el/fr). The component already rendered question, why line, photo, caption, answers in that order, so only the keys changed; order test added (`components/__tests__/earTipOrder.ts`) and run for the review-screen props (SightingQuestions test) and for MoreToAdd. The review screen has no ear-tip-specific wrapper, so it uses the same component with default props.
- [x] T1.3 `keepSafeWarning` (en/el/fr; email-capture.md lines 143 and 548 updated), `deleteDoneEmail` removed (component, 3 dictionaries, email-capture.md §6.3; new `DeleteMyDataDone.test.tsx`), `reportCheckBlocked` reworded.
  - Finding: in the 'blocked' state NEITHER `ReportIssueSheet` (state 'blocked' shows only the message and "Done") NOR `ReportConfirmation` shows any send or retry control. "Try again" appears only for 'failed'. The queue retries by itself with a backoff (`checkedSend.ts`). So the spec's "then send again" has nothing to point at. Wording used: "...Turn it off for this page and we'll try again. If that doesn't help, allow challenges.cloudflare.com." (same promise as `reportCheckUnavailable`). Domain stays last.
- [x] T1.4 dashboard map note. New keys `map.teamOnly`, `map.whyTitle`, `map.whyBody` (en/el/fr) replace `sites.mapHint` and `new.mapNote`; one helper `lib/teamPages/mapNote.ts` (`mapPrivacyNote(lang)`) is used by the sites page, the new-site picker and the cats map (`teamOnlyHint()` deleted). Reuses the existing `.hownote` details style. Note: the new-site map had no "only for the team" line before; it now has the visible line too (consistent with the other two). Tests: shared `src/test/mapNote.ts` used in team.catMap, team.sites, team.siteWrites tests.
- [x] T1.5 `docs/superpowers/plans/syc-569-second-pack.md` written (Part 1 rows; drafted inline in the dictionaries as each task landed). Parts 2 and 3 append their rows (T2.7, T3.4).

Part 1 gate: cat-spotter full vitest (172 files, 2236 tests) green; api-server team page and route tests green; cat-spotter and api-server typecheck green. Root `pnpm run typecheck` fails only in `artifacts/mockup-sandbox` (React types clash in `ui/calendar.tsx` and `ui/spinner.tsx`; untouched by this branch).

## Next
Part 3 (T3.1 `fitRegion` first), then Part 2.
