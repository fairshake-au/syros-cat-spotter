# SYC-569 checkpoint

Updated after every task. Resume from the last commit plus this file.

## Part 1 (SYC-571)

- [x] T1.1 "Does {name} live with you?" link and `ClaimAskSheet` (en/el/fr keys drafted inline; `claimAskSpotNow` added but not rendered). Docs `claiming-a-cat.md` §4.1 and §6 updated.
  - Judgement: added a `claimAskClose` key ("OK") because no OK key existed; added `ClaimAskLink` in the same file as the sheet.
  - Judgement: the spec's SYC-483 pattern isn't in the code (no SYC-483 mention anywhere). Used the PhotoTipsCard pattern instead: Modal plus `accessibilityViewIsModal`, `role="dialog"`, `aria-modal`, and the cat page focuses the link on close.
- [ ] T1.2 ear-tip order and copy
- [ ] T1.3 keepSafeWarning, deleteDoneEmail, reportCheckBlocked
- [ ] T1.4 dashboard map note
- [ ] T1.5 second-pack table
