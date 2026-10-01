-- hosting-and-photo-storage.md §6.2 item 1 (SYC-98): unguessable photo ids.
--
-- Redesigned after the Neon move (SYC-121): the original version of this
-- migration used a single self-filling
-- `ADD COLUMN ... NOT NULL DEFAULT gen_random_uuid()::text` because, at the
-- time, Replit's Publish step diffed dev/prod schemas and applied the
-- difference itself, independent of this repo's `migrate` runner, and
-- couldn't run a custom backfill statement. Production migrations now go
-- through the runner exclusively (the `db-ops` GitHub Actions workflow,
-- `migrate` then `verify`, before the Replit project republishes) — see
-- docs/superpowers/plans/syc-121-neon-switchover.md §A.4. The runner can run
-- arbitrary SQL in one transaction, so this goes back to the standard
-- additive shape: add the column nullable, backfill existing rows
-- explicitly, then tighten to NOT NULL and add the unique index. The
-- backfill is idempotent (`where public_id is null`), so re-running it
-- (migrate is otherwise journal-guarded and only applies a file once, but
-- this guards against a hand re-run too) touches only rows that still need
-- a value.
--
-- The column still defaults to gen_random_uuid()::text (built into Postgres
-- core since v13, no extension needed) so every future insert gets one for
-- free — the application (artifacts/api-server/src/routes/sightings.ts)
-- inserts a photo row without specifying public_id and relies on this.
--
-- Locking / rewrite notes (asked for in SYC-98, still true under this
-- shape): gen_random_uuid() is VOLATILE, so Postgres can't do the fast
-- metadata-only add a constant default gets. The backfill UPDATE visits and
-- rewrites every existing row to give each one its own distinct value. This
-- table is small (one island's photo catalogue — 52 rows in production
-- today), so that's a brief lock, not an outage. All pending migrations run
-- in one transaction (README.md), so `CREATE UNIQUE INDEX CONCURRENTLY`
-- isn't available here either way; this table's size makes that moot.
ALTER TABLE "photos" ADD COLUMN "public_id" text;--> statement-breakpoint
UPDATE "photos" SET "public_id" = gen_random_uuid()::text WHERE "public_id" IS NULL;--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "photos" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_public_id_unique" ON "photos" USING btree ("public_id");

-- rollback-begin
-- DROP INDEX "photos_public_id_unique";
-- ALTER TABLE "photos" DROP COLUMN "public_id";
-- rollback-end
