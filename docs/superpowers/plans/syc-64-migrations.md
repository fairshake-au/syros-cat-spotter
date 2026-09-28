# SYC-64 implementation plan: generated migrations with a checked-in history

**Spec:** `docs/specs/hosting-and-photo-storage.md` §5.2 (approved 28 Sep 2026, `DECISIONS.md` Part 2e), and `DECISIONS.md` F6.
**Why now:** it is the first link in the chain for SYC-42 and SYC-43. The welfare queue, the data spine and email capture add about twelve tables between them, and F6 says none of them arrives through `drizzle-kit push`.

## In plain English

Today the database is changed by a command that compares the code with the live database and edits the database to match. It leaves no record of what it did, and nothing can be undone. That has already broken every endpoint once.

After this change:

- Every schema change is a SQL file in `lib/db/migrations/`, generated from the code, reviewed in the pull request and committed.
- One command, `pnpm --filter @workspace/db run migrate`, applies whatever the database hasn't had yet and records it.
- Every migration after the baseline carries its own undo, and CI proves the undo works by running each migration up, down and up again.
- CI fails if the schema code and the migration files disagree, which is the exact drift that caused the incident.

## What gets built

| Spec §5.2 item | What lands |
|---|---|
| 1. Adopt `drizzle-kit generate`; remove `push` and `push-force` | `generate` script writes to `lib/db/migrations/`. Both push scripts are removed. The four places that call push (`scripts/post-merge.sh`, api-server `pretest`, CI and the drift memory note) switch to `migrate`. |
| 2. A `migrate` script that records what it applied | A small runner in `lib/db/src/migrate/`. It uses Drizzle's own bookkeeping table (`drizzle.__drizzle_migrations`), so `drizzle-kit` tooling still reads it. All pending migrations apply in **one transaction**: a failure leaves the database exactly as it was. |
| 3. A baseline migration | `0000_baseline.sql`, generated from the current schema. |
| 4. Every migration ships a rollback | A `-- rollback-begin` / `-- rollback-end` block of commented SQL in the same file. `migrate:check` fails any migration after the baseline that lacks one. `migrate:rollback` undoes the most recent migration in a transaction and removes its record. The baseline refuses to roll back. |
| 5. Rollback exercised, not assumed | `migrate:cycle` runs in CI: apply one at a time, recording the schema after each, then roll each back and compare the schema with the recorded one, then apply again. The **production-shaped dump** run before the Play window is Samuel's step. It needs production access and is listed below. |
| 6. Migrate first, then deploy | Documented in `docs/DEPLOYMENT.md`. |
| 7. Smoke test after every migration | `pnpm --filter @workspace/db run smoke <base-url>`: `GET /api/healthz`, `GET /api/cats`, and `GET /api/photos/:id` for a real photo. **Deviation, flagged:** the spec also names `POST /api/sightings`. That creates a real sighting in production and makes a paid AI call on every run, so the smoke test leaves it out. The GETs exercise every table the POST reads, apart from `sightings` itself. |
| 8. CI enforces it | `migrate:check` fails if generating from the schema code produces anything new. It also fails if a database built by running the migrations differs from one `drizzle-kit push` builds from the schema code (so a hand edit to a migration's SQL can't slip through), if a rollback is missing or has an uncommented line, or if a `.sql` file isn't in the journal. |

## Two safety rules the runner adds, beyond the spec

1. **Adopting the baseline on a database that already has tables.** The Replit dev database, and production if it was deployed with `push`, already contain the schema but have no migration record. Running the baseline against them would fail on `CREATE TABLE`, and marking it applied without checking would hide drift. So the runner builds the baseline inside a throwaway schema, **in a transaction it then rolls back**, and compares it with the live `public` schema. The comparison covers tables, columns (including length, precision, collation, identity and generated expressions), indexes (including validity), constraints, enums, sequences, views, triggers and functions. It records the baseline as applied only if they match exactly. If they don't, it stops and prints the differences. Nothing is written in either case until they match.
2. **No silently skipped migrations.** Drizzle's stock migrator applies only files newer than the last one recorded, so a branch merged with an older timestamp is skipped without a word. Before applying anything, the runner checks every recorded migration against the journal and its hash. It refuses a pending file older than the newest one applied, a file edited after it was applied, and a database that is ahead of the code. Each refusal names the file.

## Out of scope

- Production steps that need Samuel's access. Run `migrate` once against production to adopt the baseline. Then run the up–down–up cycle against a scratch copy of a production dump and record the date in `docs/DEPLOYMENT.md`.
- Every table from the other specs. Each arrives later as its own generated migration.

## Tests

- Runner unit tests against a real Postgres (vitest, `lib/db`): a fresh database applies the baseline; a matching existing database adopts it without running it; a drifted database is refused and the differences are named; a skipped migration and an edited migration are caught; rollback removes the record and the objects; the baseline refuses to roll back; a failing migration leaves nothing behind.
- The existing api-server suite runs against a database built by `migrate`, not `push`.
