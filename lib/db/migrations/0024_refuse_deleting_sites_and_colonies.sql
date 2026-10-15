-- SYC-298. Feeding sites and colonies are never deleted: a site is retired,
-- a colony is renamed (spec feeding-sites-and-colonies.md §2.5). Nothing in
-- the app deletes them, but mapping_events.subject_id has no foreign key, so
-- a stray delete would leave that history pointing at nothing. The database
-- now refuses it, whatever the app does, as 0014 and 0015 do for the
-- add-only history tables. TRUNCATE uses 0001's shared guard.
--
-- Tests that must clean up their own rows switch the one trigger off for one
-- statement inside a transaction (ALTER TABLE ... DISABLE TRIGGER, the table
-- owner's right) and switch it back on: the same way the other guards are
-- bypassed in tests.
CREATE FUNCTION "feeding_sites_never_deleted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'feeding_sites rows are never deleted: retire a site, rename a colony (id %)', OLD.id;
END $$;--> statement-breakpoint
CREATE TRIGGER "feeding_sites_never_deleted" BEFORE DELETE ON "feeding_sites"
  FOR EACH ROW EXECUTE FUNCTION "feeding_sites_never_deleted"();--> statement-breakpoint
CREATE TRIGGER "feeding_sites_no_truncate" BEFORE TRUNCATE ON "feeding_sites"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();--> statement-breakpoint
CREATE FUNCTION "colonies_never_deleted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'colonies rows are never deleted: retire a site, rename a colony (id %)', OLD.id;
END $$;--> statement-breakpoint
CREATE TRIGGER "colonies_never_deleted" BEFORE DELETE ON "colonies"
  FOR EACH ROW EXECUTE FUNCTION "colonies_never_deleted"();--> statement-breakpoint
CREATE TRIGGER "colonies_no_truncate" BEFORE TRUNCATE ON "colonies"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();
-- Rolling this back only removes the guards; no data changes. Roll the app
-- back first if it relies on deletes being refused (see
-- lib/db/migrations/README.md).
-- rollback-begin
-- DROP TRIGGER "feeding_sites_never_deleted" ON "feeding_sites";
-- DROP TRIGGER "feeding_sites_no_truncate" ON "feeding_sites";
-- DROP FUNCTION "feeding_sites_never_deleted"();
-- DROP TRIGGER "colonies_never_deleted" ON "colonies";
-- DROP TRIGGER "colonies_no_truncate" ON "colonies";
-- DROP FUNCTION "colonies_never_deleted"();
-- rollback-end
