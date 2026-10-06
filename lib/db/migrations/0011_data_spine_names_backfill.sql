-- Data spine PR 3b (cat-record-data-spine.md §11.2 step 4, for names;
-- docs/superpowers/plans/data-spine.md, "PR 3b"): every cat's current name
-- becomes a `name` observation, once, so a later rename or the records
-- import (SYC-49) never loses the name a cat had when the record began.
--
-- Data only: no schema change. Append-only (inserts into "observations"
-- only), idempotent, self-checking. Every row this migration writes carries
-- suggestion_source = 'backfill:data-spine-names', so the rollback finds
-- exactly these rows; writeObservation refuses any "backfill:" source from
-- other callers (artifacts/api-server/src/lib/observations.ts).
--
-- Needs SYC-101's migration (0010_cats_folded_name) first: the folded form
-- is COPIED from cats.normalised_name, never recomputed here, because a SQL
-- migration can't call foldName. That column is foldName's SQL twin,
-- proved equal by lib/db/src/foldSql.test.ts.
--
-- Match key: skip any cat that already has ANY `name` observation. Such a
-- cat was named, registered or renamed after data spine PR 2 went live.
-- Writing its *current* name dated at created_at would backdate a rename,
-- which §10.3 forbids.
--
-- The one gap, accepted (review of #94): a cat CREATED before PR 2 and
-- RENAMED after it has only its rename recorded. Its original name was
-- never stored anywhere (a rename overwrote cats.name and was only ever
-- sent as a push notification), so nothing can recover it, and this
-- migration doesn't invent it. Production had no name observations at all
-- on 6 Oct 2026, so no real cat has fallen into this gap. Migrating this
-- together with SYC-101's 0010, in one db-ops run, keeps it that way.
--
-- What each row says: the cat's name as it is now, observed at the cat's
-- created_at (the only date the old schema kept), provenance legacy,
-- written by system:legacy-backfill on behalf of the spotter who named it
-- (role public, no special authority). A cat renamed before PR 2 went live
-- only ever kept its newest name; the earlier one was never stored, so
-- there is nothing to recover. Nothing reads names from observations yet,
-- so this changes nothing anyone sees.
INSERT INTO "observations" (
  "cat_id", "kind", "value", "device_id", "account_id",
  "role_at_time", "authority_scope", "provenance",
  "suggestion_source", "observed_at"
)
SELECT
  c."id",
  'name',
  jsonb_build_object('name', c."name", 'normalised', c."normalised_name"),
  NULL,
  'system:legacy-backfill',
  'public',
  'none',
  'legacy',
  'backfill:data-spine-names',
  c."created_at"
FROM "cats" c
WHERE NOT EXISTS (
  SELECT 1 FROM "observations" o
   WHERE o."cat_id" = c."id"
     AND o."kind" = 'name'
);
--> statement-breakpoint

-- Self-check: every cat now has at least one name observation (this
-- migration's or PR 2's); every row this migration wrote copies its cat's
-- current name and folded form exactly; and no cat got more than one. If
-- any of that fails, the runner's transaction rolls the whole file back
-- instead of landing a partial or wrong backfill. Production on 6 Oct 2026:
-- 28 cats, so 28 rows minus any cat PR 2 already named.
DO $$
DECLARE
  cats_total integer;
  cats_named integer;
  tagged_wrong integer;
  tagged_twice integer;
BEGIN
  SELECT count(*) INTO cats_total FROM "cats";
  SELECT count(*) INTO cats_named
    FROM "cats" c
   WHERE EXISTS (
     SELECT 1 FROM "observations" o
      WHERE o."cat_id" = c."id" AND o."kind" = 'name'
   );
  IF cats_named <> cats_total THEN
    RAISE EXCEPTION
      'data spine names backfill: expected all % cats to have a name observation, found %',
      cats_total, cats_named;
  END IF;

  SELECT count(*) INTO tagged_wrong
    FROM "observations" o
    LEFT JOIN "cats" c ON c."id" = o."cat_id"
   WHERE o."suggestion_source" = 'backfill:data-spine-names'
     AND (c."id" IS NULL
          OR o."kind" <> 'name'
          OR o."value"->>'name' IS DISTINCT FROM c."name"
          OR o."value"->>'normalised' IS DISTINCT FROM c."normalised_name"
          OR o."observed_at" IS DISTINCT FROM c."created_at");
  IF tagged_wrong > 0 THEN
    RAISE EXCEPTION
      'data spine names backfill: % backfilled rows do not match their cat''s current name, folded form or created_at',
      tagged_wrong;
  END IF;

  SELECT count(*) INTO tagged_twice
    FROM (
      SELECT "cat_id" FROM "observations"
       WHERE "suggestion_source" = 'backfill:data-spine-names'
       GROUP BY "cat_id" HAVING count(*) > 1
    ) d;
  IF tagged_twice > 0 THEN
    RAISE EXCEPTION
      'data spine names backfill: % cats got more than one backfilled name', tagged_twice;
  END IF;
END
$$;

-- CAUTION: against a database with real data, take a Neon snapshot first
-- (the plan's "Data safety on the live test database"). Applied with
-- `db-ops -f command=migrate-rollback`. This is the one sanctioned bypass
-- of the observations append-only trigger, as in 0006, and it removes only
-- the rows this migration marked.
-- rollback-begin
-- ALTER TABLE "observations" DISABLE TRIGGER "observations_append_only";
-- DELETE FROM "observations" WHERE "suggestion_source" = 'backfill:data-spine-names';
-- ALTER TABLE "observations" ENABLE TRIGGER "observations_append_only";
-- rollback-end
