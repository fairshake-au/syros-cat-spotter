# SYC-53 PR 1.2 checkpoint (builder: Sonnet subagent) - the People screen

Branch `claude/syc-53-pr-1-2`, stacked on `claude/syc-53-pr-1-1` at 6ac26d3. Not pushed, no PR.
(PR 1.1's old checkpoint is in git history of this file.)

## Plan of work
1. lib/db `peopleScreen()` reader (listPeople lacks invite columns for personState).  [done]
2. lib/people/screen helpers (words, history, placements form parsing) + lib/teamPages/peoplePages.ts
3. routes/teamPeople.ts (10 routes under /api/team/people), wired in routes/index.ts, nav link
4. team.walk.test.ts rows
5. routes/team.people.test.ts: T15 per route, chips, 25 October, self-change, no-free-text, no-colonies, language label, history
6. Mutation probes (record red lines below)
7. Browser check 390px + desktop, screenshots in docs/screenshots/syc-53-pr-1-2/
8. Full suites + typecheck, final report

## Done
- 2-5. screen.ts, peoplePages.ts, teamPeople.ts, nav link (AsyncLocalStorage in requireTeam), walk rows, team.people.test.ts (39) + noColonies (2) green.
- 1. peopleScreen reader + export.

## Probe results
(none yet)
