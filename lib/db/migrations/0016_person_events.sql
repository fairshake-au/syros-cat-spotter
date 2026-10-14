CREATE TABLE "person_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb,
	CONSTRAINT "person_events_kind_ck" CHECK ("person_events"."kind" in ('invited', 'invite_sent', 'invite_resent', 'invite_withdrawn', 'accepted', 'added', 'roles_changed', 'left', 'rejoined', 'signed_out_everywhere', 'anonymised'))
);
--> statement-breakpoint
ALTER TABLE "person_events" ADD CONSTRAINT "person_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_events_person_idx" ON "person_events" USING btree ("person_id","id");--> statement-breakpoint
-- SYC-53 PR 0.1 / SYC-213 (roles-and-invites.md §11.1): the record of who
-- changed what on the list of people. Add-only, as photo_visibility_events is
-- (0014): an update or a delete is refused here, whatever the app does.
-- TRUNCATE uses 0001's shared guard.
CREATE FUNCTION "person_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'person_events is append-only: % is not allowed', TG_OP;
END $$;--> statement-breakpoint
CREATE TRIGGER "person_events_append_only" BEFORE UPDATE OR DELETE ON "person_events"
  FOR EACH ROW EXECUTE FUNCTION "person_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "person_events_no_truncate" BEFORE TRUNCATE ON "person_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
-- Backfill: one `added` event for every existing person (from added_by and
-- added_at; `system:migration` where the address was added by something that
-- left no author), and one `left` event for anyone with left_at set. The
-- `left` detail holds the role names and colony ids they hold now, which is
-- what they held when they left: nothing can change a left person's roles.
-- Ordered by time, so `added` always sorts before `left` for the same person.
INSERT INTO "person_events" ("person_id", "kind", "by", "at", "detail")
SELECT p.id, 'added', coalesce(p.added_by, 'system:migration'), p.added_at,
       jsonb_build_object('backfilled', true)
  FROM people p
 ORDER BY p.added_at, p.id;--> statement-breakpoint
INSERT INTO "person_events" ("person_id", "kind", "by", "at", "detail")
SELECT p.id, 'left', coalesce(p.left_by, 'system:migration'), p.left_at,
       jsonb_build_object(
         'backfilled', true,
         'roles', coalesce((SELECT jsonb_agg(DISTINCT s.role) FROM person_scopes s WHERE s.person_id = p.id), '[]'::jsonb),
         'colonyIds', coalesce((SELECT jsonb_agg(DISTINCT s.colony_id) FROM person_scopes s WHERE s.person_id = p.id AND s.colony_id IS NOT NULL), '[]'::jsonb)
       )
  FROM people p
 WHERE p.left_at IS NOT NULL
 ORDER BY p.left_at, p.id;
-- ROLLING THIS BACK DELETES THE WHOLE RECORD OF WHO ADDED, REMOVED OR
-- CHANGED EVERY PERSON, AND IT CANNOT BE REBUILT. A re-run of the migration
-- only restores one "added" and one "left" line per person from the people
-- table, as the backfill does; every later role change, sign-out and rejoin
-- is gone for good. Take a Neon snapshot first. Roll the app back first: the
-- people commands write to this table in the same transaction as every
-- change, so new code against the old schema fails on every add, mark-left
-- and sign-out (see lib/db/migrations/README.md).
-- rollback-begin
-- DROP TABLE "person_events";
-- DROP FUNCTION "person_events_append_only"();
-- rollback-end
