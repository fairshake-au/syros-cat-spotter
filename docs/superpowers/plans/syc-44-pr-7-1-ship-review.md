# Ship review: SYC-44 PR 7.1 (PR #273, head e55d7d7d)

Reviewer tier: Sonnet. Own worktree, branch `review/syc-44-pr-7-1-ship`.
Evidence: full read of `git diff origin/main...e55d7d7d` and of `d94ff668..e55d7d7d`; the three allowed test files run (team.issues 29/29, team.kind 14/14, team.queuePage 22/22); one temporary probe file (three probes, deleted, nothing committed).

## Verdict: merge after fixes (all small)

No way for a cat guardian to reach issue data, no reporter detail leak, no integrity hole in the three photo actions, no deadlock. The earlier critic's fixes are correct and I found no regression in them. What remains is that finding 2's fix only covers the page, not the server; one count is still wrong; and the "waiting" line is still above the first welfare report.

## Findings, most severe first

### 1. Minor (fix before merge, it is a few lines): finding 2's fix is page-only; the server still closes a report whose photo is hidden
- `queuePage.ts:481-484` hides Done / Nothing needed on a hidden-photo row. But `POST /api/team/reports/:id/state` (and the JSON route) still takes any `to` for a `kind='content'` row; `moveReportState` / `moveReportStateIn` (`welfareActions.ts`) know nothing about the photo.
- Probe P1 (run): a hidden-by-report issue, `POST /api/team/reports/<id>/state {from:new,to:nothing_needed}` answered 200, state `nothing_needed`, photo still `hidden:true`. The report is then closed and the photo hidden for good, in no list anyone reads: the exact hole plan-review finding 13 wanted shut.
- Real-world way in (not just forgery): a stale page. Two reports on the same public photo; one is drawn while the photo is public (all four buttons), a colleague then hides the photo (Hide this photo on the other row, or the cat page), and "Nothing needed" is pressed on the stale row. Also any API client.
- Fix: in the state route (or `moveReportState`) for a content row, when `to` is done/nothing_needed and the report's photo is hidden and not removed, answer `changed`-style refusal with the hint text. Or take the photo lock in that path. One test.

### 2. Minor: the "photos waiting" line is still above the first welfare report (builder's answer to finding 1 is only half defensible)
- `queuePage.ts:~620`: `hiddenWaitingLine(issues) + <h2>Waiting for the team`. Probe P1b (run): the line sits at byte 39700, "Waiting for the team" at 39793, the first welfare card at 39852.
- Spec §5.3 puts the number "in the dashboard's top bar" (page chrome), and the same paragraph states the approved rule "never above a welfare report". A line of Issues content in the page body, above the welfare heading, is above every welfare report. The builder's reading (the rule is only about report rows) is possible, but T7-2 pins only the section, so the line is the one place the approved rule is not tested and is broken in spirit. The team.kind test even has to strip the line out by regex.
- Cost is one line of height, so it is not dangerous; it is a decision that was Samuel's to make and is recorded only as SYC-553 (menu badge).
- Fix: either put it in the layout's top bar (SYC-553 now, small), or move it under the welfare section and update the T7-2 assertion. If Samuel accepts the line as built, say so in the PR description and spec §5.3.

### 3. Minor: the strip still says "(50)" for a cat with more than 50 reports (finding 6b, unaddressed and not mentioned in the builder's answer)
- `catPages.ts` heading uses `issues.length`; `queue.ts:256` limits to `STRIP_LIMIT` 50. Probe P3 (run): 52 reports gave "Reports about this cat (50)".
- Fix: a separate `count(*)` for the heading plus "Showing the newest 50 of N", as the queue does.

