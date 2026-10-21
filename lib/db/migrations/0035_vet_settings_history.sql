ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_subject_kind_ck";--> statement-breakpoint
ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_kind_ck";--> statement-breakpoint
ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_subject_kind_ck" CHECK ("mapping_events"."subject_kind" in ('site', 'colony', 'named_area', 'vet_settings'));--> statement-breakpoint
ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_kind_ck" CHECK ("mapping_events"."kind" in ('existing', 'created', 'seeded', 'renamed', 'notes_edited', 'directions_edited', 'colony_changed', 'moved', 'made_public', 'made_private', 'made_private_moved', 'made_private_colony_changed', 'made_private_guardian_changed', 'label_changed', 'retired', 'restored', 'colony_created', 'colony_renamed', 'guardian_changed', 'colony_notes_changed', 'colony_centre_changed', 'guardian_forgotten', 'area_added', 'area_renamed', 'area_moved', 'area_retired', 'price_changed'));
-- SYC-396 PR 3.1b (dashboard §10.3): changes to the standard sterilisation
-- price are kept in the same add-only history as site, colony and area
-- changes, as subject 'vet_settings' (id 1) and kind 'price_changed'.
-- Nothing is seeded: until the team first changes the price, it is €60.
--
-- Rolling back narrows the checks again. It refuses once any price change is
-- in the history: those rows are the team's, the history is add-only, and the
-- narrower checks couldn't hold them anyway.
-- rollback-begin
-- LOCK TABLE "mapping_events" IN ACCESS EXCLUSIVE MODE;
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM "mapping_events" WHERE "subject_kind" = 'vet_settings' OR "kind" = 'price_changed') THEN
--     RAISE EXCEPTION 'vet_settings_history: the team has changed the standard price. Refusing to drop that history.';
--   END IF;
-- END $$;
-- ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_kind_ck";
-- ALTER TABLE "mapping_events" DROP CONSTRAINT "mapping_events_subject_kind_ck";
-- ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_subject_kind_ck" CHECK ("mapping_events"."subject_kind" in ('site', 'colony', 'named_area'));
-- ALTER TABLE "mapping_events" ADD CONSTRAINT "mapping_events_kind_ck" CHECK ("mapping_events"."kind" in ('existing', 'created', 'seeded', 'renamed', 'notes_edited', 'directions_edited', 'colony_changed', 'moved', 'made_public', 'made_private', 'made_private_moved', 'made_private_colony_changed', 'made_private_guardian_changed', 'label_changed', 'retired', 'restored', 'colony_created', 'colony_renamed', 'guardian_changed', 'colony_notes_changed', 'colony_centre_changed', 'guardian_forgotten', 'area_added', 'area_renamed', 'area_moved', 'area_retired'));
-- rollback-end
