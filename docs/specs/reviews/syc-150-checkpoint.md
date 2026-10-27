# SYC-150 checkpoint (move a sighting to another cat)

Session worktree: `built-switched-off-features-255ea4`, branch `claude/syc-150-move-sighting-9cb384`.

## Done
- SYC-150 set to In Progress (26 Oct 2026).
- Read SYC-150 + comments, SYC-418 (folded in), spine §8, §10.1–10.3, §10.9, choose-a-different-cat §5 and §8.2, matching-game §7.2, report-an-issue (keep `photos.id`), spotted-stamps §155, add-details-later §212, claiming.test (move shape anticipated), catHistory.ts (anticipates "sighting no longer on this cat").
- Code survey done (Sonnet Explore); key facts spot-checked (trigger 0046, hasMetCat).
- Draft spec `docs/specs/move-a-sighting.md` + spine §10.10 committed (0e0553143).
- Adversarial review done (Sonnet; 1 blocker, 12 major, 9 minor), all folded in (cd30c0a09). Review notes: `docs/specs/reviews/move-a-sighting-review.md`.
- Rendered: https://claude.ai/artifact/45ocXzt9XAvY4zswn3SEg1

## Samuel's answers
- 26 Oct, D1 (only photo on a cat): "Design this together with the merge contemplated in SYC-59".
- 26 Oct, scope: "All of SYC-59" — detection triggers AND the merge, in this spec, with moving.

## Next
- Research SYC-59: proposal §6, matching-game §7.2/§14, when-the-photo-check-fails (New cats to check), SYC-410/531, SYC-59 comments (followers/unfollows, claims, coat readings, agreeWithClip, writeObservation canonical checks).
- Widen spec: detection → merge → undo, plus move/split/new cat. Re-run adversarial review on the widened spec.
- Decisions D1–D6 to Samuel one at a time (AskUserQuestion); record answers in spec §5 and on SYC-150.
- File D5 follow-up (guardians moving photos) once D5 is answered.
- After spec approval: implementation plan with model delegation; stop for approval.
