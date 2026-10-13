ALTER TABLE "cats" ADD COLUMN "home_lat" double precision;--> statement-breakpoint
ALTER TABLE "cats" ADD COLUMN "home_lng" double precision;--> statement-breakpoint
ALTER TABLE "cats" ADD CONSTRAINT "cats_home_pin_ck" CHECK (("cats"."home_lat" is null) = ("cats"."home_lng" is null));
-- rollback-begin
-- ALTER TABLE "cats" DROP CONSTRAINT "cats_home_pin_ck";
-- ALTER TABLE "cats" DROP COLUMN "home_lng";
-- ALTER TABLE "cats" DROP COLUMN "home_lat";
-- rollback-end
