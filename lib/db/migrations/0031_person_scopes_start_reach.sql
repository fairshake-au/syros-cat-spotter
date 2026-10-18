ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_reach_ck";--> statement-breakpoint
ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_guardian_colony_ck";--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_start_ck" CHECK ("person_scopes"."reach" <> 'start' OR ("person_scopes"."role" = 'guardian' AND "person_scopes"."colony_id" IS NULL AND "person_scopes"."expires_at" IS NULL AND "person_scopes"."relationship" IS NULL));--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_reach_ck" CHECK ("person_scopes"."reach" IN ('island', 'colony', 'start'));--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_guardian_colony_ck" CHECK ("person_scopes"."role" <> 'guardian' OR "person_scopes"."reach" IN ('colony', 'start'));

-- rollback-begin
-- LOCK TABLE "person_scopes" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "person_scopes" WHERE "reach" = 'start') THEN
--     RAISE EXCEPTION 'person_scopes: a cat guardian has "no colony yet" (reach start). Change her roles first; refusing to remove the start reach.';
--   END IF;
-- END $$;
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_guardian_colony_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_reach_ck";
-- ALTER TABLE "person_scopes" DROP CONSTRAINT "person_scopes_start_ck";
-- ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_reach_ck" CHECK ("person_scopes"."reach" IN ('island', 'colony'));
-- ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_guardian_colony_ck" CHECK ("person_scopes"."role" <> 'guardian' OR "person_scopes"."reach" = 'colony');
-- rollback-end
