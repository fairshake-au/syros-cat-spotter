# SYC-150 PR 2.1 checkpoint

Branch: claude/syc-150-pr2.1-migration. Migration: lib/db/migrations/0053_moves_merges_duplicates.sql

## Done
1. Schema + generated DDL + rollback (migrate:check ok, runner.test ok, typecheck 0/0/0).
2. awardPoints scoped + lib/pointsLedger.test.ts.
3. Triggers in 0053 + rollback; signature.ts modelledOnly skips constraint triggers (contype t). migrate:check ok, runner cycle ok.

4-5. lib/db/src/migrate/whichCatIsWhich.test.ts: 28 tests, all pass (legit paths + refusals + 16a race + C4 index + C5 kinds).

## Next
api-server suite for existing merge tests (deferred check). 6. Mutation probes. 7. Full suites. 8. Draft PR.

## Notes
- Existing api-server tests insert merges over cats that still have resolved sightings; the deferred check (item 3) will refuse those. Plan: a test helper doing a recorded merge.
