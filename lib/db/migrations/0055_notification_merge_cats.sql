ALTER TABLE "notifications" ADD COLUMN "survivor_cat_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "merged_cat_id" integer;
-- rollback-begin
-- ALTER TABLE "notifications" DROP COLUMN "merged_cat_id";
-- --> statement-breakpoint
-- ALTER TABLE "notifications" DROP COLUMN "survivor_cat_id";
-- rollback-end
