CREATE TABLE "badge_backfill_runs" (
	"version" integer PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"spotters" integer
);
--> statement-breakpoint
CREATE TABLE "badge_moments" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"kind" text NOT NULL,
	"badge_ids" text[] NOT NULL,
	"week_start" date,
	"place" integer,
	"week_points" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"celebrated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text,
	"sighting_id" integer NOT NULL,
	"cat_id" integer NOT NULL,
	"points" integer NOT NULL,
	"athens_day" date NOT NULL,
	"week_start" date NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "points_ledger_sighting_id_unique" UNIQUE("sighting_id")
);
--> statement-breakpoint
CREATE TABLE "spotter_badges" (
	"device_id" text NOT NULL,
	"badge_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "spotter_badges_device_id_badge_id_pk" PRIMARY KEY("device_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_closes" (
	"week_start" date PRIMARY KEY NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"pushed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weekly_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"place" integer NOT NULL,
	"device_id" text,
	"display_name" text,
	"points" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sightings" ADD COLUMN "area_key" text;--> statement-breakpoint
ALTER TABLE "sightings" ADD COLUMN "on_island" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_once_a_day_uq" ON "points_ledger" USING btree ("device_id","cat_id","athens_day") WHERE "points_ledger"."points" > 0;--> statement-breakpoint
CREATE INDEX "points_ledger_week_device_idx" ON "points_ledger" USING btree ("week_start","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_results_week_device_uq" ON "weekly_results" USING btree ("week_start","device_id");--> statement-breakpoint
-- A sighting stays append-only. Two things are added to what may change: the
-- place (area_key, on_island) is stamped in the same update that resolves it,
-- and a row with no place yet may be stamped once on its own (the backfill).
CREATE OR REPLACE FUNCTION "sightings_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- What a status move may change, and what redaction may change. Every
  -- other column must stay byte-for-byte what it was (compared as text).
  move_exempt text[] := ARRAY['status', 'cat_id', 'area_key', 'on_island'];
  stamp_exempt text[] := ARRAY['area_key', 'on_island'];
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
  -- A place already stamped stays as it is through a move.
  IF (to_jsonb(NEW) - move_exempt)::text = (to_jsonb(OLD) - move_exempt)::text
     AND OLD.cat_id IS NULL
     AND (OLD.area_key IS NULL OR NEW.area_key IS NOT DISTINCT FROM OLD.area_key)
     AND (OLD.on_island IS NULL OR NEW.on_island IS NOT DISTINCT FROM OLD.on_island)
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

  -- A place stamp (SYC-706): where the spot is, written once to a row that
  -- has none yet (the history backfill), with nothing else changed.
  IF (to_jsonb(NEW) - stamp_exempt)::text = (to_jsonb(OLD) - stamp_exempt)::text
     AND OLD.area_key IS NULL
     AND OLD.on_island IS NULL
     AND NEW.area_key IS NOT NULL
     AND NEW.on_island IS NOT NULL
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

  RAISE EXCEPTION 'sightings are append-only: the only permitted updates are a status move, a place stamp and redaction (id %)', OLD.id;
END
$$;

-- Rolling back drops the six new tables and the two
-- columns, and puts the sightings trigger back as 0013 left it. Points,
-- badges and weekly results are lost. Nothing else reads them.
-- rollback-begin
-- LOCK TABLE "sightings" IN ACCESS EXCLUSIVE MODE;
-- DROP TABLE "badge_backfill_runs";
-- DROP TABLE "badge_moments";
-- DROP TABLE "points_ledger";
-- DROP TABLE "spotter_badges";
-- DROP TABLE "weekly_closes";
-- DROP TABLE "weekly_results";
-- CREATE OR REPLACE FUNCTION "sightings_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
-- DECLARE
--   -- What a status move may change, and what redaction may change. Every
--   -- other column must stay byte-for-byte what it was (compared as text).
--   move_exempt text[] := ARRAY['status', 'cat_id'];
--   redact_exempt text[] := ARRAY['device_id', 'redacted_at', 'redaction_reason'];
-- BEGIN
--   IF TG_OP = 'INSERT' THEN
--     -- A sighting arrives from a spotter. Only deletion may take them away.
--     IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
--       RAISE EXCEPTION 'sightings: a new row cannot arrive already redacted';
--     END IF;
--     RETURN NEW;
--   END IF;
--   IF TG_OP = 'DELETE' THEN
--     RAISE EXCEPTION 'sightings are append-only: delete is not allowed (id %)', OLD.id;
--   END IF;
-- 
--   -- A status move: the cat is set once, and nothing else changes.
--   --   pending -> resolved          the spotter picks the cat (routes/sightings.ts)
--   --   pending -> awaiting_team     "Ask Syros Cats to match it" (SYC-119)
--   --   awaiting_team -> resolved    the team matches it on the spotter's behalf
--   IF (to_jsonb(NEW) - move_exempt)::text = (to_jsonb(OLD) - move_exempt)::text
--      AND OLD.cat_id IS NULL
--      AND (
--        (OLD.status IN ('pending', 'awaiting_team')
--          AND NEW.status = 'resolved'
--          AND NEW.cat_id IS NOT NULL)
--        OR (OLD.status = 'pending'
--          AND NEW.status = 'awaiting_team'
--          AND NEW.cat_id IS NULL)
--      )
--   THEN
--     RETURN NEW;
--   END IF;
-- 
--   -- Redaction (§8.5): the spotter cleared, stamped with a reason, nothing
--   -- else changed. Running deletion again is safe; the stamp never changes.
--   IF (to_jsonb(NEW) - redact_exempt)::text = (to_jsonb(OLD) - redact_exempt)::text
--      AND NEW.device_id IS NULL
--      AND (
--        (OLD.redacted_at IS NULL
--          AND NEW.redacted_at IS NOT NULL
--          AND coalesce(NEW.redaction_reason, '') <> '')
--        OR (OLD.redacted_at IS NOT NULL
--          AND NEW.redacted_at = OLD.redacted_at
--          AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
--      )
--   THEN
--     RETURN NEW;
--   END IF;
-- 
--   RAISE EXCEPTION 'sightings are append-only: the only permitted updates are a status move and redaction (id %)', OLD.id;
-- END
-- $$;
-- ALTER TABLE "sightings" DROP COLUMN "on_island";
-- ALTER TABLE "sightings" DROP COLUMN "area_key";
-- rollback-end
