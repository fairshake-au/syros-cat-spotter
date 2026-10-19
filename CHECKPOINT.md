# CHECKPOINT: SYC-44 PR 6.1 (full-screen photo, hidden tile, the link)

Branch `claude/syc-44-pr-6-1`, worktree `.claude/worktrees/youthful-chaplygin-b8be42`. **Draft PR #246 open.** Delete this file before the PR is marked ready.

## Done
- Server `photoHidden` + OpenAPI + clients (T6-2); byte-for-byte snapshots regenerated on purpose.
- PhotoViewer, tile, cat page wiring, caption helper, ReportIssueLink (not mounted until 6.2); en/el/fr strings.
- Tests: app 1832/1832; api cat-page files 637/637; full api 3758 pass, 1 known flake (SYC-334). Mutation probes red.
- Browser check 390/320/desktop en/el/fr; screenshots in docs/screenshots/syc-44-pr-6-1/.
- Sonnet adversarial review (docs/superpowers/plans/syc-44-pr-6-1-review.md) folded in; nit filed SYC-483.
- Linear: SYC-44 comments (flags + PR), SYC-346 strings, SYC-334 occurrence.
- Cleanup: preview servers stopped, scratch DB dropped, reviewer worktree removed.

## Next
`/ship` (Samuel's call): delete this file, mark ready, CI, merge. Then PR 6.2. SYC-462 adds photoRemoved + "Photo removed" tile after this merges.
