-- SYC-759 part 1. Every add-only table refuses TRUNCATE (0001's shared
-- guard), but `cats` never did: `TRUNCATE cats CASCADE` emptied every cat
-- and, through their foreign keys, vet_batch_cats, vet_visit_photos and
-- vet_batch_photos, in one statement (checked on a scratch database, 1 Nov
-- 2026). Cats are never deleted in bulk: a cat is merged or let go, one row
-- at a time. TRUNCATE uses 0001's shared guard, as 0024 does for sites.
--
-- Tests that must empty `cats` switch the one trigger off for one statement
-- inside a transaction (ALTER TABLE ... DISABLE TRIGGER, the table owner's
-- right) and switch it back on, as the other guards are bypassed in tests.
CREATE TRIGGER "cats_no_truncate" BEFORE TRUNCATE ON "cats"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only_no_truncate"();
-- Rolling this back only removes the guard; no data changes.
-- rollback-begin
-- DROP TRIGGER "cats_no_truncate" ON "cats";
-- rollback-end
