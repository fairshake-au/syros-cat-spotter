CREATE TABLE "report_state_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"person_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reporter_message" text,
	CONSTRAINT "report_state_events_from_state_ck" CHECK ("report_state_events"."from_state" in ('new', 'looking', 'done', 'nothing_needed')),
	CONSTRAINT "report_state_events_to_state_ck" CHECK ("report_state_events"."to_state" in ('new', 'looking', 'done', 'nothing_needed'))
);
--> statement-breakpoint
LOCK TABLE "welfare_reports" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "welfare_reports" WHERE "state_changed_by" IS NOT NULL) THEN
    RAISE EXCEPTION 'welfare_reports.state_changed_by is not empty; converting text to uuid would need a data decision. Refusing.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "welfare_reports" ALTER COLUMN "state_changed_by" SET DATA TYPE uuid USING "state_changed_by"::uuid;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "team_note_by" uuid;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "team_note_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_state_events" ADD CONSTRAINT "report_state_events_report_id_welfare_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."welfare_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_state_events" ADD CONSTRAINT "report_state_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_state_events_report_idx" ON "report_state_events" USING btree ("report_id","at");--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_state_changed_by_people_id_fk" FOREIGN KEY ("state_changed_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_team_note_by_people_id_fk" FOREIGN KEY ("team_note_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
-- SYC-43 part 2, PR 1 (Decision 7). state_changed_by changes from text to uuid
-- and gets a strict link to people.id (no cascade, no set-null); team_note_by
-- gets the same link. All three were empty in production when this was
-- written (nothing wrote them), and the DO block above refuses to run if
-- state_changed_by is not. The USING clause is needed because Postgres has no
-- automatic text-to-uuid cast; it is safe only because of that check.
--
-- Rolling back drops report_state_events, team_note_by and team_note_at, which
-- would erase who moved and who noted reports. So the rollback refuses once
-- any of that exists; take a snapshot and decide by hand then. Roll the app
-- back first (it selects the new columns); see lib/db/migrations/README.md.
-- rollback-begin
-- LOCK TABLE "welfare_reports" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "report_state_events")
--      OR EXISTS (SELECT 1 FROM "welfare_reports" WHERE "team_note_by" IS NOT NULL OR "team_note_at" IS NOT NULL) THEN
--     RAISE EXCEPTION 'welfare queue: report_state_events or team notes hold history; rolling back would erase who did what. Refusing.';
--   END IF;
-- END $$;
-- DROP TABLE "report_state_events";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_team_note_by_people_id_fk";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_state_changed_by_people_id_fk";
-- ALTER TABLE "welfare_reports" DROP COLUMN "team_note_at";
-- ALTER TABLE "welfare_reports" DROP COLUMN "team_note_by";
-- ALTER TABLE "welfare_reports" ALTER COLUMN "state_changed_by" SET DATA TYPE text USING "state_changed_by"::text;
-- rollback-end
