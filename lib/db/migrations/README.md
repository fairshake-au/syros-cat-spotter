# Migrations

Every schema change reaches a database through a file in this folder (SYC-64, `docs/specs/hosting-and-photo-storage.md` §5.2). `drizzle-kit push` is not used.

**To change the schema:**

1. Edit `lib/db/src/schema/`.
2. `pnpm --filter @workspace/db run generate --name <what_it_does>`
3. Read the generated SQL. At the end of the file, add the undo as commented SQL:

   ```sql
   -- rollback-begin
   -- DROP TABLE "observations";
   -- rollback-end
   ```

   Additive changes undo trivially. For anything destructive, write and review the rollback before the forward step runs.
4. `pnpm --filter @workspace/db run migrate` to apply it locally. `pnpm --filter @workspace/db test` proves each rollback restores the previous schema.
5. Commit the `.sql` file and `meta/`. CI's `migrate:check` fails if the schema code and this folder disagree, or if a rollback is missing.

**Never edit a migration after it has been applied anywhere.** The runner compares hashes and refuses. Put the change in a new migration.

**If your branch's migration is older than one already merged**, the runner refuses it rather than skipping it. Delete your file and its `meta/` entries, then run `generate` again on top of the current history.

`0000_baseline.sql` is the schema as `push` left it. On a database that already has those tables, `migrate` records the baseline as applied only if the live schema matches it exactly. The baseline is never rolled back.
