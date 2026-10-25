CREATE UNIQUE INDEX "observations_supersedes_uq" ON "observations" USING btree ("supersedes_id") WHERE "observations"."supersedes_id" is not null;--> statement-breakpoint
DROP INDEX "observations_supersedes_idx";--> statement-breakpoint
CREATE INDEX "observations_colony_idx" ON "observations" USING btree (("value"->>'colonyId'),"cat_id") WHERE "observations"."kind" = 'colony';
-- rollback-begin
-- -- SYC-199: the unique index goes; the plain one from 0030 comes back. SYC-307: the colony index goes.
-- -- Safe at any time: indexes only, no data changes. App code needs no rollback first.
-- CREATE INDEX "observations_supersedes_idx" ON "observations" USING btree ("supersedes_id") WHERE "observations"."supersedes_id" is not null;
-- DROP INDEX "observations_supersedes_uq";
-- DROP INDEX "observations_colony_idx";
-- rollback-end
