# Task 7 report: Areas as short rows, busiest first (SYC-619 PR2, spec 4.2, D5)

Status: DONE (with concerns below).

## Test evidence (from artifacts/api-server, with scratchpad testenv.sh)
- Red: `pnpm exec vitest run src/routes/team.areas.test.ts` -> 6 failed | 17 passed (the six new tests; busiestFirst, arearow, open-on-error, fold line, method fold, real-page fold).
- Green: same file plus `src/lib/teamPages/layout.test.ts` -> 2 files, 74 passed.
- Final: `vitest run src/lib/teamPages src/routes` -> 162 files passed, 1 failed: `profiles.usernames.test.ts` "still updates profile and leaderboard after an authenticated rename". It passed when re-run alone (with backLinks.test.ts, 33 passed). It does not touch areas; I did not investigate the cause.
- `tsc --noEmit -p .` clean.

## Files changed (artifacts/api-server/src)
- lib/areas/areaHistory.ts: `AreaChange.version` added from the existing query (`row_number() over (order by id)`, counted over all named_area rows before the limit, so an old row keeps its number).
- lib/teamPages/areasPage.ts: `<li><details class="arearow">` rows (open when rename/move/retire came back with an error for that key), `historyList(history, firstVersion)`, intro and footer moved into `methodFold([...])`, own `<style>` (48px summary, no marker; `details.arearow` not added to the marker rule), `firstVersion` option, `day` date formatter.
- routes/teamAreas.ts: exported `busiestFirst` (cats desc, then `localeCompare(..., "en")`), passes `firstVersion`.
- Tests: routes/team.areas.test.ts (6 new, 3 old updated), lib/teamPages/backLinks.test.ts (new required `firstVersion` option, type only).

## Old tests changed on purpose
In team.areas.test.ts: `<h3>Kini</h3>` became `<summary><strong>Kini</strong>`; "nearest this centre" became a "N cats" span check; the "not.toContain h3 of retired area" became the summary form. Reason: the markup moved from cards to rows.

## Decisions and concerns
1. **"First version" does not exist as one version.** Each seed row is its own change (versions 1..21; the page says "the seed is 21"). So the fold is every row with `version <= firstVersion`, where the route passes `SEED_AREAS.length` (21). It is by version, not by `who`. If the seed size ever changes, that constant must follow.
2. The history query is limited to 50 rows. With 21 seed rows plus more than 29 later changes, some seed rows fall off and the fold line would say fewer than 21. The line counts the rows shown. Not changed.
3. The old "N cats nearest this centre" line is gone; the closed row shows "N cats" and the fold explains "nearest". The hint text is verbatim in the fold.
4. Day format is `15 Oct 2026` (Europe/Athens, as the existing `when`). The folded line is the last (oldest) item.
5. Process slip: my first test edit landed in the primary checkout by a wrong cwd. I moved the diff into the worktree and restored the primary (`git status` there shows only the pre-existing untracked .claude/launch.json). Nothing was committed there.
6. Not checked in a browser at 390px and desktop; tests only.
