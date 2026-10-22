# Adversarial review: SYC-44 PR 7.1 (Issues section, strip, three actions)

Reviewed commit `d94ff668` (branch `claude/upbeat-khayyam-a742af`). Reviewer tier: Sonnet.
Evidence: full read of the diff, `routes/team.issues.test.ts` run (20 of 20 pass), and five temporary probe tests (races, forged `from`, generic close, unchecked count) added and then reverted. Nothing from the probes is committed.

## Verdict in plain English

No blocker and no major defect found. A cat guardian cannot reach any issue data by any route I could build, reporter details never leave the server, and the photo actions are safe against races. What I did find is a set of smaller problems: the "photos waiting for you" count is in the wrong place and above welfare reports (the one place the build departs from the spec's wording and contradicts an approved rule), the old generic "Move this report to" buttons sit beside the new photo buttons and skip their safety check, two forged-request edge cases write junk state, and a few test gaps.

## Findings, most severe first

### 1. Minor: the "waiting for you" count is not in the top bar, and it sits above the welfare reports
- Spec §5.3 group 1: "the number shows in the dashboard's top bar". Plan 7.1: "the count goes in the top bar". Built: a one-line link on the Queue page only (`queuePage.ts` `hiddenWaitingLine`, drawn first in the body at `queuePage.ts` ~line 605: `hiddenWaitingLine(issues) + <h2>Waiting for the team ...`).
- Two problems. (a) Someone on Home, Cats or Insights never sees that a photo was hidden and is waiting. (b) The line is Issues content drawn above the first welfare report, and the approved rule (spec §5.3, "never above a welfare report") is the one the page is built around. The test pins it the wrong way round: `team.issues.test.ts:232` asserts the line comes BEFORE "Waiting for the team".
- Scenario: a neighbour reports a privacy photo, it is hidden, the team member opens Home and Cats all morning and never sees the count.
- Fix: put the count in the top bar for holders of `view_welfare_queue` (one cheap `count(*)` of hidden-by-report rows, only for holders), as spec and plan say; or, if Samuel prefers the line, move it below the welfare section and change the test. This is Samuel's call; the builder was right to list it as a deviation, but I would not accept it silently.

### 2. Minor: the generic "Move this report to" buttons on an Issues row skip the photo guard
- `queuePage.ts` `issueCard` ends with `actionForms({ ...i, contactLeft: false, emailToReporter: null }, landed)`, so every open issue row also carries the four plain state buttons (`POST /team/reports/:id/state`), which know nothing about the photo.
- Confirmed by probe P4: a report whose photo is hidden, closed with the plain "Done" button, returns 303 and the row moves to Closed with its photo still hidden. Closing a `photo_private` row as "Nothing needed" the same way leaves the photo hidden for good, in no list anyone reads, while the team thinks they dealt with it. The safe direction (still hidden), but it is the exact "closed without a decision on the photo" hole that finding 13 of the plan review set out to close, left open by the sibling buttons. A hurried person is likely to press "Nothing needed" thinking it means "restore".
- Fix: on an open row whose photo is hidden, render only the note form and "Looking at it" (hide Done and Nothing needed), or show the same warning text, so the closing paths are the two photo-aware buttons. Add a test.

### 3. Minor: Keep hidden and Restore accept any `from`, including a closed state
- `routes/teamReports.ts` `FromBody` accepts any of the four states; `teamActions.ts` `act()` never requires the report to be open.
- Probe P3: after a report was closed, `keep-hidden` with a forged `from=done` wrote a `done>done` state event, and `restore` with `from=done` wrote a restore event and a `done>nothing_needed` event, silently re-classifying a closed Done report. The UI never offers these on closed rows (`closed ? "" : issueButtons(i)`), so this needs a forged or stale JSON call, and only team members can make it. But it pollutes the add-only history.
- Fix: in `act()` refuse (outcome `changed`) unless `from` is `new` or `looking`; and reject `from === to`. One test each.

### 4. Minor: unchecked reports inflate "N others reported this" on checked rows
- `queue.ts` `others` subquery counts `o.state in ('new','looking')` with no `token_checked` condition. Probe P5: one checked `photo_private` row plus one unchecked one shows "1 other reported this" on the checked row.
- Spec says "other open reports in the same group"; it does not exempt unchecked ones, so this is arguably per spec. But unchecked rows are, by the spec's own words, "some may not be real", and the number is what the team uses to judge a report's weight.
- Fix (judgement): count only `token_checked is distinct from false`, or show unchecked others separately. At least pin whichever is intended with a test (T7-3 does not cover it).

### 5. Minor: the Issues lists have no cap
- `listIssues` reads every open issue row (`issueRows(... 'new','looking' ...)` with no limit); the unchecked group is part of that. The welfare queue deliberately caps its unchecked list ("Showing the newest N of M", `queuePage.ts` `uncheckedSection`) because an outage is when floods arrive. The Issues section, and the JSON route, grow without bound, and each row also runs the `others` subquery.
- Fix: cap the unchecked group (and ideally the open groups) with a "Showing the newest N of M" line and a total count, as the closed list already does.

### 6. Minor: the cat-page strip links can land nowhere or on a collapsed row; its count is capped
- `catPages.ts` `issueStrip` links every report to `/api/team#r-<id>`. The queue only draws the newest 50 closed rows (`CLOSED_LIMIT`), so a link to an older closed report goes to the top of the page. Closed rows are `<details>` and a bare hash does not open them.
- The heading shows `(${issues.length})`, capped at `STRIP_LIMIT` 50, so a cat with 60 reports says 50.
- Fix: link to a per-report anchor that the page can open (e.g. `?issue=view&r=<id>` handled like the notice), and count with a separate `count(*)`.

### 7. Minor: test gaps (a plausible bug would pass)
Verified by reading all 20 tests; the builder's probes cover the headline guards. Untested:
- `HIDE_SKIPPED` words ("Not hidden: daily brake ...", etc.): T7-2 seeds `hideSkipped` of `brake` and `unchecked` but never asserts a word, so swapping or breaking the labels passes. The plan lists "hide_skipped in words" as a deliverable.
- The `no_photo` outcome (keep-hidden on a report with no photo) and the 400 for a missing or invalid `from`.
- `hide` on a deleted-for-good photo (answers `already_hidden`, relied on instead of the database trigger).
- Concurrency: nothing runs two actions at once. I did, by hand: two simultaneous Keep hidden gave `kept` and `changed` with one state event; Keep hidden/Restore on two reports sharing a photo plus a colleague's restore on the cat page gave one restore event in total. So the code is right; the test file would not notice if the photo lock were dropped.
- A team member's own Hide not counting toward the brake (only `report:` authors count); the brake count test seeds report-authored rows only.
- The strip is tested for a guardian only at function level (`issueStripFor` with a guardian's scopes). That is the right unit today, because a guardian currently gets a 403 on the whole team cat page (the test at line 157 shows it), but when SYC-53 opens that page to guardians the route-level case needs adding.
- The `!can(hide_photo)` branch in the issue-photo route cannot be reached by any current role (team and management hold both), so it is untested and effectively dead until a role splits them. It is correct per spec; just note it.

### Nits
- The brake banner is drawn inside the Issues section at the foot of the page, under every welfare report, though it affects the whole island; plan puts it in the section, so this is faithful, but easy to miss.
- A photo hidden by a report, restored by the team, then hidden again by hand still sits in "Hidden, waiting for you" (`hidden_by_report` stays true). Harmless.
- `renderQueuePage` now takes 11 positional arguments; an options object would stop a swapped pair slipping through.
- `queue.ts`/`teamActions.ts` import `reasonLabel` from the email module (`lib/issues/alertEmail.ts`); the labels belong in a shared file.
- The brake can also "skip" when the advisory lock times out (`hide.ts`, skip("brake")); the banner cannot show that. Not a disagreement about the count, just worth knowing.

## Judgement of the builder's four deliberate calls
1. **Hide offered on any open row whose photo is public.** Good. The place a manual Hide matters most is a `photo_private` report that did NOT hide (brake, restored before, unchecked, address limit), which the plan's two-reason list would leave without a button. The server does not restrict by reason or by open state, which is fine for a team member with `hide_photo`. Update the spec §5.4 table to match.
2. **Count as a line on the Queue page, not a top-bar badge.** See finding 1. Not accepted as is.
3. **Restore on an already-public photo writes nothing.** Correct and consistent with plan review finding 13 (`not_hidden`, no event, no close). One usability cost: the second of two reports on the same photo can then only be closed with the generic buttons (finding 2's buttons), so the wording of the "Nothing changed" message could point to them.
4. **Closed issues listed, folded.** Fine; see finding 6 for the anchor consequence.

## Checked and found correct
- Cat guardian, even with the reported cat in her colony: `/api/team`, `/api/team/issues`, `/api/team/issue-photos/:id`, the three POST routes and the alert's cat-page link all refuse before any lookup (`requireTeam` with no target answers for island rows only; `view_welfare_queue`, `hide_photo`, `restore_photo` are island/TEAM in `capabilities.ts` 59, 111, 112). The 403 is identical for a missing or existing report, so there is no existence oracle. `?issue=`/`?r=` are only ever rendered on a page she cannot load.
- The strip: `issueStripFor` checks `view_welfare_queue` itself; the cat page route passes it a full `PersonWithScopes`.
- Reporter details: `issueRows` selects no device, contact, language or address column; the JSON key list is pinned by T7-6; the reported photo is a team-route URL only.
- Photo route: serves only a sent (`is_draft = false`), `kind = 'content'` report's photo; welfare and draft ids give 404; removed photo gives 410; `no-store`, `nosniff`, image-type allow-list; bytes read only after the checks.
- Races (my probes P1, P2, plus the existing stale-page test): single state event, single restore event, no double hide. Lock order is report row, then photo row, in `teamActions.ts`; `hide.ts` takes the photo lock only on its own just-inserted report row; `setPhotoVisibility` takes only the photo lock. No cycle found.
- Keep hidden refuses a restored photo (`!photo.hidden`); Restore refuses a removed photo and an already-public one; Hide on a removed photo answers `already_hidden`. No action touches a welfare row or a draft (`lockIssue` filters `kind = 'content' and is_draft = false`; also in `moveReportStateIn`). No `welfare_outcome` observation is written for an issue close.
- Order of groups, "never above a welfare report" for the section itself, grouping rules and the `others` SQL match the spec (same photo+reason, or no-photo rows by cat+reason; open, non-draft, `o.id <> r.id`). Longest-wait-first for group 1, newest first for the rest.
- Brake: banner and hide use one function pair (`reportHidesToday`, `brakeTripped`), and the Athens-day window is the single copy in `hide.ts`; no resume route exists (T7-5 walk test).
- Output: every dynamic value goes through `esc`; redirect target is built from a fixed enum plus `encodeURIComponent`; `issueNotice.key` is checked with `Object.hasOwn` before use and never echoed. Wording grep: no "snapper" or "colony carer" in the new files.
- Plan items present: capability gating, photo route, four groups, "Issue" label plus colour band, rows' fields, banner, three actions, links to the cat page's own forms, no "Which cat is this?", the strip, T7-1 to T7-6, and the walk rows.
