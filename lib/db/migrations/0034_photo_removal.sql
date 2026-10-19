ALTER TABLE "photos" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_removed_by_people_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_removed_ck" CHECK (("photos"."removed_at" is null and "photos"."removed_by" is null and "photos"."removed_reason" is null and "photos"."data" is not null) or ("photos"."removed_at" is not null and "photos"."removed_by" is not null and "photos"."removed_reason" is not null and "photos"."data" is null));--> statement-breakpoint
-- SYC-462 spec §4.1: a removed photo stays hidden for good. Whatever the app
-- does, a restore event for it is refused (a hide is still allowed).
CREATE FUNCTION "photo_visibility_events_not_after_removal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'restore' AND EXISTS (SELECT 1 FROM photos WHERE id = NEW.photo_id AND removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'photo % was removed for good; it can''t be restored', NEW.photo_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "photo_visibility_events_not_after_removal" BEFORE INSERT ON "photo_visibility_events"
  FOR EACH ROW EXECUTE FUNCTION "photo_visibility_events_not_after_removal"();

-- SYC-462. A REMOVED PHOTO'S BYTES CANNOT BE BROUGHT BACK. IF ANY PHOTO IS
-- REMOVED, THIS ROLLBACK FAILS ON PURPOSE (THE GUARD BELOW) AND DROPS NOTHING.
-- SHIP A FIX FORWARD INSTEAD. NEVER ROLL THE APP BACK PAST SYC-462 ONCE A PHOTO
-- IS REMOVED: THE OLD CODE CRASHES ON A PHOTO WITH NO PICTURE.
-- rollback-begin
-- LOCK TABLE "photos" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "photos" WHERE "data" IS NULL) THEN
--     RAISE EXCEPTION 'photos: a photo was removed for good; refusing to roll back 0034';
--   END IF;
-- END $$;
-- DROP TRIGGER "photo_visibility_events_not_after_removal" ON "photo_visibility_events";
-- DROP FUNCTION "photo_visibility_events_not_after_removal"();
-- ALTER TABLE "photos" DROP CONSTRAINT "photos_removed_ck";
-- ALTER TABLE "photos" DROP CONSTRAINT "photos_removed_by_people_id_fk";
-- ALTER TABLE "photos" DROP COLUMN "removed_reason";
-- ALTER TABLE "photos" DROP COLUMN "removed_by";
-- ALTER TABLE "photos" DROP COLUMN "removed_at";
-- ALTER TABLE "photos" ALTER COLUMN "data" SET NOT NULL;
-- rollback-end
