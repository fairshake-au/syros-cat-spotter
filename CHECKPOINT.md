# CHECKPOINT — SYC-43 part 2, PR 0 (marking people as left)

Branch: `claude/cool-dijkstra-7q3jsh`, off `origin/main` d2768cc.
Plan: `docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md`, "Decision 7's knock-on".
Delete this file before merge.

## Done
- [x] Migration `0007_people_left` (generated): `people.left_at`, `people.left_by`. Rollback refuses while anyone is marked as left.

## Next
- [ ] `people.ts`: `findPersonById`/`findAllowedPerson` refuse left; `markLeft`; `addPerson` rejoins; `removePerson` maps FK refusal to "has history".
- [ ] CLI: `mark-left`, `list` shows left.
- [ ] Tests P0-1..P0-5 with mutation probes recorded.
- [ ] PR, adversarial review, SYC-43 comment, SYC-131 update.

## Local test setup (cloud container)
`service postgresql start`; env: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres,
AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9, AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key.
