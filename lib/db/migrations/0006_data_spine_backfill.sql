-- Data spine PR 3 (cat-record-data-spine.md §11.2 steps 3-4;
-- docs/superpowers/plans/data-spine.md, PR 3): copy in everything the app
-- already knows about homes and sterilisation, once.
--
-- Data only — no schema change. Append-only (inserts into "observations"
-- only), idempotent, self-checking. Every row this migration writes carries
-- suggestion_source = 'backfill:data-spine', so the rollback finds exactly
-- these rows; writeObservation (artifacts/api-server/src/lib/observations.ts)
-- refuses that value from any other caller.
--
-- PR 2 (data spine PR 2, "One way to write an observation", merged in #66)
-- must be LIVE IN PRODUCTION before this migration runs: it closes the
-- window in which a claim or care update could happen after this reads the
-- tables and before PR 2's go-forward writes exist, which would otherwise
-- leave a gap this backfill can't see.
--
-- Match keys, each chosen so this never double-counts a fact PR 2's
-- go-forward write already recorded:
--  * care updates ("desexed" -> sterilised, "adopted" -> homed): skip a
--    cat_updates row if an observation of the matching kind already exists
--    for that cat with observed_at = the cat_updates row's created_at --
--    exactly what PR 2's admin route (routes/notifications.ts) writes for
--    the same event.
--  * claims and owner registrations (both set cats.owner_device_id and both
--    write the same shape, so one match key covers both routes in
--    routes/cats.ts): skip a cat if it already has ANY life_status: homed
--    observation from its owner_device_id with
--    authority_scope = 'owner_of_this_cat'. This also catches a cat claimed
--    after PR 2 went live but before this migration ran -- its go-forward
--    row satisfies the same match key, so no duplicate is written for it.

-- Step 3: existing care-timeline updates.
INSERT INTO "observations" (
  "cat_id", "kind", "value", "device_id", "account_id",
  "role_at_time", "authority_scope", "provenance",
  "suggestion_source", "observed_at"
)
SELECT
  u."cat_id",
  'sterilised',
  '{"sterilised": true}'::jsonb,
  NULL,
  'system:legacy-backfill',
  'staff',
  'none',
  'legacy',
  'backfill:data-spine',
  u."created_at"
FROM "cat_updates" u
WHERE u."update_type" = 'desexed'
  AND NOT EXISTS (
    SELECT 1 FROM "observations" o
     WHERE o."cat_id" = u."cat_id"
       AND o."kind" = 'sterilised'
       AND o."observed_at" = u."created_at"
  );
--> statement-breakpoint

INSERT INTO "observations" (
  "cat_id", "kind", "value", "device_id", "account_id",
  "role_at_time", "authority_scope", "provenance",
  "suggestion_source", "observed_at"
)
SELECT
  u."cat_id",
  'life_status',
  '{"status": "homed"}'::jsonb,
  NULL,
  'system:legacy-backfill',
  'staff',
  'none',
  'legacy',
  'backfill:data-spine',
  u."created_at"
FROM "cat_updates" u
WHERE u."update_type" = 'adopted'
  AND NOT EXISTS (
    SELECT 1 FROM "observations" o
     WHERE o."cat_id" = u."cat_id"
       AND o."kind" = 'life_status'
       AND o."observed_at" = u."created_at"
  );
--> statement-breakpoint

-- Step 4: every claimed cat (and every owner-registered cat; POST /cats sets
-- owner_device_id at creation too) becomes "homed" (Samuel, 28 Sep 2026).
-- observed_at = the cat's created_at, because the claim date was never
-- stored -- the earliest the claim could have been, so this never claims
-- evidence of life later than is actually known.
INSERT INTO "observations" (
  "cat_id", "kind", "value", "device_id", "account_id",
  "role_at_time", "authority_scope", "provenance",
  "suggestion_source", "observed_at"
)
SELECT
  c."id",
  'life_status',
  '{"status": "homed"}'::jsonb,
  c."owner_device_id",
  NULL,
  'public',
  'owner_of_this_cat',
  'legacy',
  'backfill:data-spine',
  c."created_at"
FROM "cats" c
WHERE c."owner_device_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "observations" o
     WHERE o."cat_id" = c."id"
       AND o."kind" = 'life_status'
       AND o."device_id" = c."owner_device_id"
       AND o."authority_scope" = 'owner_of_this_cat'
       AND (o."value"->>'status') = 'homed'
  );
--> statement-breakpoint

