# CHECKPOINT: SYC-44 PR 6.2 (reason sheet, confirm step, saved list)

Worktree: `.claude/worktrees/catspotters-dashboard-redesign-380d2a` (app-assigned, branched at origin/main `fe36a3b`).
Branch: `claude/relaxed-sutherland-722f64` (renaming it was refused by the permission classifier; push under this name).

## Done
- Read plan PR 6.2, "What works with no signal", plan review, spec §2/§4/§7/§9.5/§11/§13, D2/D9/D11, 6.1 review.
- Read Linear SYC-44 (all comments), SYC-346 (+ comments), SYC-305, project P-SYC-54.
- Confirmed nothing for 6.2 on origin/main.

## Design notes (decided by the server contract, not invented)
- `photoPublicId` is required for photo_private / photo_inappropriate / photo_not_cat, optional for wrong_cat, refused for the rest (routes/issues.ts:314-317). So `other` from a photo is sent without the photo id.
- Photo sheet reasons: photo_private, photo_inappropriate, photo_not_cat, wrong_cat, other (spec §3.2). Cat sheet: wrong_name, wrong_info, location_revealing, cat_died, wrong_cat, other (spec §3.1).
- Reuses existing strings: reportCheckUnavailable, reportCheckBlocked, reportSending, reportBusy, reportTryAgain, reportDone.

## Built (all committed)
1. lib/checkedSend.ts shared; reportQueue.ts on it (35 tests unchanged).
2. lib/issueQueue.ts + tests (T6-5, T6-6, T6-7).
3. IssueQueueProvider (cat-spotter/pending-issues), IssueReminderBanner, lib/nativeReminder.ts, delete-my-data wipes issues.
4. Strings en/el/fr (issue* block) + issueStrings.test.ts (T6-8, T6-4 strings).
5. ReportIssueSheet + tests; links mounted on the cat page, SightingPhotos, main PhotoViewer; ?report=wrong_info.
6. Full app suite 1928/1928 after the layout stub fix; typecheck clean.
7. Mutation probes P1-P7 all red (P3 needed a direct guard test, added).

## Done after the build
- Browser check en/el/fr, 390px + desktop, screenshots committed; scratch DB dropped, servers stopped.
- Sonnet adversarial review committed (docs/superpowers/plans/syc-44-pr-6-2-review.md); findings 1,2,3,4,6,7,8 fixed; 5 -> SYC-487; 3 device check -> SYC-488; focus -> SYC-483.
- Full app suite 1943/1943, typecheck clean.
- Draft PR #249 open. Linear: SYC-44, SYC-346 (strings), SYC-305 commented. SYC-462 session told about shared files.

## Next (for /ship)
- Delete this CHECKPOINT.md before `gh pr ready`.
- SYC-487 is Samuel's decision ("Something else" under a photo).
