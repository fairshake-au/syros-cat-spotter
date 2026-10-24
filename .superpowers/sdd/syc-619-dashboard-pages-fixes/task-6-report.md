# Task 6 report: People rows (spec 4.1)

Status: DONE. Commits: a86840f6 (work), then a checkpoint commit.

## Changes
- lib/people/screen.ts: PersonView.shortRoles (new shortRolesOf(): Management beats Team; guardian appends ", cat guardian", alone is "Cat guardian"); joined timing now "Since D Month YYYY." (only consumer of PersonView.timing besides the bring-back page, which shows left people, unaffected; no emails read it).
- lib/teamPages/peoplePages.ts: card(p, open) draws details.person#p-ID > summary (name, chip, short role, min-height 56px, no marker) + .pbody (today's body, own-row hint unchanged); renderPeoplePage gains openId (only People tab rows open; Left tab never); Done gains personId; Joined-in-last-7-days links are ?open={id}#p-{id}.
- routes/teamPeople.ts: doneFrom sets personId only after proof (bare ?done= or unproved opens nothing); ?open= accepted only if isPersonId (same check as /roles), lower-cased.
- routes/team.people.test.ts: card() helper now slices from the details tag to the closing div+details; 7th-day link assertion loosened to the new href; new describe "People are short rows that open" (6 tests).

## TDD
RED: after adding tests (before implementation) team.people.test.ts: 13 failed / 47 passed. Caveat: the card() helper change made old tests fail too, so RED mixed new and helper-driven failures; new tests failed because no details.person existed.
GREEN: vitest run team.people.test.ts team.people.noColonies.test.ts layout.test.ts colonyPages.lead.test.ts: 4 files, 120 passed.
Full: vitest run src/lib/teamPages src/routes: 161 files passed, 1 failed (routes/profiles.usernames.test.ts, unrelated: 18/18 pass alone, mail SEND FAILED noise under load). tsc --noEmit: no errors.

## Tests updated on purpose
Only team.people.test.ts: helper for the new markup, and the 7-day link assertion. layout.test.ts needed no change (marker test still passes: details.person has no marker). No other test pinned the old card markup or "Joined D" text.

## Concerns
- profiles.usernames flake in the full run (passes alone); not investigated further.
- RED evidence is muddied by the helper change (above).
- Not browser-checked at 390px/desktop; PR needs a visual pass.
- Left cards have empty shortRoles so no role span in their summary.

## Fix round 1
- peoplePages.ts: the "Joined in the last 7 days" heading and list are drawn only when recent is non-empty (no empty-state line).
- New src/lib/teamPages/peoplePages.rows.test.ts: absent with recent: [], present with ?open= link with one person; shortRolesOf cases (Management, cat guardian / Management / Team, cat guardian / Cat guardian / empty).
- colonyPages.lead.test.ts: removed the one assertion that needed the heading with an empty list (ordering is still covered by the new tests and the people route test).
- Command: pnpm exec vitest run src/routes/team.people.test.ts src/routes/team.people.noColonies.test.ts src/lib/teamPages/peoplePages.rows.test.ts src/lib/teamPages/colonyPages.lead.test.ts src/lib/teamPages/layout.test.ts
- Output: Test Files 5 passed (5); Tests 123 passed (123).
