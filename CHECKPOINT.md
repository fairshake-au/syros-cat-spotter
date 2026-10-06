# CHECKPOINT: SYC-43 part 2, PR 1 (branch claude/syc-43-pr1-welfare-queue)

Plan: docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md, "### PR 1".
Resume from the last commit on this branch. Never push anywhere else. Local Postgres only.

## How to run tests
    service postgresql start        # postgres/postgres
    pnpm install --frozen-lockfile
    export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
      AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key
    pnpm --filter @workspace/db test
    pnpm --filter @workspace/api-server test
    pnpm run typecheck:libs && pnpm --filter @workspace/api-server run typecheck
    pnpm --filter @workspace/db run migrate:check

Baseline on origin/main (fc3def6): db 207 tests, api-server 685 tests, all green.

## Items
1. [x] Migration 0008_welfare_queue + schema + P1-9 + P1-10 (repoint P0-4; stand-in history_probe removed from peopleLeft.test.ts and people/cli.test.ts)
2. [x] Page frame lib/teamPages (layout, shared escapeHtml), CSP img-src 'self' (P1-5)
3. [x] listWelfareQueue() + GET /api/team/reports JSON (P1-2, P1-4)
4. [x] Queue page, mail banner (P1-6, P1-7, P1-8)
5. [x] Team photo routes (P1-3)
6. [ ] Route walk test (P1-1)
7. [ ] Browser check + screenshots in docs/screenshots/syc-43-pr1/
8. [ ] Final: prettier, all suites, push

## Mutation probes (record: mutation -> tests red)
- P1-10: declared welfare_reports.state_changed_by FK `ON DELETE set null` in 0008 SQL -> red: P1-10 (state_changed_by case). Restored.
- P1-8: removed escapeHtml on the reporter's note in queuePage.ts -> red: P1-8. Same for the team note, and for the state-changer's name (who()). Each restored.
- P1-5: added `script-src 'self'` to setTeamHeaders CSP -> red: all 7 P1-5 tests. Restored.

## Deviations
- Migration SQL: added `USING "state_changed_by"::uuid` (Postgres has no automatic text->uuid cast, even on an empty table), a LOCK TABLE before the empty-assert, and a rollback that refuses once report_state_events / team notes hold history (plan said just "drop both").
