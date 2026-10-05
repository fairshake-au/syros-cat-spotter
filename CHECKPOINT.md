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
- [x] Mutation probes, recorded below.
- [x] Runbook `docs/runbooks/neon-database.md` updated.
- [x] PR #76 opened (draft), subscribed. SYC-43 and SYC-131 commented.
- [x] Adversarial review (Opus, own worktree): nothing blocking. Fixed: removePerson now also refuses someone who wrote observations (no FK on account_id); rollback locks the table before the guard; rollback-order CAUTION + runbook (old app code re-admits leavers).
- [x] Samuel (5 Oct): rejoin audit trail → follow-up SYC-213 (person_events, with SYC-104). P0-4 stand-in accepted → plan's PR 1 gains P1-10 to repoint it.
- [ ] Samuel's go-ahead; delete this file before merge.

## Local test setup (cloud container)
`service postgresql start`; env: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres,
AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9, AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key.

## Mutation probes (each: break the line, run, restore with `git checkout -- <file>`, confirmed clean)
| # | Mutation | Red |
|---|---|---|
| M1 (P0-1, plan's) | `findPersonById` without the left_at check | hand-off, requireTeam (Worker stays green) |
| M2 (P0-1, plan's) | `findAllowedPerson` without the left_at check | Worker's question |
| M3 (P0-2, plan's) | `markLeft` without the session_version raise | P0-2 + 3 others |
| M4 (P0-3) | `addPerson` treats a left address as "already on the list" | P0-3 (2 tests) |
| M5 (P0-3) | rejoin doesn't clear left_at/left_by | P0-3 (2 tests) |
| M6 (P0-3) | rejoin doesn't raise session_version | P0-3 main test |
| M7 (P0-4) | `removePerson` doesn't reword the FK refusal | P0-4 store + CLI |
| M8 (P0-5) | rollback doesn't drop left_by | P0-5 up/down/up |
| M9 (P0-5) | rollback without the "someone has left" guard | P0-5 guard test |
| M10 (CLI) | `list` doesn't mark left people | CLI list test |
| M11 (P0-4) | `removePerson` without the observations check | P0-4 observation test |

Full suites after: db 206 passed, api-server 631 passed, migrate:check ok, typechecks clean.
