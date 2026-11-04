ALTER TABLE "cat_updates" ADD COLUMN "wording" text;--> statement-breakpoint
ALTER TABLE "cat_updates" ADD COLUMN "wording_day" date;--> statement-breakpoint
ALTER TABLE "cat_updates" ADD CONSTRAINT "cat_updates_wording_check" CHECK ("cat_updates"."wording" is null or "cat_updates"."wording" in ('sterilised', 'spotted_again', 'seen_weekday', 'seen_date', 'new_cat'));--> statement-breakpoint
ALTER TABLE "cat_updates" ADD CONSTRAINT "cat_updates_wording_day_check" CHECK (("cat_updates"."wording_day" is not null) = coalesce("cat_updates"."wording" in ('seen_weekday', 'seen_date'), false));
-- rollback-begin
-- ALTER TABLE "cat_updates" DROP CONSTRAINT "cat_updates_wording_day_check";
-- --> statement-breakpoint
-- ALTER TABLE "cat_updates" DROP CONSTRAINT "cat_updates_wording_check";
-- --> statement-breakpoint
-- ALTER TABLE "cat_updates" DROP COLUMN "wording_day";
-- --> statement-breakpoint
-- ALTER TABLE "cat_updates" DROP COLUMN "wording";
-- rollback-end
