# SYC-150 PR 2.1 checkpoint

Branch: claude/syc-150-pr2.1-migration. Migration: lib/db/migrations/0053_moves_merges_duplicates.sql

## Done
1. Schema + generated DDL + rollback (migrate:check ok, runner.test ok, typecheck 0/0/0).

## Next
2. awardPoints pre-check scoped to sighting_id is not null + api-server test.
3. Triggers in 0053 (+ rollback).
4. Legit-path tests. 5. Refusal tests. 6. Mutation probes. 7. Full suites. 8. Draft PR.

## Notes
- Existing api-server tests insert merges over cats that still have resolved sightings; the deferred check (item 3) will refuse those. Plan: a test helper doing a recorded merge.
