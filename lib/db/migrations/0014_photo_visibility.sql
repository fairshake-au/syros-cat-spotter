CREATE TABLE "photo_visibility_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"photo_id" integer NOT NULL,
	"action" text NOT NULL,
	"author" text NOT NULL,
	"person_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_visibility_events_action_ck" CHECK ("photo_visibility_events"."action" in ('hide', 'restore')),
	CONSTRAINT "photo_visibility_events_author_ck" CHECK (("photo_visibility_events"."person_id" is not null and "photo_visibility_events"."author" = "photo_visibility_events"."person_id"::text) or ("photo_visibility_events"."person_id" is null and "photo_visibility_events"."author" ~ '^report:.+$'))
);
--> statement-breakpoint
ALTER TABLE "photo_visibility_events" ADD CONSTRAINT "photo_visibility_events_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_visibility_events" ADD CONSTRAINT "photo_visibility_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_visibility_events_photo_idx" ON "photo_visibility_events" USING btree ("photo_id","id" DESC NULLS LAST);--> statement-breakpoint
-- SYC-43 part 2, PR 6 (Decision 3): the hide/restore log is add-only. Every
-- insert is a new event; an update or a delete is refused here, whatever the
-- app does. TRUNCATE uses 0001's shared guard.
CREATE FUNCTION "photo_visibility_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'photo_visibility_events is append-only: % is not allowed', TG_OP;
END $$;--> statement-breakpoint
CREATE TRIGGER "photo_visibility_events_append_only" BEFORE UPDATE OR DELETE ON "photo_visibility_events"
  FOR EACH ROW EXECUTE FUNCTION "photo_visibility_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "photo_visibility_events_no_truncate" BEFORE TRUNCATE ON "photo_visibility_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();
-- ROLLING THIS BACK UN-HIDES EVERY HIDDEN PHOTO AT ONCE, AND ERASES WHO HID
-- WHAT. Every photo the team (or a public report) took down goes straight back
-- into the public catalogue. Take a Neon snapshot first, and list what is
-- hidden (select photo_id from photo_visibility_events, newest event per photo
-- = 'hide'), so it can be hidden again by hand. Roll the app back first: it
-- reads this table on every public cat and photo request (see
-- lib/db/migrations/README.md).
-- rollback-begin
-- DROP TABLE "photo_visibility_events";
-- DROP FUNCTION "photo_visibility_events_append_only"();
-- rollback-end
