CREATE TABLE "mail_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"report_id" integer,
	"recipient_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_state_ck" CHECK ("mail_outbox"."state" in ('queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "welfare_report_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"report_id" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"mime" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welfare_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"kind" text DEFAULT 'welfare' NOT NULL,
	"severity" text NOT NULL,
	"is_litter" boolean DEFAULT false NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"note" text,
	"reporter_language" text DEFAULT 'en' NOT NULL,
	"reporter_device" text,
	"reporter_contact_id" integer,
	"cat_id" integer,
	"state" text DEFAULT 'new' NOT NULL,
	"state_changed_at" timestamp with time zone,
	"state_changed_by" text,
	"team_note" text,
	"is_draft" boolean DEFAULT false NOT NULL,
	"client_ref" text NOT NULL,
	"photo_state" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "welfare_reports_kind_ck" CHECK ("welfare_reports"."kind" in ('welfare', 'content')),
	CONSTRAINT "welfare_reports_severity_ck" CHECK ("welfare_reports"."severity" in ('attention', 'urgent')),
	CONSTRAINT "welfare_reports_state_ck" CHECK ("welfare_reports"."state" in ('new', 'looking', 'done', 'nothing_needed')),
	CONSTRAINT "welfare_reports_photo_state_ck" CHECK ("welfare_reports"."photo_state" in ('pending', 'attached', 'none', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_report_id_welfare_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."welfare_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welfare_report_photos" ADD CONSTRAINT "welfare_report_photos_report_id_welfare_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."welfare_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "mail_outbox" USING btree ("next_attempt_at") WHERE "mail_outbox"."state" in ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "mail_outbox_report_idx" ON "mail_outbox" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "welfare_report_photos_public_id_key" ON "welfare_report_photos" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "welfare_report_photos_report_id_key" ON "welfare_report_photos" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "welfare_reports_public_id_key" ON "welfare_reports" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "welfare_reports_device_client_ref_key" ON "welfare_reports" USING btree ("reporter_device","client_ref");--> statement-breakpoint
CREATE INDEX "welfare_reports_queue_idx" ON "welfare_reports" USING btree ("is_draft","state","created_at");
-- rollback-begin
-- DROP TABLE "mail_outbox";
-- DROP TABLE "welfare_report_photos";
-- DROP TABLE "welfare_reports";
-- rollback-end
