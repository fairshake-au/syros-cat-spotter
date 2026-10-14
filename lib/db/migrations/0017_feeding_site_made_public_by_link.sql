-- SYC-209 PR 1.2 (plan "PR 1.2", spec feeding-sites-and-colonies.md §11.1).
-- feeding_sites.made_public_by goes from text to a strict link to people.id.
-- This is a type change, not an additive one, so before anything else refuse,
-- with the ids, if any value would not convert: a value that isn't a
-- well-formed uuid (checked by pattern BEFORE any cast, so the failure is
-- this message and not a raw cast error), or a well-formed uuid that isn't a
-- person. Null stays null. The whole run (every pending migration) rolls
-- back, changing nothing. Fix such a row by hand first.
-- colonies.created_by is NOT touched: it stays text (roles plan finding C7).
DO $$
DECLARE
  bad_shape text;
  not_person text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO bad_shape
    FROM feeding_sites
   WHERE made_public_by IS NOT NULL
     AND made_public_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF bad_shape IS NOT NULL THEN
    RAISE EXCEPTION 'feeding_sites.made_public_by must be a person''s id (a uuid); fix by hand first: site ids %', bad_shape;
  END IF;

  -- Every value is a well-formed uuid by now, so the cast cannot fail.
  SELECT string_agg(s.id::text, ', ' ORDER BY s.id) INTO not_person
    FROM feeding_sites s
   WHERE s.made_public_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = s.made_public_by::uuid);
  IF not_person IS NOT NULL THEN
    RAISE EXCEPTION 'feeding_sites.made_public_by must be the id of a person on the people list; fix by hand first: site ids %', not_person;
  END IF;
END
$$;--> statement-breakpoint
-- A type change rewrites the table but is not a row update, so the
-- feeding_sites_touch_updated_at trigger does not fire and updated_at keeps
-- its value (tested).
ALTER TABLE "feeding_sites" ALTER COLUMN "made_public_by" SET DATA TYPE uuid USING "made_public_by"::uuid;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_made_public_by_people_id_fk" FOREIGN KEY ("made_public_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
-- Rolling back keeps every value (a uuid becomes its text form) and drops
-- only the link. Roll the app back first (see lib/db/migrations/README.md).
-- rollback-begin
-- ALTER TABLE "feeding_sites" DROP CONSTRAINT "feeding_sites_made_public_by_people_id_fk";
-- ALTER TABLE "feeding_sites" ALTER COLUMN "made_public_by" SET DATA TYPE text USING "made_public_by"::text;
-- rollback-end
