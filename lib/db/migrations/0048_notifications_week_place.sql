ALTER TABLE "notifications" ADD COLUMN "place" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "week_points" integer;
-- SYC-706: the bell's weekly-result row carries the place and points so the app can word it in the spotter's language.
-- Rolling back drops both columns; the stored English message remains.
-- rollback-begin
-- ALTER TABLE "notifications" DROP COLUMN "week_points";
-- ALTER TABLE "notifications" DROP COLUMN "place";
-- rollback-end
