# CHECKPOINT — SYC-43 part 2, PR 0 (marking people as left)

Branch: `claude/cool-dijkstra-7q3jsh`, off `origin/main` d2768cc.
Plan: `docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md`, "Decision 7's knock-on".
Delete this file before merge.

## Done
- [x] Migration `0007_people_left` (generated): `people.left_at`, `people.left_by`. Rollback refuses while anyone is marked as left.

## Next
- [x] `people.ts`: both readers refuse left; `markLeft`; `addPerson` rejoins (roles replaced, name updated, added_by kept); `removePerson` maps FK refusal (23503) to "has history". Store tests P0-2..P0-5 in `lib/db/src/migrate/peopleLeft.test.ts`.
- [x] CLI: `mark-left` (confirms address), `list` shows LEFT + header count, `add` says "Rejoined". Tests in `cli.test.ts`.
- [x] Tests P0-1 (`artifacts/api-server/src/routes/team.left.test.ts`), P0-2..5 (`lib/db/src/migrate/peopleLeft.test.ts`).
- [ ] Mutation probes, recorded below.
- [ ] PR, adversarial review, SYC-43 comment, SYC-131 update.

## Local test setup (cloud container)
`service postgresql start`; env: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres,
AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9, AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key.
