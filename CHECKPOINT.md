# CHECKPOINT: SYC-166 slice 4 (Ermoupoli start)

Branch `claude/syc-166-ermoupoli-start`, worktree `.claude/worktrees/modest-germain-3a3df0`, off origin/main 9665c1b3.
Plan: `docs/superpowers/plans/syc-166-photo-time-and-location.md` "Slice 4".

## Done
- Read plan, review, spec §3.2/§8/§9 test 5, SYC-166 + comments, project P-SYC-54, launch plan.
- Checked: nothing for slice 4 on origin/main.

## Done (cont.)
- island.ts, mapStart.ts, spot.tsx wiring, mapStartedInTown en/el/fr: committed 5696904b. Full cat-spotter suite 1837/1837. Typecheck clean.
- Mutation probes 1-5 (+3b): all RED (scratchpad probe.py).

## Next
1. `lib/island.ts` + test (red first), move rectangle out of `offlineTiles.ts`.
2. `lib/mapStart.ts` + test.
3. Wire `spot.tsx` (resolver, picker key, town line, denied text), `mapStartedInTown` en/el/fr.
4. Mutation probes 1-5; browser check 390px + desktop, en/el/fr; screenshots to `docs/screenshots/syc-166-slice-4/`.
5. Sonnet adversarial review in own worktree; fold in; draft PR; Linear (SYC-166 comment, SYC-346 strings).