### 4. Minor: the 100-per-group cap is display-only and hides the oldest
- `queue.ts` `listIssues` still reads every open row, each with the `others` subquery, then slices. Under a flood (an outage floods the unchecked list, the case finding 5 named) every page load and every action's JSON still pays for all rows; only the HTML shrinks.
- The open groups other than "hidden" are newest first, so rows 101+ are the OLDEST and unreachable until newer ones are closed one by one. A strip link (`?issue=open&r=`) to an open report past the cap, or a closed one past the newest 50, lands on the top of the page.
- Fix: apply the limit in SQL per group (window `row_number() over (partition by group)`), or at least note it. Nit-level if floods are rare.

### 5. Nit: Restore / Hide write the photo event directly, not through `setPhotoVisibility`
- The plan says Restore "writes the restore through `setPhotoVisibility`". `teamActions.ts` `writeEvent` re-implements the insert (same columns, `clock_timestamp()`, same lock, removed handling). I compared it with `photoVisibility.ts:setPhotoVisibility`: behaviour is identical today. It is justified (the report row must be locked first, so the photo lock cannot be taken inside a second transaction), but it is a second place that decides visibility, in a codebase whose header says there is only one. Add a comment pointing at the lock order, and a test that would fail if `setPhotoVisibility` gains a rule (for example a new reason requirement) that this path skips.

### 6. Nit: `hideFromIssue` / `keepHidden` / `restoreFromIssue` take `from?: ReportState` types wider than the route now allows
- Route accepts only new/looking, library accepts any ReportState. A future caller (not the route) can still forge `from=done`. Narrow the type to `"new" | "looking"` so the check lives in one place.

## The builder's two "kept" answers

- **Finding 1 (count line stays):** half defensible, see finding 2 above. Filing SYC-553 is right; the rule check is what is missing.
- **Finding 4 (unchecked counted among "others"):** defensible. §5.3 says "other open reports in the same group", an unchecked one is open, the number is a prompt to look and decides nothing, and the test pins it. Only caveat: unchecked reports exist exactly when Cloudflare was down, so a burst can inflate the number on a real report. I would not block on it.

## What I checked and found correct

