# SYC-410 PR 1.1 checkpoint

Branch: claude/syc-410-pr1.1-cat-identity

Done:
1. lib/catIdentity.ts + catIdentity.test.ts; canonicalCats removed from capabilityTargets (teamMy, guardianStatements moved).
2. Readers on the module: loadCatRecords, claiming (merged-away + hasMetCat), teamCatList, coatReading/due. Only comments mention cat_identity elsewhere. Typecheck 0/0/0; 11 affected files green.
3. catIdentityGuard.test.ts (source scan, comments stripped; allowlist = catIdentity.ts + schema).
4. catIdentity.readers.test.ts (6 readers x 4 cases, 24 green) + asOf.test.ts D-cat assertions.
5. Probes done: (a) no supersedes check: 6 readers undo red + 3 unit; (b) one hop: 5 readers chain red (claim stays green, refused either way) + test 16; (g) cat_identity query in claiming.ts: guard red. Restored, green.

Next:


6. Full suite green (6200 passed), typecheck 0/0/0 (proved can fail). Next: 7. Draft PR.

Review fold-in (coordinator, after #375 opened):
- R1 done: standing() = newest merge row per cat decides; undone -> alone (A1, A10, undo-older test).
- R2 done: undo only by a row on the same cat (A2).
- R3 done (it.fails route): resolveAt comment corrected; reviewer attack file kept, A11 it.fails naming PR 3.1.
Next: R4 teamMy catsMergedAway, R5 string-aware stripper, R6 probes+suite, R7 PR body.
