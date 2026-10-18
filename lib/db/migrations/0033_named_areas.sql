CREATE TABLE "named_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "named_areas_key_unique" UNIQUE("key"),
	CONSTRAINT "named_areas_key_ck" CHECK ("named_areas"."key" ~ '^[a-z][a-z0-9-]{1,30}$' and "named_areas"."key" <> 'off')
);
--> statement-breakpoint
-- The history checks are widened FIRST, so the seed events below are allowed.
ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_subject_kind_ck";--> statement-breakpoint
ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_kind_ck";--> statement-breakpoint
CREATE UNIQUE INDEX "named_areas_live_name_unique" ON "named_areas" USING btree (lower("name")) WHERE "named_areas"."retired_at" is null;--> statement-breakpoint
ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_subject_kind_ck" CHECK ("mapping_events"."subject_kind" in ('site', 'colony', 'named_area'));--> statement-breakpoint
ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_kind_ck" CHECK ("mapping_events"."kind" in ('existing', 'created', 'seeded', 'renamed', 'notes_edited', 'directions_edited', 'colony_changed', 'moved', 'made_public', 'made_private', 'made_private_moved', 'made_private_colony_changed', 'made_private_guardian_changed', 'label_changed', 'retired', 'restored', 'colony_created', 'colony_renamed', 'guardian_changed', 'colony_notes_changed', 'colony_centre_changed', 'guardian_forgotten', 'area_added', 'area_renamed', 'area_moved', 'area_retired'));;--> statement-breakpoint
-- SYC-396 PR 2.4: today's 21 areas (artifacts/api-server/src/lib/areas/
-- namedAreas.ts SEED_AREAS), in the same order with the same keys. (The plan
-- said 22: it counted Off Syros, which is not an area.) Version 1 of the list
-- was approved on 15 Oct 2026, so the rows and their history are dated then:
-- namedAreasAt() for any moment from 15 Oct gives this list, and before it
-- falls back to SEED_AREAS as version 0.
INSERT INTO "named_areas" ("key", "name", "lat", "lng", "created_at") VALUES
  ('ermoupoli', 'Ermoupoli', 37.4447, 24.9417, '2026-10-15T00:00:00Z'),
  ('vaporia', 'Vaporia', 37.4447, 24.9475, '2026-10-15T00:00:00Z'),
  ('kini', 'Kini', 37.4436, 24.8889, '2026-10-15T00:00:00Z'),
  ('galissas', 'Galissas', 37.4226, 24.8825, '2026-10-15T00:00:00Z'),
  ('finikas', 'Finikas', 37.3976, 24.8783, '2026-10-15T00:00:00Z'),
  ('posidonia', 'Posidonia', 37.3889, 24.8874, '2026-10-15T00:00:00Z'),
  ('azolimnos', 'Azolimnos', 37.4105, 24.9594, '2026-10-15T00:00:00Z'),
  ('ano-syros', 'Ano Syros', 37.4501993, 24.9357722, '2026-10-15T00:00:00Z'),
  ('vari', 'Vari', 37.3983488, 24.9467109, '2026-10-15T00:00:00Z'),
  ('fabrika', 'Fabrika', 37.3919149, 24.9528053, '2026-10-15T00:00:00Z'),
  ('manna', 'Manna', 37.4196393, 24.947383, '2026-10-15T00:00:00Z'),
  ('mega-gialos', 'Mega Gialos', 37.3809687, 24.9109853, '2026-10-15T00:00:00Z'),
  ('chroussa', 'Chroussa', 37.4022955, 24.9193522, '2026-10-15T00:00:00Z'),
  ('kampos', 'Kampos', 37.4938214, 24.915293, '2026-10-15T00:00:00Z'),
  ('chalandriani', 'Chalandriani', 37.4847709, 24.9357413, '2026-10-15T00:00:00Z'),
  ('syringas', 'Syringas', 37.4843924, 24.9132138, '2026-10-15T00:00:00Z'),
  ('aetos', 'Aetos', 37.4727567, 24.9021428, '2026-10-15T00:00:00Z'),
  ('lia', 'Lia', 37.489323, 24.9019931, '2026-10-15T00:00:00Z'),
  ('grammata', 'Grammata', 37.4993396, 24.8878902, '2026-10-15T00:00:00Z'),
  ('pagos', 'Pagos', 37.4166124, 24.9052657, '2026-10-15T00:00:00Z'),
  ('episkopio', 'Episkopio', 37.4367321, 24.9179183, '2026-10-15T00:00:00Z');--> statement-breakpoint
-- One area_added per row, holding the whole row, signed by the migration.
INSERT INTO "mapping_events" ("subject_kind", "subject_id", "kind", "actor_system", "at", "after")
SELECT 'named_area', "id", 'area_added', 'system:migration', '2026-10-15T00:00:00Z',
       jsonb_build_object('key', "key", 'name', "name", 'lat', "lat", 'lng', "lng", 'retired', false)
  FROM "named_areas" ORDER BY "id";

-- Rolling back drops the table and narrows the history checks again. The
-- seed's own history rows go too (the add-only trigger is switched off for
-- that one statement, as the tests do). If the team has changed an area, the
-- rollback refuses: that history is theirs, and must not be thrown away.
-- rollback-begin
-- LOCK TABLE "mapping_events", "named_areas" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "mapping_events" WHERE "subject_kind" = 'named_area'
--              AND "actor_system" IS DISTINCT FROM 'system:migration') THEN
--     RAISE EXCEPTION 'named_areas: the team has changed the areas. Refusing to drop their history.';
--   END IF;
-- END $$;
-- ALTER TABLE "mapping_events" DISABLE TRIGGER "mapping_events_append_only";
-- DELETE FROM "mapping_events" WHERE "subject_kind" = 'named_area' AND "actor_system" = 'system:migration';
-- ALTER TABLE "mapping_events" ENABLE TRIGGER "mapping_events_append_only";
-- ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_kind_ck";
-- ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_subject_kind_ck";
-- ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_subject_kind_ck" CHECK ("mapping_events"."subject_kind" in ('site', 'colony'));
-- ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_kind_ck" CHECK ("mapping_events"."kind" in ('existing', 'created', 'seeded', 'renamed', 'notes_edited', 'directions_edited', 'colony_changed', 'moved', 'made_public', 'made_private', 'made_private_moved', 'made_private_colony_changed', 'made_private_guardian_changed', 'label_changed', 'retired', 'restored', 'colony_created', 'colony_renamed', 'guardian_changed', 'colony_notes_changed', 'colony_centre_changed', 'guardian_forgotten'));
-- DROP TABLE "named_areas";
-- rollback-end
