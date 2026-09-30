# Migrations

Every schema change reaches a database through a file in this folder (SYC-64, `docs/specs/hosting-and-photo-storage.md` §5.2). `drizzle-kit push` is not used.

**To change the schema:**

1. Edit `lib/db/src/schema/`.
2. `pnpm --filter @workspace/db run generate --name <what_it_does>` (needs `DATABASE_URL` set, as the Drizzle config requires it, though generating doesn't connect)
3. Read the generated SQL. At the end of the file, add the undo as commented SQL:

   ```sql
   -- rollback-begin
   -- DROP TABLE "observations";
   -- rollback-end
   ```

   Every line between the markers must be commented. An uncommented line would run on the way up, so the runner refuses the file. Additive changes undo trivially. For anything destructive, write and review the rollback before the forward step runs.
4. `pnpm --filter @workspace/db run migrate` to apply it locally. `pnpm --filter @workspace/db test` proves each rollback restores the previous schema.
5. Commit the `.sql` file and `meta/`. `migrate:check` (CI, and locally with `DATABASE_URL` set) fails on any of these:
   - the schema code has changes no migration captures;
   - running the SQL builds something different from what the schema code describes (it builds one scratch database from the migrations, one with `drizzle-kit push`, and compares them). So tables, columns, indexes and constraints must be declared in the schema code, not only written into a migration. Triggers, functions and views are the exception: the schema code can't express them, so they live only in migration SQL;
   - a rollback is missing or has an uncommented line;
   - a `.sql` file isn't in the journal.

All pending migrations run in one transaction, and each waits at most `MIGRATE_LOCK_TIMEOUT` (default `5s`) for a table lock before the whole run rolls back. `CREATE INDEX CONCURRENTLY` can't run inside a transaction, so it can't be used here.

**Never edit a migration after it has been applied anywhere.** The runner compares hashes and refuses. Put the change in a new migration.

**If your branch's migration is older than one already merged**, the runner refuses it rather than skipping it. Delete your file and its `meta/` entries, then run `generate` again on top of the current history.

`0000_baseline.sql` is the schema as `push` left it. On a database that already has those tables, `migrate` records the baseline as applied only if the live schema matches it exactly. The baseline is never rolled back.

**If `migrate` refuses the development database** ("cannot be adopted", or "the database is ahead of this code"), the post-merge hook and the api-server tests will fail until it's fixed. Since SYC-121, this is the Neon `development` branch, not a database Replit manages — it's disposable the same way: reset it from `production` (Neon console → Branches → `development` → **Reset from parent**), then run `migrate`. **Never do this against production.** There, fix the drift by hand, guided by the differences `migrate` prints.
