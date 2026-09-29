-- Data spine, step 1 (cat-record-data-spine.md §11.2): the tables, and
-- nothing reads them yet. Observations are append-only; the triggers below
-- make redaction (§8.5) the only permitted update, from the first migration.
CREATE TABLE "cat_identity" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer NOT NULL,
	"canonical_cat_id" integer NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" integer
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer NOT NULL,
	"kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"device_id" text,
	"account_id" text,
	"role_at_time" text DEFAULT 'public' NOT NULL,
	"authority_scope" text DEFAULT 'none' NOT NULL,
	"provenance" text DEFAULT 'volunteered' NOT NULL,
	"suggested_value" jsonb,
	"suggestion_source" text,
	"sighting_id" integer,
	"photo_id" integer,
	"import_record_id" integer,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" integer,
	"supersede_reason" text,
	"redacted_at" timestamp with time zone,
	"redaction_reason" text,
	CONSTRAINT "observations_attribution_ck" CHECK ("observations"."redacted_at" is not null or ("observations"."device_id" is null) <> ("observations"."account_id" is null))
);
--> statement-breakpoint
CREATE TABLE "colonies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"guardian_name" text,
	"lat" double precision,
	"lng" double precision,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "colony_name_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"colony_id" integer NOT NULL,
	"name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_by" text
);
--> statement-breakpoint
CREATE TABLE "feeding_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"colony_id" integer,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"made_public_by" text,
	"made_public_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sightings" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sightings" ADD COLUMN "redaction_reason" text;--> statement-breakpoint
ALTER TABLE "colony_name_history" ADD CONSTRAINT "colony_name_history_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feeding_sites" ADD CONSTRAINT "feeding_sites_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observations_cat_kind_idx" ON "observations" USING btree ("cat_id","kind","observed_at");--> statement-breakpoint
CREATE INDEX "observations_kind_idx" ON "observations" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "observations_device_idx" ON "observations" USING btree ("device_id") WHERE "observations"."device_id" is not null;--> statement-breakpoint
CREATE INDEX "observations_account_idx" ON "observations" USING btree ("account_id") WHERE "observations"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "colonies_normalised_name_unique" ON "colonies" USING btree ("normalised_name");--> statement-breakpoint
CREATE FUNCTION "observations_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- The only columns redaction may touch. Every other column must stay
  -- byte-for-byte what it was (compared as text, so even a jsonb value's
  -- numeric representation cannot change).
  exempt text[] := ARRAY['redacted_at', 'redaction_reason', 'device_id', 'account_id', 'value'];
  value_ok boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A row arrives attributed. Only redaction may take its author away.
    IF NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'observations: a new row cannot arrive already redacted';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'observations are append-only: delete is not allowed (id %)', OLD.id;
  END IF;

  -- Redaction keeps the value, except that a note's text may be emptied (§8.3).
  value_ok := NEW.value::text = OLD.value::text
    OR (OLD.kind = 'note' AND NEW.value = '{}'::jsonb);

  IF (to_jsonb(NEW) - exempt)::text = (to_jsonb(OLD) - exempt)::text
     AND value_ok
     AND NEW.device_id IS NULL
     AND NEW.account_id IS NULL
     AND (
       -- First redaction: stamped, with a reason, the author cleared.
       (OLD.redacted_at IS NULL
         AND NEW.redacted_at IS NOT NULL
         AND coalesce(NEW.redaction_reason, '') <> '')
       -- Already redacted: running deletion again is safe, and may still
       -- empty a note it missed; the stamp and reason never change.
       OR (OLD.redacted_at IS NOT NULL
         AND NEW.redacted_at = OLD.redacted_at
         AND NEW.redaction_reason IS NOT DISTINCT FROM OLD.redaction_reason)
     )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'observations are append-only: the only permitted update is redaction (id %)', OLD.id;
END
$$;--> statement-breakpoint
CREATE TRIGGER "observations_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "observations"
  FOR EACH ROW EXECUTE FUNCTION "observations_append_only"();--> statement-breakpoint
CREATE FUNCTION "cat_identity_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A merge is a row and an unmerge is another row (§10.3). Nothing changes
  -- or removes a row, so every merge stays reversible.
  RAISE EXCEPTION 'cat_identity is append-only: % is not allowed', TG_OP;
END
$$;--> statement-breakpoint
CREATE TRIGGER "cat_identity_append_only" BEFORE UPDATE OR DELETE ON "cat_identity"
  FOR EACH ROW EXECUTE FUNCTION "cat_identity_append_only"();--> statement-breakpoint
CREATE FUNCTION "append_only_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Row triggers do not see TRUNCATE, so one stray statement would otherwise
  -- empty the record in a single step.
  RAISE EXCEPTION '% is append-only: TRUNCATE is not allowed', TG_TABLE_NAME;
END
$$;--> statement-breakpoint
CREATE TRIGGER "observations_no_truncate" BEFORE TRUNCATE ON "observations"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
CREATE TRIGGER "cat_identity_no_truncate" BEFORE TRUNCATE ON "cat_identity"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();

-- CAUTION: this rollback drops the observations and every sighting's
-- redaction stamp. Against a database with real data, take a backup first.
-- rollback-begin
-- DROP TABLE "feeding_sites";
-- DROP TABLE "colony_name_history";
-- DROP TABLE "colonies";
-- DROP TABLE "observations";
-- DROP TABLE "cat_identity";
-- DROP FUNCTION "observations_append_only"();
-- DROP FUNCTION "cat_identity_append_only"();
-- DROP FUNCTION "append_only_no_truncate"();
-- ALTER TABLE "sightings" DROP COLUMN "redaction_reason";
-- ALTER TABLE "sightings" DROP COLUMN "redacted_at";
-- rollback-end
