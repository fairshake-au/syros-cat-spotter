CREATE INDEX "observations_guardian_recent_idx" ON "observations" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "observations"."role_at_time" = 'guardian';--> statement-breakpoint
CREATE INDEX "observations_supersedes_idx" ON "observations" USING btree ("supersedes_id") WHERE "observations"."supersedes_id" is not null;
-- SYC-431: indexes only, for the team's "Recent changes by cat guardians"
-- (SYC-209 PR 4.3). No data changes; dropping them only makes the list slower.
-- rollback-begin
-- DROP INDEX "observations_supersedes_idx";
-- DROP INDEX "observations_guardian_recent_idx";
-- rollback-end
