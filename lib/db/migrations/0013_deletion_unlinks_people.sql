-- SYC-63: self-service "Delete my data" (plan
-- docs/superpowers/plans/syc-63-self-service-deletion.md §5; DECISIONS Part 2g,
-- Samuel, 29 Sep 2026). Deletion unlinks a person by CLEARING the columns that
-- point at them, so those columns may now be null, but only on a row stamped
-- as redacted. Every statement is safe to run twice.
ALTER TABLE "cats" ALTER COLUMN "discoverer_device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sightings" ALTER COLUMN "device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cats" ADD COLUMN IF NOT EXISTS "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cats" ADD COLUMN IF NOT EXISTS "redaction_reason" text;--> statement-breakpoint
-- Deletion looks a person's sightings up while they wait (§4.2).
CREATE INDEX IF NOT EXISTS "sightings_device_idx" ON "sightings" USING btree ("device_id") WHERE "sightings"."device_id" is not null;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cats_discoverer_ck') THEN
    ALTER TABLE "cats" ADD CONSTRAINT "cats_discoverer_ck" CHECK ("cats"."discoverer_device_id" is not null or "cats"."redacted_at" is not null);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sightings_attribution_ck') THEN
    ALTER TABLE "sightings" ADD CONSTRAINT "sightings_attribution_ck" CHECK ("sightings"."device_id" is not null or "sightings"."redacted_at" is not null);
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sightings_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- What a status move may change, and what redaction may change. Every
  -- other column must stay byte-for-byte what it was (compared as text).
  move_exempt text[] := ARRAY['status', 'cat_id'];
  redact_exempt text[] := ARRAY['device_id', 'redacted_at', 'redaction_reason'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A sighting arrives from a spotter. Only deletion may take them away.
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'sightings: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sightings are append-only: delete is not allowed (id %)', OLD.id;
  END IF;

  -- A status move: the cat is set once, and nothing else changes.
  --   pending -> resolved          the spotter picks the cat (routes/sightings.ts)
  --   pending -> awaiting_team     "Ask Syros Cats to match it" (SYC-119)
  --   awaiting_team -> resolved    the team matches it on the spotter's behalf
  IF (to_jsonb(NEW) - move_exempt)::text = (to_jsonb(OLD) - move_exempt)::text
     AND OLD.cat_id IS NULL
     AND (
       (OLD.status IN ('pending', 'awaiting_team')
         AND NEW.status = 'resolved'
         AND NEW.cat_id IS NOT NULL)
       OR (OLD.status = 'pending'
         AND NEW.status = 'awaiting_team'
         AND NEW.cat_id IS NULL)
     )
  THEN
    RETURN NEW;
  END IF;

  -- Redaction (§8.5): the spotter cleared, stamped with a reason, nothing
  -- else changed. Running deletion again is safe; the stamp never changes.
  IF (to_jsonb(NEW) - redact_exempt)::text = (to_jsonb(OLD) - redact_exempt)::text
     AND NEW.device_id IS NULL
     AND (
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND coalesce(NEW.redaction_reason, '') <> '')
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'sightings are append-only: the only permitted updates are a status move and redaction (id %)', OLD.id;
END
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "sightings_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "sightings"
  FOR EACH ROW EXECUTE FUNCTION "sightings_append_only"();--> statement-breakpoint
-- append_only_no_truncate() comes from 0001.
CREATE OR REPLACE TRIGGER "sightings_no_truncate" BEFORE TRUNCATE ON "sightings"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();

-- The rollback refuses once anybody has been deleted: putting NOT NULL back
-- would need a device id for every unlinked row, and the whole point is that
-- there isn't one. Neon's restore window is the only way back after that.
-- rollback-begin
-- LOCK TABLE "sightings", "cats" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "sightings" WHERE "device_id" IS NULL)
--      OR EXISTS (SELECT 1 FROM "cats" WHERE "discoverer_device_id" IS NULL) THEN
--     RAISE EXCEPTION 'sightings/cats: somebody has been deleted, so their rows have no device id to put back. Refusing to restore NOT NULL.';
--   END IF;
-- END $$;
-- DROP TRIGGER "sightings_no_truncate" ON "sightings";
-- DROP TRIGGER "sightings_append_only" ON "sightings";
-- DROP FUNCTION "sightings_append_only"();
-- ALTER TABLE "sightings" DROP CONSTRAINT "sightings_attribution_ck";
-- ALTER TABLE "cats" DROP CONSTRAINT "cats_discoverer_ck";
-- DROP INDEX "sightings_device_idx";
-- ALTER TABLE "cats" DROP COLUMN "redaction_reason";
-- ALTER TABLE "cats" DROP COLUMN "redacted_at";
-- ALTER TABLE "sightings" ALTER COLUMN "device_id" SET NOT NULL;
-- ALTER TABLE "cats" ALTER COLUMN "discoverer_device_id" SET NOT NULL;
-- rollback-end
