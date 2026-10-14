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

**To check a database's migration history** (read-only, safe on production): `pnpm --filter @workspace/db run migrate:history`, or for Neon `production`, `db-ops -f command=verify-history` (`docs/runbooks/neon-database.md`). It fails if a migration is missing, extra, edited after it was applied, recorded twice or applied out of order (SYC-178).

**Never edit a migration after it has been applied anywhere.** The runner compares hashes and refuses. Put the change in a new migration.

**If your branch's migration is older than one already merged**, the runner refuses it rather than skipping it. Delete your file and its `meta/` entries, then run `generate` again on top of the current history.

`0000_baseline.sql` is the schema as `push` left it. On a database that already has those tables, `migrate` records the baseline as applied only if the live schema matches it exactly. The baseline is never rolled back.

**Rolling back in production: app code first, then the database — or not at all (SYC-98, Fable review).** The app currently running, not the one being deployed, decides whether `migrate:rollback` is safe. New code that depends on a migration (selects a column it added, say) 500s immediately once that column is gone — of the three states (old code + new schema, new code + new schema, new code + old schema), only the last one is actually broken. So: roll the app back first (republish the previous build), **then** `migrate:rollback` — or, since a migration sitting ahead of old code is usually harmless by itself (additive changes don't touch what old code reads), consider leaving it in place and shipping a code fix forward instead of rolling the schema back at all. Either way, a re-`migrate` after a rollback re-runs the migration from scratch: for one like SYC-98's `0002` that mints a random value per row (`gen_random_uuid()`), every row gets a *new* value, so anything handed out between the original migration and the rollback (a `public_id` in a URL someone already has, for instance) stops working.

**If `migrate` refuses the development database** ("cannot be adopted", or "the database is ahead of this code"), the post-merge hook and the api-server tests will fail until it's fixed. Since SYC-121, this is the Neon `development` branch, not a database Replit manages — it's disposable the same way: reset it from `production` (Neon console → Branches → `development` → **Reset from parent**), then run `migrate`. **Never do this against production.** There, fix the drift by hand, guided by the differences `migrate` prints.

**After a Postgres major upgrade or an ICU change on Neon (SYC-101).** `cats.normalised_name` is a stored column the database folds with `normalize()` and ICU lower-casing, so it keeps the values computed under the old Unicode tables. Greek and everyday Latin never change. Only letters added in recent Unicode versions can fold differently afterwards (see the list in `lib/db/src/foldSql.test.ts`). After such an upgrade, check on a **throwaway branch restored from `production`, never on production itself**: `BEGIN; UPDATE cats SET name = name; ROLLBACK;` recomputes every folded name. If it fails on `cats_normalised_name_unique`, two names now clash. Have the team rename one before anything else rewrites `cats`, because a dump and restore would hit the same failure.
