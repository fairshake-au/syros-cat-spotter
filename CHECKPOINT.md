# SYC-150 PR 2.1 checkpoint

Branch: claude/syc-150-pr2.1-migration. Migration: lib/db/migrations/0053_moves_merges_duplicates.sql

## Done
1. Schema + generated DDL + rollback (migrate:check ok, runner.test ok, typecheck 0/0/0).
2. awardPoints scoped + api-server lib/pointsLedger.test.ts.
3. Triggers in 0053 + rollback; signature.ts modelledOnly skips constraint triggers (contype t). migrate:check ok, runner cycle ok.
4-5. lib/db/src/migrate/whichCatIsWhich.test.ts: 29 tests, all pass.
4b. api-server test/merges.ts mergeKeepingSightings: 8 existing tests wrote old-shape merges; now insert with the deferred check off. 9 merge-writing files: 322 pass.
6. Mutation probes (tree clean before and after each; logs in scratchpad probe-*.log):

| Probe | Mutation | Went red |
|---|---|---|
| P1 | move branch: drop sighting_move_is_current() | 7 refusal tests (forged/no setting, older row, savepoint, other sighting/cats, merge refusals, status-move re-cat) |
| P2 | helper: drop move row txid check | refuses the setting naming an older move row |
| P3 | helper: drop merge row txid check | refuses a merge's setting naming an older merge row |
| P3b | helper: drop merge path move-row txid check | refuses a fresh merge row whose move row was written earlier (test added after probe) |
| P4 | move branch: drop every-other-column check | refuses any other column changing in a move |
| P5 | tighten move branch (cat_id not exempt) | 7 legitimate tests (move, savepoint move, batch, merge+undo, ...) |
| P6 | tighten merge branch (no undo) | accepts a merge ... and its undo |
| P7 | merge branch: drop from/to = merge row's cats | refuses a merge whose sighting has ... a move row for other cats |
| P8 | merged-away trigger disarmed | refuses filing under a merged-away cat; 16a |
| P9 | merged-away trigger: drop FOR SHARE cat lock | 16a (merge commit resolved instead of rejecting) |
| P10 | deferred check: drop FOR UPDATE cat lock | 16a |
| P11 | deferred check disarmed | refuses at commit a merge that leaves a resolved sighting; 16a |
| P12a-d | observations insert branch: whole check / setting / txid / sighting | refuses one with no setting, an older move, or another sighting's move (each sub-case; fresh-no-setting case added after probe) |
| P13 | drop sighting_moves_append_only | sighting_moves: refuses an update other than redaction |
| P14 | drop cat_identity guard | cat_identity: refuses an update other than redaction |
| P15-17 | drop each duplicate-table guard | duplicate_reports/decisions/new_cat_checks: add-only |
| P18 | redaction: drop "person cleared" | sighting_moves refusal (after adding the rename-while-stamping case) |
| P19 | once-a-day index back unscoped | db C4 test; api-server pointsLedger.test (both tests, unique violation) |
| P20 | awardPoints pre-check unscoped | api-server pointsLedger.test (both) |
| P21 | merged-away check ignores undo | accepts a merge ... and its undo |
| P22 | cat_identity_supersedes_own_cat: drop m.cat_id = NEW.cat_id (coordinator addition) | refuses an undo row that supersedes another cat's merge |

Also done: suite fixes (ISLAND_ROLES, dataSpine wording, unfollowSticks wait filter); supersedes guard + test (30 tests in whichCatIsWhich).

## Next
7. Full suites (lib/db, api-server), migrate:check, typecheck. 8. Draft PR.
