-- hosting-and-photo-storage.md §6.2 item 1 (SYC-98): unguessable photo ids.
--
-- Locking / rewrite notes (asked for in SYC-98):
-- 1. ADD COLUMN with no default is metadata-only in Postgres (no table
--    rewrite, no row-by-row work) — safe even on a table holding inline
--    base64 photo bytes.
-- 2. The UPDATE below IS a full-table rewrite in the MVCC sense (every row
--    gets a new tuple version, since every row is changing), but it is the
--    minimum work needed to backfill an unguessable id into every existing
--    row — there's no cheaper way to give N rows N distinct random tokens.
--    It does not rewrite the `data` column's bytes, and it takes ordinary
--    row-level locks rather than a table-level one, so reads and the
--    concurrent photo route are not blocked while it runs.
-- 3. SET NOT NULL takes a brief AccessExclusiveLock to validate every row
--    is now non-null (Postgres 12+ does this as a scan, not a rewrite).
-- 4. CREATE UNIQUE INDEX (not CONCURRENTLY — the migration runner executes
--    everything in one transaction, and CONCURRENTLY cannot run inside a
--    transaction) also takes a brief AccessExclusiveLock while it builds.
--    This app's photo table is small (a charity catalogue for one island),
--    so a non-concurrent index build is a sub-second lock, not an outage.
--    If this table ever grows large enough for that to matter, the fix is
--    to run CREATE UNIQUE INDEX CONCURRENTLY by hand outside this runner
--    before merging, then let generate produce a migration that only
--    confirms the index already exists — not needed here.
ALTER TABLE "photos" ADD COLUMN "public_id" text;--> statement-breakpoint

-- Backfill: mint a random, unguessable id for every existing row. Generated
-- with pgcrypto's gen_random_bytes (OS CSPRNG), not plpgsql's random(), so
-- backfilled ids are exactly as hard to guess as the ones application code
-- mints on insert (lib/photoIds.ts, same 128-bit-of-randomness budget,
-- base62 alphabet, 22 characters). The generating function lives in
-- pg_temp, so it is private to this migration's session and never becomes
-- a persistent database object for migrate:check to compare against the
-- schema code.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint

CREATE OR REPLACE FUNCTION pg_temp.syc98_gen_base62(len int) RETURNS text AS $$
DECLARE
  alphabet text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  result text := '';
  raw bytea := gen_random_bytes(len);
  i int;
BEGIN
  FOR i IN 0..len - 1 LOOP
    result := result || substr(alphabet, (get_byte(raw, i) % 62) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

UPDATE "photos" SET "public_id" = pg_temp.syc98_gen_base62(22) WHERE "public_id" IS NULL;--> statement-breakpoint

ALTER TABLE "photos" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_public_id_unique" ON "photos" USING btree ("public_id");

-- rollback-begin
-- DROP INDEX "photos_public_id_unique";
-- ALTER TABLE "photos" DROP COLUMN "public_id";
-- DROP EXTENSION IF EXISTS pgcrypto;
-- rollback-end
