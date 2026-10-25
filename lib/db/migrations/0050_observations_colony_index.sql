CREATE INDEX "observations_colony_idx" ON "observations" USING btree (("value"->>'colonyId'),"cat_id") WHERE "observations"."kind" = 'colony';
-- rollback-begin
-- -- SYC-307: indexes only, no data changes. App code needs no rollback first (the colony page just gets slower).
-- DROP INDEX "observations_colony_idx";
-- rollback-end
