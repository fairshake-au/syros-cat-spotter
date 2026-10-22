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
6. queuePage: `<section id="issues">` at the very bottom (below every welfare report, closed and unchecked too); "Issue" label + colour band; brake banner; hidden-waiting count line at page top (top-bar badge on every page deferred -> ticket).
7. catPages: "Reports about this cat" strip.
8. State/note JSON answers for content rows: getIssueReport instead of 404.
9. Tests: team.issues.test.ts (T7-1..T7-6), walk TABLE rows, T4-1 updated (welfare part byte-for-byte, Issues section stripped), allowlists.

## Done (21 Oct)
- Items 1-9 built and committed (743e6d49 .. 174f635f). team.issues 20/20, walk 22/22, team.kind 14/14.
- Test runner: scratchpad vt.sh (ESBUILD_BINARY_PATH, local DB catspotter_test).

- Probes: 10 of 11 red; P2b (plan's literal no-target view_exact_location) stays green by construction (strict can()).
- Full suite (pre-merge): 4,496/4,497 with 1 test-order bug in my own test, fixed (842dc122). First run had 4 fails in 3 files, names lost (tail).
- Merged origin/main (#262, #267) at d94ff668: conflicts in queuePage.ts and team.ts resolved (canTie kept, issues after it).
- Browser check done (390 + desktop), screenshots committed ccdf57c5; preview server stopped, scratch DB dropped.
- Filed SYC-553 (menu badge). Critic (Sonnet, own worktree) started on d94ff668.

## Next (old list below kept for reference)
- Mutation probes (script in scratchpad probes.sh), then full api-server suite, browser check 390/desktop + screenshots to docs/screenshots/syc-44-pr-7-1/, Sonnet critic in own worktree, draft PR, Linear (SYC-44 comment, tickets), message overlapping sessions (#269, #267, #266 queuePage.ts; #262 walk; #270 kind allowlist).
