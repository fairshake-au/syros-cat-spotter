ALTER TABLE "sighting_moves" DROP CONSTRAINT "sighting_moves_source_ck";--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "server_wait_ms" integer;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "phone_wait_ms" integer;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_server_wait_ck" CHECK ("sighting_matches"."server_wait_ms" IS NULL OR "sighting_matches"."server_wait_ms" >= 0);--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_phone_wait_ck" CHECK ("sighting_matches"."phone_wait_ms" IS NULL OR "sighting_matches"."phone_wait_ms" BETWEEN 0 AND 600000);--> statement-breakpoint
ALTER TABLE "sighting_moves" ADD CONSTRAINT "sighting_moves_source_ck" CHECK ("sighting_moves"."source" in ('cat_page', 'matched_by_hand', 'report', 'game', 'merge', 'undo', 'match_check'));

-- rollback-begin
-- -- Once any match_check move exists (Matches to check, SYC-795 PR 3), restoring the old source check below fails:
-- -- sighting_moves is append-only, so those rows can't be removed. Roll the code back first, and if any match_check
-- -- rows exist, skip the next two lines and leave the new source check in place.
-- ALTER TABLE "sighting_moves" DROP CONSTRAINT "sighting_moves_source_ck";
-- ALTER TABLE "sighting_moves" ADD CONSTRAINT "sighting_moves_source_ck" CHECK ("source" in ('cat_page', 'matched_by_hand', 'report', 'game', 'merge', 'undo'));
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_phone_wait_ck";
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_server_wait_ck";
-- ALTER TABLE "sighting_matches" DROP COLUMN "phone_wait_ms";
-- ALTER TABLE "sighting_matches" DROP COLUMN "server_wait_ms";
-- rollback-end