-- Self-check: for each source row, is there now a covering observation --
-- whether this migration just wrote it or a go-forward write already
-- covered it before this ran (the same match keys as the inserts above,
-- not only rows tagged backfill:data-spine) -- and raises if any source row
-- is left uncovered. A partial or wrong backfill must roll back whole (the
-- runner applies this file inside one transaction), not land silently.
-- Checked against production counts recorded in the PR description (2 Oct
-- 2026: 28 cats, 12 claimed; 35 care updates, all type "sighting" -- so 0
-- desexed and 0 adopted rows there today, and this self-check is expected
-- to pass with 0 for both on first run in production).
DO $$
DECLARE
  expected_sterilised integer;
  covered_sterilised integer;
  tagged_sterilised integer;
  expected_homed_from_care integer;
  covered_homed_from_care integer;
  tagged_homed_from_care integer;
  expected_claimed_cats integer;
  actual_homed_total integer;
BEGIN
  -- Coverage (every desexed row now has a matching observation, whichever
  -- write put it there) guards against a missed row. The tagged count,
  -- bounded above by the same expectation, guards against this migration's
  -- own NOT EXISTS racing itself and double-writing one desexed row's fact
  -- (expected 1 but 2 tagged rows would mean the match key failed).
  SELECT count(*) INTO expected_sterilised
    FROM "cat_updates" WHERE "update_type" = 'desexed';
  SELECT count(*) INTO covered_sterilised
    FROM "cat_updates" u
   WHERE u."update_type" = 'desexed'
     AND EXISTS (
       SELECT 1 FROM "observations" o
        WHERE o."cat_id" = u."cat_id"
          AND o."kind" = 'sterilised'
          AND o."observed_at" = u."created_at"
     );
  SELECT count(*) INTO tagged_sterilised
    FROM "observations"
   WHERE "kind" = 'sterilised' AND "suggestion_source" = 'backfill:data-spine';
  IF covered_sterilised <> expected_sterilised OR tagged_sterilised > expected_sterilised THEN
    RAISE EXCEPTION
      'data spine backfill: expected % sterilised observations from desexed care updates, found % covered and % written by this backfill',
      expected_sterilised, covered_sterilised, tagged_sterilised;
  END IF;

  SELECT count(*) INTO expected_homed_from_care
    FROM "cat_updates" WHERE "update_type" = 'adopted';
  SELECT count(*) INTO covered_homed_from_care
    FROM "cat_updates" u
   WHERE u."update_type" = 'adopted'
     AND EXISTS (
       SELECT 1 FROM "observations" o
        WHERE o."cat_id" = u."cat_id"
          AND o."kind" = 'life_status'
          AND o."observed_at" = u."created_at"
     );
  SELECT count(*) INTO tagged_homed_from_care
    FROM "observations" o
    JOIN "cat_updates" u
      ON u."cat_id" = o."cat_id" AND u."created_at" = o."observed_at" AND u."update_type" = 'adopted'
   WHERE o."kind" = 'life_status' AND o."suggestion_source" = 'backfill:data-spine';
  IF covered_homed_from_care <> expected_homed_from_care OR tagged_homed_from_care > expected_homed_from_care THEN
    RAISE EXCEPTION
      'data spine backfill: expected % homed observations from adopted care updates, found % covered and % written by this backfill',
      expected_homed_from_care, covered_homed_from_care, tagged_homed_from_care;
  END IF;

  -- This one counts every matching observation, not only rows this
  -- migration just wrote, because a cat claimed between PR 2 going live and
  -- this migration running already has its go-forward row (see the match
  -- key note above) and must still be counted as covered.
  SELECT count(*) INTO expected_claimed_cats
    FROM "cats" WHERE "owner_device_id" IS NOT NULL;
  SELECT count(DISTINCT "cat_id") INTO actual_homed_total
    FROM "observations"
   WHERE "kind" = 'life_status'
     AND "authority_scope" = 'owner_of_this_cat'
     AND ("value"->>'status') = 'homed';
  IF actual_homed_total <> expected_claimed_cats THEN
    RAISE EXCEPTION
      'data spine backfill: expected every one of % claimed/owner-registered cats to have a homed observation, found %',
      expected_claimed_cats, actual_homed_total;
  END IF;
END
$$;

-- CAUTION: against a database with real data, take a Neon snapshot first
-- (the plan's "Data safety on the live test database" section). Applied
-- with `db-ops -f command=migrate-rollback`, and only after the app code
-- that depends on PR 3 having run (PR 4's code gate) has itself been rolled
-- back first (docs/DEPLOYMENT.md §C's order). This is the one sanctioned
-- bypass of the observations append-only trigger, and it removes only the
-- rows this migration marked.
-- rollback-begin
-- ALTER TABLE "observations" DISABLE TRIGGER "observations_append_only";
-- DELETE FROM "observations" WHERE "suggestion_source" = 'backfill:data-spine';
-- ALTER TABLE "observations" ENABLE TRIGGER "observations_append_only";
-- rollback-end
