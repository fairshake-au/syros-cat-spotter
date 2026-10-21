# SYC-44 PR 7.1 checkpoint: the Issues section, the strip and the actions

Branch `claude/upbeat-khayyam-a742af`, worktree `inspiring-goldstine-b9108e`, off origin/main `54e73a0b` (21 Oct 2026).
Session model Opus 5.5 (card can't choose; plan row says Sonnet for 7.1). Critic: Sonnet, own worktree.

## Facts checked on main (21 Oct)
- `view_welfare_queue` already in CATALOGUE (C6 fallback not needed).
- Queue title already "Queue" (SYC-450 Done via #243): nothing to do for SYC-450 item 2.
- Home links `/api/team#issues` (homePage.ts:91); countOpenIssues counts open content rows.
- SYC-462 already added `photos.removed_at` / 410 for removed photos.
- SYC-492 (Find this cat from report photo): leave alone; comment on it after 7.1 merges.

## Design
1. hide.ts: export `reportHidesToday()` / `brakeOn()`; `decide()` uses the same count (banner reads same function).
2. lib/issues/queue.ts: `listIssues()` four groups (hidden-waiting oldest first; location+died; rest newest; unchecked) + folded closed; `getIssueReport()`; `issuesForCat()` (strip, gated by `issueStripFor(person, catId)`).
3. routes/teamReports.ts: `GET /api/team/issues` (JSON), `GET /api/team/issue-photos/:reportPublicId` (view_welfare_queue; hidden only with hide_photo; 410 removed), `POST /api/team/issues/:publicId/{keep-hidden,restore,hide}`.
4. lib/issues/teamActions.ts: each action one transaction, photo row locked; Keep hidden refuses if no longer hidden (no visibility event); Restore one event + Nothing needed; Hide on any open row whose photo is public (plan names not_cat/wrong_cat; superset flagged in PR).
5. welfareActions: moveReportState body usable inside a tx.
6. queuePage: `<section id="issues">` below Waiting (+drafts), above Closed; "Issue" label + colour band; brake banner; hidden-waiting count line at page top (top-bar badge on every page deferred -> ticket).
7. catPages: "Reports about this cat" strip.
8. State/note JSON answers for content rows: getIssueReport instead of 404.
9. Tests: team.issues.test.ts (T7-1..T7-6), walk TABLE rows, T4-1 updated (welfare part byte-for-byte, Issues section stripped), allowlists.

## Done
- (nothing yet)

## Next
- Test tooling (esbuild/rollup workaround), then build items 1-9, committing after each.