- **Guardian access.** `GET /team/issues`, `/team/issue-photos/:id`, the three POSTs all use `requireTeam` with a capability and no target (island-only); `issueStripFor` checks `view_welfare_queue` itself. The cat page 403s a guardian anyway. `?issue=` and `?r=` are only rendered on pages she cannot load. No redirect from a guardian-reachable page carries issue data (`backToIssue` only goes to `/api/team`).
- **Reporter details.** `issueRows` selects no device, contact, language or address; sender is the fixed words "A member of the public"; JSON shape pinned by T7-6. `onReportStateChanged` only emails `kind='welfare'` rows, so closing an issue sends nothing.
- **Photo route.** Joins on a sent `kind='content'` report; welfare and draft ids 404; mime allow-list; removed gives 410; hidden photo needs `hide_photo`; bytes are read after the checks and a removal between the reads gives 410, not 500.
- **Integrity.** Keep hidden is refused when the photo is public (`!photo.hidden`); Restore refuses a removed photo and an already-public one; Hide on a removed photo answers `already_hidden` (so the DB trigger is not relied on). `lockIssue` filters `kind='content' and is_draft=false`, so welfare rows and drafts cannot be touched; no `welfare_outcome` observation (guard `kind==='welfare'` retained in `moveReportStateIn`). The refactor of `moveReportState` into `moveReportStateIn` is a straight move: same update, event, email hook and observation, same `changed` vs `not_found` answers.
- **Races and locks.** Order is report row then photo row in `act`; `hide.ts` locks the photo only for the report row it just inserted (invisible to others until commit); `setPhotoVisibility` locks only the photo. `onReportStateChanged` returns before taking its advisory lock for content rows (its first query is `kind='welfare'`), so there is no hidden third lock. Two simultaneous Keep hidden gave `kept` + `changed`, one state event (the new race test). No cycle.
- **The new `from` restriction (finding 3 fix).** Only the two close actions need `from`; the page offers them only on open rows, whose state is new or looking, so no legitimate flow is broken. A stale page that posts `from=new` after a colleague closed the row gets `changed` (303 with the notice; probe P2), not 400. A forged `from=done` gets the 400 page. Reopen-then-keep still works (reopen to Looking, then Keep hidden). Tests cover the 400s and the zero events.
- **Reduced buttons (finding 2 fix, page side).** A hidden, not-removed photo row offers New and Looking plus Keep hidden and Restore; a removed photo gets the full set (Keep hidden is also there); a public photo gets Hide and the full set; a no-photo row gets the full set. I found no state where an open report cannot be closed from the page: every hidden-photo row has Keep hidden, and the capabilities for both are held by every role that holds `view_welfare_queue`.
- **Grouping, order, others.** Groups, longest-wait-first for the hidden group, newest first for the rest, unchecked separate, `others` SQL match §5.3 (same photo + reason, or no photo: cat + reason; open, sent, other id). The section is below the welfare sections; the totals in headings and "Showing N of M" are right (T7 finding-5 test, 101 rows).
- **Brake banner.** One count function (`reportHidesToday`) shared by the hide and the banner; the Athens-day window exists once. Class `banner brake` no longer collides with the mail-failure banner (the test asserts `class="banner"` is absent). No resume route or control; a Team member's Hide is not counted (author filter `report:%`; new test).
- **XSS / reflection.** Every dynamic value goes through `esc`. `?issue=` is checked with `Object.hasOwn` against fixed text and never echoed (`open` shows nothing but opens the card); `?r=` is only compared to known ids; redirect targets use `encodeURIComponent`. The strip's new href uses `encodeURIComponent` + `esc` and the `&amp;` form (test pins it).
- **team.kind T4-1 strip.** `ISSUES_RE = /<section id="issues"[\s\S]*?<\/section>/` removes only from the Issues section's own opening tag to the first `</section>`. The Issues section is the last block of the page and contains no nested `<section>`, so it cannot swallow welfare markup. If a nested section were added later the leftover would appear in the "after" HTML only and the byte-for-byte test would fail loudly, not pass. The second replace removes only the first `<p class="notice issuewait">…</p>`. The JSON compare is untouched and unstripped, and `${PREFIX}c-` is still asserted absent outside the section. What the strip cannot catch is a welfare row wrongly drawn INSIDE the Issues section; `listIssues` filters `kind='content'` in SQL and T7 tests seed a welfare row and assert it is untouched, which is enough. Sound.
- **State/note JSON for content rows.** The routes now answer in the Issues shape (200) instead of 404; the tie route still refuses non-welfare rows (`not_welfare`). Tests updated to assert the stronger new behaviour, nothing weakened.
- **Plan 7.1 list.** Capability gating, own photo route, four groups, colour band + "Issue" label, row fields with `hide_skipped` words, banner, three actions, links to cat-page forms, no "Which cat is this?", the strip, T7-1..T7-6, walk rows, screenshots: all present. Only the top-bar count differs (finding 2).

---

## What the builder did with each finding (22 Oct 2026)

| # | Outcome |
|---|---|
| 1 | **Fixed (98feebed).** The state route refuses Done or Nothing needed on an issue whose photo is still hidden: a form goes back with "Nothing changed: the photo is still hidden…", JSON gets 409 `photo_hidden`. A welfare report, and a photo deleted for good, close as before. Tests "ship review finding 1"; probe P14 red. |
| 2 | **Samuel's call** (asked in the /ship session). |
| 3 | **Fixed.** The strip's heading counts every report about the cat, with "Showing the newest 50 of N". Test "finding 3"; probe P15 red. |
| 4 | **Filed as SYC-556** (limit per group in SQL; only matters past 100 open reports in one group). |
| 5 | **Comment added** on the second writer, saying why it exists and that both must change together. |
| 6 | **Fixed.** `keepHidden` / `restoreFromIssue` take `OpenState` (new or looking) only. |
