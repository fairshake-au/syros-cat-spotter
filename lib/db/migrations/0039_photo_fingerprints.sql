CREATE TABLE "photo_fingerprints" (
	"photo_id" integer PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"vector" real[] NOT NULL,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_fingerprints_vector_len_ck" CHECK (array_ndims("photo_fingerprints"."vector") = 1 and cardinality("photo_fingerprints"."vector") = 384)
);
--> statement-breakpoint
ALTER TABLE "photo_fingerprints" ADD CONSTRAINT "photo_fingerprints_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- SYC-527 piece 3, spec find-from-a-photo-whole-island.md §6.2: a hidden or
-- removed photo has no fingerprint, ever. Whatever writes the hide (the
-- team's dashboard, a welfare report, the written procedure) or the removal,
-- these delete the photo's fingerprint in the same transaction. Each first
-- locks the photo row FOR UPDATE: every hide and removal path has already
-- taken that lock in its transaction (re-locking is free), and the only
-- writer, saveFingerprint, holds it FOR SHARE while it re-checks and saves,
-- so a hide and a save queue on one row and can't both win.
CREATE FUNCTION "photo_fingerprints_drop_on_hide"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM photos WHERE id = NEW.photo_id FOR UPDATE;
  DELETE FROM photo_fingerprints WHERE photo_id = NEW.photo_id;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "photo_fingerprints_drop_on_hide" AFTER INSERT ON "photo_visibility_events"
  FOR EACH ROW WHEN (NEW.action = 'hide') EXECUTE FUNCTION "photo_fingerprints_drop_on_hide"();--> statement-breakpoint
CREATE FUNCTION "photo_fingerprints_drop_on_removal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM photos WHERE id = NEW.id FOR UPDATE;
  DELETE FROM photo_fingerprints WHERE photo_id = NEW.id;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER "photo_fingerprints_drop_on_removal" AFTER UPDATE OF "removed_at" ON "photos"
  FOR EACH ROW WHEN (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL)
  EXECUTE FUNCTION "photo_fingerprints_drop_on_removal"();

-- Additive: rolling back loses only fingerprints, which the backfill remakes.
-- rollback-begin
-- DROP TRIGGER "photo_fingerprints_drop_on_removal" ON "photos";
-- DROP FUNCTION "photo_fingerprints_drop_on_removal"();
-- DROP TRIGGER "photo_fingerprints_drop_on_hide" ON "photo_visibility_events";
-- DROP FUNCTION "photo_fingerprints_drop_on_hide"();
-- DROP TABLE "photo_fingerprints";
-- rollback-end
