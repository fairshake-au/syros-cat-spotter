# PR 1.2 checkpoint

Local branch pr12-live-cats (worktree agent-a664834b6cc83fc94), push with `git push -f origin HEAD:claude/syc-410-pr1.2-live-cats` (the branch name is held by another worktree).
Scratchpad rt12.sh <log> <test files> runs api-server tests. Heredocs/cd chains are refused by the tool guard: use Edit/Write.

Done:
- 1 helpers liveCats / notMergedAway / observationCatIn + tests
- 2 R1 excludeKinds in loadCatRecords + catIdentity.appearance.test.ts; probe red (drop excludeKinds)
- 3 23 liveCats readers moved
- 4 catsFeeding readers moved (S2-S6,S8,S11,S12,S15,S16,S20,S21,S22,S26, A1,A3,A4,A6, B1-B5)
  - colony rule: own record decides, else newest of merged-in (spec 4.1 "After merging she'll show as Vaporia"); ruling said newest; doubt
  - updated 2 old tests that expected a merged half to stay listed (trappingPlan.test, team.colonyCats.test)

Next: 5 two guards (liveCatsGuard.test.ts, statementsByCatGuard.test.ts, shared helper in src/test/), 6 spec test 15 table-driven tests + totalCatCount, 7 probes, 8 full suite + typecheck proof, 9 draft PR (base claude/syc-410-pr1.1-cat-identity).
