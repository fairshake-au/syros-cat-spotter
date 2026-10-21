CREATE TABLE "report_downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"report" text NOT NULL,
	"range" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_downloads" ADD CONSTRAINT "report_downloads_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- SYC-396 PR 3.3a (dashboard §9.3): the record of report downloads is
-- add-only. It holds no contents and no free text, so unlike mapping_events
-- there is no redaction: every UPDATE and DELETE is refused, and TRUNCATE too
-- (append_only_no_truncate, from 0001).
CREATE FUNCTION "report_downloads_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'report_downloads is append-only: % is not allowed (id %)', lower(TG_OP), OLD.id;
END
$$;--> statement-breakpoint
CREATE TRIGGER "report_downloads_append_only" BEFORE UPDATE OR DELETE ON "report_downloads"
  FOR EACH ROW EXECUTE FUNCTION "report_downloads_append_only"();--> statement-breakpoint
CREATE TRIGGER "report_downloads_no_truncate" BEFORE TRUNCATE ON "report_downloads"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();

-- rollback-begin
-- DROP TRIGGER "report_downloads_no_truncate" ON "report_downloads";
-- DROP TRIGGER "report_downloads_append_only" ON "report_downloads";
-- DROP FUNCTION "report_downloads_append_only"();
-- DROP TABLE "report_downloads";
-- rollback-end
