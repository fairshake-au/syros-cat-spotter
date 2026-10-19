# SYC-396 PR 2.2 checkpoint: the Colonies list, with progress and flags

Plan: `docs/superpowers/plans/syc-396-phases-2-4.md`, "PR 2.2". Worktree `.claude/worktrees/modest-germain-3a3df0` (Samuel chose it, 19 Oct), local branch `claude/gallant-cori-d2f434`, pushed as `claude/syc-396-pr-2-2`. Branched at `origin/main` `fe36a3b7`.

## Done
- Read the plan, spec §9.1/§9.5/§10.2/§12.2/§13, SYC-396, SYC-463, P-SYC-54, the launch plan, and the code 2.2 builds on.
- Local test runner (esbuild/rollup workaround). Baseline: team.colonies + guardianView.source 73/73.

## Decisions within the plan (to note in the PR; also on SYC-396)
- `ColonyFigures.guardianNames`: people placed on the colony now, not left. A guardian-created colony has a placement but a blank typed name.
- `markBar` takes optional words, so a guardian's legend uses `colonies.mark.*`.
- Card's cat count = active cats (not "No longer with us") from `loadTeamCats`.

- Task 2.2.1 done (cd9640d2): colonyFigures + 20 tests; probes red: island check on 300 m, colonyFilter on the colony list.
- Task 2.2.2 code done (57ed1454, 98c5a5cc + guardian test): strings en/el/fr, markBar words, cards, sort, Feeding sites link, fallback.
  Probes red: sort ignored, nulls-last, route try, FILTERED_MODULES, route island flag.

## Next
- Screenshots 390/1280, team + guardian, en + el/fr (via liveLanguages seam or note), docs/screenshots/syc-396-pr-2-2/.
- Affected test files re-run together; typecheck.
- Sonnet adversarial review in its own worktree; draft PR; Linear (SYC-396, SYC-346 strings, deferred tickets).
