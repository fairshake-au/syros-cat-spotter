# SYC-569 checkpoint

Updated after every task. Resume from the last commit plus this file.

## Part 1 (SYC-571)

- [x] T1.1 "Does {name} live with you?" link and `ClaimAskSheet` (en/el/fr keys drafted inline; `claimAskSpotNow` added but not rendered). Docs `claiming-a-cat.md` §4.1 and §6 updated.
  - Judgement: added a `claimAskClose` key ("OK") because no OK key existed; added `ClaimAskLink` in the same file as the sheet.
  - Judgement: the spec's SYC-483 pattern isn't in the code (no SYC-483 mention anywhere). Used the PhotoTipsCard pattern instead: Modal plus `accessibilityViewIsModal`, `role="dialog"`, `aria-modal`, and the cat page focuses the link on close.
- [x] T1.2 ear-tip copy: `earTipWhy` replaces `earTipUsuallyLeft`; question and caption reworded (en/el/fr). The component already rendered question, why line, photo, caption, answers in that order, so only the keys changed; order test added (`components/__tests__/earTipOrder.ts`) and run for the review-screen props (SightingQuestions test) and for MoreToAdd. The review screen has no ear-tip-specific wrapper, so it uses the same component with default props.
- [ ] T1.3 keepSafeWarning, deleteDoneEmail, reportCheckBlocked
- [ ] T1.4 dashboard map note
- [ ] T1.5 second-pack table
