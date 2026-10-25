ALTER TABLE "notifications" ALTER COLUMN "cat_update_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "kind" text DEFAULT 'cat' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_ck" CHECK (("notifications"."kind" = 'cat' and "notifications"."cat_update_id" is not null)
      or ("notifications"."kind" = 'week_result' and "notifications"."cat_update_id" is null and "notifications"."message" is not null));
-- SYC-706: the bell can hold a spotter's weekly result, which has no cat.
-- Rolling back deletes those weekly-result bell entries (they have no cat
-- update to point at), then puts the table back as it was. The celebration
-- itself lives in badge_moments and is not touched.
-- rollback-begin
-- DELETE FROM "notifications" WHERE "kind" <> 'cat' OR "cat_update_id" IS NULL;
-- ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_ck";
-- ALTER TABLE "notifications" DROP COLUMN "message";
-- ALTER TABLE "notifications" DROP COLUMN "kind";
-- ALTER TABLE "notifications" ALTER COLUMN "cat_update_id" SET NOT NULL;
-- rollback-end
