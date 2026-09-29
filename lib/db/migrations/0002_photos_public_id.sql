-- hosting-and-photo-storage.md §6.2 item 1 (SYC-98): unguessable photo ids.
--
-- Deliberately a database-side DEFAULT rather than a nullable column plus a
-- backfill UPDATE (SYC-102): Replit's Publish step diffs the dev and prod
-- database structures and applies the difference itself, independent of
-- this repo's migrate runner, and cannot run a custom backfill statement or
-- an app-level insert hook. A single self-filling
-- `ADD COLUMN ... NOT NULL DEFAULT gen_random_uuid()::text` is correct
-- whichever mechanism ends up applying it in production — see the PR body
-- ("How this reaches production on Replit") for the full reasoning.
--
-- Locking / rewrite notes (asked for in SYC-98): gen_random_uuid() is a
-- VOLATILE function, so Postgres cannot do the fast metadata-only add that
-- a constant default gets — it must visit and rewrite every existing row to
-- give each one its own value, under an AccessExclusiveLock for the
-- duration of the ALTER TABLE. That is unavoidable for "every existing row
-- gets a distinct random token" in a single statement, and it is also
-- exactly what a bare structural diff would run, so there is no cheaper
-- option available that still works under both deployment paths. This
-- table is small (photos for one island's cat catalogue), so the lock
-- window is brief, not an outage. CREATE UNIQUE INDEX CONCURRENTLY isn't
-- available either way: not inside this runner's single transaction, and
-- not through a structural diff.
ALTER TABLE "photos" ADD COLUMN "public_id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_public_id_unique" ON "photos" USING btree ("public_id");

-- rollback-begin
-- DROP INDEX "photos_public_id_unique";
-- ALTER TABLE "photos" DROP COLUMN "public_id";
-- rollback-end
