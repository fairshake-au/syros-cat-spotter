-- SYC-44 PR 4.1 (docs/superpowers/plans/syc-44-report-an-issue.md, Slice 4):
-- make welfare_reports safe to share with "Report an issue" rows
-- (kind = 'content'). Nothing visible. Provisional number: re-generate if
-- another migration lands first.
--
-- The OLD resend key (reporter_device, client_ref) stays: the live upserts
-- name it until this PR is published. PR 4.2 drops it afterwards.
CREATE TABLE "issue_digest_runs" (
	"day" date PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "welfare_reports" ALTER COLUMN "lat" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "welfare_reports" ALTER COLUMN "lng" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "photo_id" integer;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "hidden_by_report" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "hide_skipped" text;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD COLUMN "note_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "welfare_reports_device_kind_client_ref_key" ON "welfare_reports" USING btree ("reporter_device","kind","client_ref");--> statement-breakpoint
CREATE INDEX "welfare_reports_kind_state_created_idx" ON "welfare_reports" USING btree ("kind","state","created_at");--> statement-breakpoint
CREATE INDEX "welfare_reports_photo_id_idx" ON "welfare_reports" USING btree ("photo_id");--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_position_ck" CHECK ("welfare_reports"."kind" <> 'welfare' or ("welfare_reports"."lat" is not null and "welfare_reports"."lng" is not null));--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_reason_ck" CHECK ("welfare_reports"."reason" is null or "welfare_reports"."reason" in ('photo_private', 'photo_inappropriate', 'photo_not_cat', 'wrong_cat', 'wrong_name', 'wrong_info', 'location_revealing', 'cat_died', 'other'));--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_reason_kind_ck" CHECK (("welfare_reports"."kind" = 'content') = ("welfare_reports"."reason" is not null));--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_hide_skipped_ck" CHECK ("welfare_reports"."hide_skipped" is null or "welfare_reports"."hide_skipped" in ('already_hidden', 'restored_before', 'address_limit', 'brake', 'unchecked'));--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_content_shape_ck" CHECK ("welfare_reports"."kind" <> 'content' or ("welfare_reports"."photo_state" = 'none' and "welfare_reports"."severity" = 'attention' and "welfare_reports"."is_litter" = false));--> statement-breakpoint
ALTER TABLE "welfare_reports" ADD CONSTRAINT "welfare_reports_photo_reason_photo_ck" CHECK ("welfare_reports"."reason" is null or "welfare_reports"."reason" not in ('photo_private', 'photo_inappropriate', 'photo_not_cat') or "welfare_reports"."photo_id" is not null);

-- Additive except lat/lng, which become nullable (only kind = 'content' rows
-- may leave them empty; welfare_reports_position_ck keeps them required for
-- welfare rows). Roll the app back first, then the database.
-- rollback-begin
-- -- DELETES EVERY "REPORT AN ISSUE" ROW FIRST: THE WELFARE ROWS' "POSITION ALWAYS PRESENT" RULE CANNOT COME BACK WHILE THEY EXIST.
-- DELETE FROM "welfare_reports" WHERE "kind" = 'content';
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_photo_reason_photo_ck";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_content_shape_ck";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_hide_skipped_ck";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_reason_kind_ck";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_reason_ck";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_position_ck";
-- DROP INDEX "welfare_reports_photo_id_idx";
-- DROP INDEX "welfare_reports_kind_state_created_idx";
-- DROP INDEX "welfare_reports_device_kind_client_ref_key";
-- ALTER TABLE "welfare_reports" DROP CONSTRAINT "welfare_reports_photo_id_photos_id_fk";
-- ALTER TABLE "welfare_reports" DROP COLUMN "note_cleared_at";
-- ALTER TABLE "welfare_reports" DROP COLUMN "hide_skipped";
-- ALTER TABLE "welfare_reports" DROP COLUMN "hidden_by_report";
-- ALTER TABLE "welfare_reports" DROP COLUMN "photo_id";
-- ALTER TABLE "welfare_reports" DROP COLUMN "reason";
-- ALTER TABLE "welfare_reports" ALTER COLUMN "lng" SET NOT NULL;
-- ALTER TABLE "welfare_reports" ALTER COLUMN "lat" SET NOT NULL;
-- DROP TABLE "issue_digest_runs";
-- rollback-end
