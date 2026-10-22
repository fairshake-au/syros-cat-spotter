ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_picked_from_ck";--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_picked_from_ck" CHECK ("sighting_matches"."picked_from" IS NULL OR "sighting_matches"."picked_from" IN ('nearby', 'search', 'name_prompt', 'cat_page'));
-- rollback-begin
-- UPDATE "sighting_matches" SET "picked_from" = NULL WHERE "picked_from" = 'cat_page';
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_picked_from_ck";
-- ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_picked_from_ck" CHECK ("sighting_matches"."picked_from" IS NULL OR "sighting_matches"."picked_from" IN ('nearby', 'search', 'name_prompt'));
-- rollback-end
