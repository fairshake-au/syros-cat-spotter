-- SYC-209 PR 1.1 (plan "Slice 1", spec feeding-sites-and-colonies.md §8,
-- §11.1). NOT purely additive: the new feeding_sites checks ("public needs a
-- label and a code", "retired is never public") would fail on a row that is
-- already public. So, before anything else, refuse with the ids of any public
-- row. Such a row must be made private by hand first, and the whole run
-- (every pending migration) rolls back, changing nothing.
DO $$
DECLARE
  ids text;
BEGIN
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO ids
    FROM feeding_sites WHERE is_public;
  IF ids IS NOT NULL THEN
    RAISE EXCEPTION 'feeding_sites public rows must be made private by hand first: ids %', ids;
  END IF;
END
$$;--> statement-breakpoint
CREATE TABLE "feeding_site_old_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"public_id" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "feeding_site_old_codes_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "feeding_site_old_codes_reason_ck" CHECK ("feeding_site_old_codes"."reason" in ('moved', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "mapping_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" integer NOT NULL,
	"kind" text NOT NULL,
	"person_id" uuid,
	"actor_system" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"guardian_aware" boolean,
	"redacted_at" timestamp with time zone,
	"redaction_reason" text,
	CONSTRAINT "mapping_events_subject_kind_ck" CHECK ("mapping_events"."subject_kind" in ('site', 'colony')),
	CONSTRAINT "mapping_events_kind_ck" CHECK ("mapping_events"."kind" in ('existing', 'created', 'seeded', 'renamed', 'notes_edited', 'directions_edited', 'colony_changed', 'moved', 'made_public', 'made_private', 'made_private_moved', 'made_private_colony_changed', 'made_private_guardian_changed', 'label_changed', 'retired', 'restored', 'colony_created', 'colony_renamed', 'guardian_changed', 'colony_notes_changed', 'colony_centre_changed', 'guardian_forgotten')),
	CONSTRAINT "mapping_events_actor_system_ck" CHECK ("mapping_events"."actor_system" in ('system:seed', 'system:migration')),
	CONSTRAINT "mapping_events_one_actor_ck" CHECK (("mapping_events"."person_id" is null) <> ("mapping_events"."actor_system" is null))
);
--> statement-breakpoint
CREATE TABLE "site_page_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"site_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "colony_name_history" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "colony_name_history" ADD COLUMN "redaction_reason" text;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "public_label" text;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "directions" text;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "public_id" text;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "last_public_lat" double precision;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "last_public_lng" double precision;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "guardian_aware" boolean;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "retired_by" uuid;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "feeding_site_old_codes" ADD CONSTRAINT "feeding_site_old_codes_site_id_feeding_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."feeding_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_reads" ADD CONSTRAINT "site_page_reads_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_reads" ADD CONSTRAINT "site_page_reads_site_id_feeding_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."feeding_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mapping_events_subject_idx" ON "mapping_events" USING btree ("subject_kind","subject_id","id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_retired_by_people_id_fk" FOREIGN KEY ("retired_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_public_needs_label_ck" CHECK (not "feeding_sites"."is_public" or ("feeding_sites"."public_label" is not null and "feeding_sites"."public_id" is not null));--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_retired_never_public_ck" CHECK (not ("feeding_sites"."is_public" and "feeding_sites"."retired_at" is not null));--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_last_public_pair_ck" CHECK (("feeding_sites"."last_public_lat" is null) = ("feeding_sites"."last_public_lng" is null));--> statement-breakpoint
-- The feeding-site and colony history is add-only (spec §8). The same shape
-- as the observations trigger in 0001: a row can't arrive redacted, can't be
-- deleted, and the only update is a redaction that blanks before, after and
-- note (spec §7.4, SYC-256: every one of them can hold a guardian's name).
CREATE FUNCTION "mapping_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- The only columns redaction may touch. Every other column must stay
  -- byte-for-byte what it was (compared as text).
  exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'before', 'after', 'note'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'mapping_events: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mapping_events is append-only: delete is not allowed (id %)', OLD.id;
  END IF;

  IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
     -- Redaction blanks all three free fields, every time.
     AND coalesce(NEW.before = '{}'::jsonb, false)
     AND coalesce(NEW.after = '{}'::jsonb, false)
     AND NEW.note IS NULL
     AND (
       -- First redaction: stamped, with a reason.
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND btrim(coalesce(NEW.redaction_reason, '')) <> '')
       -- Already redacted: running the same redaction again is a no-op and
       -- is allowed (as for observations); the stamp and reason never change.
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'mapping_events is append-only: the only permitted update is redaction (id %)', OLD.id;
END
$$;--> statement-breakpoint
CREATE TRIGGER "mapping_events_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "mapping_events"
  FOR EACH ROW EXECUTE FUNCTION "mapping_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "mapping_events_no_truncate" BEFORE TRUNCATE ON "mapping_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
-- A colony's earlier names are kept so an old name still finds it (spine
-- §10.5). From here on they are add-only too: no delete, and the only update
-- is a redaction that replaces the name with a fixed placeholder (spec §7.4:
-- "Vaporia — Eleni's" holds a guardian's name). Before this migration,
-- nothing stopped a delete; nothing in the app deletes these rows.
CREATE FUNCTION "colony_name_history_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'name', 'normalised_name'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'colony_name_history: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'colony_name_history is append-only: delete is not allowed (id %)', OLD.id;
  END IF;

  IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
     AND NEW.name = '(name removed)'
     AND NEW.normalised_name = '(name removed)'
     AND (
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND btrim(coalesce(NEW.redaction_reason, '')) <> '')
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'colony_name_history is append-only: the only permitted update is redaction (id %)', OLD.id;
END
$$;--> statement-breakpoint
CREATE TRIGGER "colony_name_history_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "colony_name_history"
  FOR EACH ROW EXECUTE FUNCTION "colony_name_history_append_only"();--> statement-breakpoint
CREATE TRIGGER "colony_name_history_no_truncate" BEFORE TRUNCATE ON "colony_name_history"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
-- A public code is never both a site's current code and a superseded one
-- (spec §11.1: the public lookup refuses superseded codes). Checked both
-- ways. The advisory lock serialises the two checks, so two transactions
-- can't each pass while writing the same code to opposite tables. To retire
-- a code, give the site its new code (or null) first, then record the old.
CREATE FUNCTION "feeding_site_codes_exclusive"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('feeding_site_codes_exclusive'));
  IF TG_TABLE_NAME = 'feeding_sites' THEN
    IF EXISTS (SELECT 1 FROM feeding_site_old_codes WHERE public_id = NEW.public_id) THEN
      RAISE EXCEPTION 'feeding_sites: public_id is a superseded code (site %)', NEW.id;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM feeding_sites WHERE public_id = NEW.public_id) THEN
      RAISE EXCEPTION 'feeding_site_old_codes: public_id is still a site''s current code (site %)', NEW.site_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "feeding_sites_code_not_old" BEFORE INSERT OR UPDATE OF "public_id" ON "feeding_sites"
  FOR EACH ROW WHEN (NEW.public_id IS NOT NULL) EXECUTE FUNCTION "feeding_site_codes_exclusive"();--> statement-breakpoint
CREATE TRIGGER "feeding_site_old_codes_not_current" BEFORE INSERT OR UPDATE OF "public_id" ON "feeding_site_old_codes"
  FOR EACH ROW EXECUTE FUNCTION "feeding_site_codes_exclusive"();--> statement-breakpoint
-- Superseded codes are kept for good (spec §11.1: the history shows them and
-- the public lookup refuses them), so the list is add-only, as
-- photo_visibility_events is (0014). TRUNCATE uses 0001's shared guard.
CREATE FUNCTION "feeding_site_old_codes_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'feeding_site_old_codes is append-only: % is not allowed', TG_OP;
END $$;--> statement-breakpoint
CREATE TRIGGER "feeding_site_old_codes_append_only" BEFORE UPDATE OR DELETE ON "feeding_site_old_codes"
  FOR EACH ROW EXECUTE FUNCTION "feeding_site_old_codes_append_only"();--> statement-breakpoint
CREATE TRIGGER "feeding_site_old_codes_no_truncate" BEFORE TRUNCATE ON "feeding_site_old_codes"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
-- Sites that existed before the history did get one "existing" event each,
-- so "how did this become public?" always has an answer (spec §11.1). Every
-- existing site stays private, with no label and no code.
INSERT INTO "mapping_events" ("subject_kind", "subject_id", "kind", "actor_system", "after")
SELECT 'site', id, 'existing', 'system:migration',
       jsonb_build_object('name', name, 'lat', lat, 'lng', lng, 'colonyId', colony_id)
  FROM "feeding_sites"
 ORDER BY id;
-- ROLLING THIS BACK DELETES THE FEEDING-SITE AND COLONY HISTORY: every
-- mapping_events row (who added, moved, renamed, retired or published what),
-- every superseded public code, every site-page read record, every site's
-- public label, code, directions and retirement, and the redaction stamps on
-- colony_name_history. Take a Neon snapshot first, and roll the app back
-- first (see lib/db/migrations/README.md). Re-running the migration writes
-- fresh "existing" events; the lost history does not come back.
-- rollback-begin
-- DROP TRIGGER "feeding_sites_code_not_old" ON "feeding_sites";
-- DROP TRIGGER "colony_name_history_append_only" ON "colony_name_history";
-- DROP TRIGGER "colony_name_history_no_truncate" ON "colony_name_history";
-- DROP TABLE "mapping_events";
-- DROP TABLE "site_page_reads";
-- DROP TABLE "feeding_site_old_codes";
-- DROP FUNCTION "mapping_events_append_only"();
-- DROP FUNCTION "colony_name_history_append_only"();
-- DROP FUNCTION "feeding_site_codes_exclusive"();
-- DROP FUNCTION "feeding_site_old_codes_append_only"();
-- ALTER TABLE "feeding_sites" DROP CONSTRAINT "feeding_sites_public_needs_label_ck";
-- ALTER TABLE "feeding_sites" DROP CONSTRAINT "feeding_sites_retired_never_public_ck";
-- ALTER TABLE "feeding_sites" DROP CONSTRAINT "feeding_sites_last_public_pair_ck";
-- ALTER TABLE "feeding_sites" DROP CONSTRAINT "feeding_sites_public_id_unique";
-- ALTER TABLE "feeding_sites" DROP CONSTRAINT "feeding_sites_retired_by_people_id_fk";
-- ALTER TABLE "feeding_sites" DROP COLUMN "public_label";
-- ALTER TABLE "feeding_sites" DROP COLUMN "directions";
-- ALTER TABLE "feeding_sites" DROP COLUMN "public_id";
-- ALTER TABLE "feeding_sites" DROP COLUMN "last_public_lat";
-- ALTER TABLE "feeding_sites" DROP COLUMN "last_public_lng";
-- ALTER TABLE "feeding_sites" DROP COLUMN "guardian_aware";
-- ALTER TABLE "feeding_sites" DROP COLUMN "retired_at";
-- ALTER TABLE "feeding_sites" DROP COLUMN "retired_by";
-- ALTER TABLE "feeding_sites" DROP COLUMN "updated_at";
-- ALTER TABLE "colony_name_history" DROP COLUMN "redacted_at";
-- ALTER TABLE "colony_name_history" DROP COLUMN "redaction_reason";
-- rollback-end
