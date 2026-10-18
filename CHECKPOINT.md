# CHECKPOINT: SYC-44 PR 6.1 (full-screen photo, hidden tile, the link)

Branch `claude/syc-44-pr-6-1`, worktree `.claude/worktrees/youthful-chaplygin-b8be42`, off `origin/main` `bdffc3c3`.
Plan: `docs/superpowers/plans/syc-44-report-an-issue.md` PR 6.1 (line 410).

## Calls made where the plan is silent (flag on SYC-44)
- The two report links ("Report an issue", "Report an issue with this photo") are built but render only when given an `onReport` handler. 6.1 passes none, so they stay invisible until 6.2 wires the sheet. No dead link if 6.1 is published alone.
- "Photo removed" tile: no removal state exists on `main` (7.2 builds it), so 6.1 ships only the hidden tile.
- SYC-415 already has a small full-size viewer in `SightingPhotos.tsx` for extra photos; 6.1 replaces it with the plan's viewer (photo, date, who spotted it, Close) and opens it from the hero, the sighting cover and the extras.

## Done
- [x] T6-2 server `photoHidden` (test first) + OpenAPI + codegen (4454c041; 33/33; probe red)
- [x] PhotoViewer component + T6-1 tile + T6-3 exclusions (027a8c18)
- [x] cat page wiring, photoCaption helper, ReportIssueLink (d76b7ce9); app suite 1828/1828; 3 probes red
- [x] strings en/el/fr (photoViewerSpottedBy, photoHiddenTile, reportIssue, reportIssuePhoto)
- [ ] tests run, browser check 390/desktop en/el/fr, screenshots
- [ ] adversarial review (Sonnet, own worktree), fold in
- [ ] draft PR, Linear comments, SYC-346 strings

## Next
Linear flag comment on SYC-44, then browser check (390/desktop, en/el/fr), screenshots to docs/screenshots/syc-44-pr-6-1/.
