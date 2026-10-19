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

## Next
1. lib/checkedSend.ts: shared token-per-send / 428 / ChallengeUnavailable rules; refactor reportQueue.ts onto it (its tests must stay green).
2. lib/issueQueue.ts on QueueStore + tests (T6-6, T6-7).
3. context/IssueQueueContext.tsx (key cat-spotter/pending-issues, lock, reminder, foreground gate) + banner.
4. Strings en/el/fr + T6-8.
5. components/report/ReportIssueSheet.tsx + T6-4, T6-5.
6. Mount links on the cat page, SightingPhotos, main PhotoViewer.
7. Full app suite, mutation probes, browser check, adversarial review, draft PR, Linear.
