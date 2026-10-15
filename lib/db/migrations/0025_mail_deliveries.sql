CREATE TABLE "mail_deliveries" (
	"provider_message_id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"report_id" integer,
	"recipient_hash" text NOT NULL,
	"state" text DEFAULT 'accepted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_deliveries_state_ck" CHECK ("mail_deliveries"."state" in ('accepted', 'delivered', 'bounced', 'complained', 'suppressed'))
);
--> statement-breakpoint
CREATE INDEX "mail_deliveries_report_idx" ON "mail_deliveries" USING btree ("report_id");
-- rollback-begin
-- DROP TABLE "mail_deliveries";
-- rollback-end
