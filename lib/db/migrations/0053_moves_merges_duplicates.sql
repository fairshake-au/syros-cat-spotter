CREATE TABLE "merge_follow_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"merge_id" integer NOT NULL,
	"device_id" text NOT NULL,
	"kind" text NOT NULL,
	"row_created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "merge_follow_changes_kind_ck" CHECK ("merge_follow_changes"."kind" in ('follow', 'unfollow'))
);
--> statement-breakpoint
CREATE TABLE "sighting_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"sighting_id" integer NOT NULL,
	"from_cat_id" integer NOT NULL,
	"to_cat_id" integer NOT NULL,
	"made_new_cat" boolean DEFAULT false NOT NULL,
	"let_spotters_name" boolean DEFAULT false NOT NULL,
	"merge_id" integer,
	"batch_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reason_text" text,
	"source" text NOT NULL,
	"moved_by_account_id" text,
	"role_at_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"txid" bigint DEFAULT txid_current() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "sighting_moves_cats_ck" CHECK ("sighting_moves"."from_cat_id" <> "sighting_moves"."to_cat_id"),
	CONSTRAINT "sighting_moves_spotters_name_ck" CHECK (not "sighting_moves"."let_spotters_name" or "sighting_moves"."made_new_cat"),
	CONSTRAINT "sighting_moves_merge_ck" CHECK (("sighting_moves"."reason" in ('merged', 'merge_undone')) = ("sighting_moves"."merge_id" is not null)),
	CONSTRAINT "sighting_moves_mover_ck" CHECK ("sighting_moves"."moved_by_account_id" is not null or "sighting_moves"."redacted_at" is not null),
	CONSTRAINT "sighting_moves_reason_ck" CHECK ("sighting_moves"."reason" in ('different_markings', 'two_cats', 'wrong_pick', 'other', 'merged', 'merge_undone')),
	CONSTRAINT "sighting_moves_source_ck" CHECK ("sighting_moves"."source" in ('cat_page', 'matched_by_hand', 'report', 'game', 'merge', 'undo')),
	CONSTRAINT "sighting_moves_role_ck" CHECK ("sighting_moves"."role_at_time" in ('staff', 'management'))
);
--> statement-breakpoint
CREATE TABLE "duplicate_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_low" integer NOT NULL,
	"cat_high" integer NOT NULL,
	"decision" text NOT NULL,
	"merge_id" integer,
	"note" text,
	"by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "duplicate_decisions_pair_ck" CHECK ("duplicate_decisions"."cat_low" < "duplicate_decisions"."cat_high"),
	CONSTRAINT "duplicate_decisions_decision_ck" CHECK ("duplicate_decisions"."decision" in ('merged', 'different', 'not_sure', 'merge_undone')),
	CONSTRAINT "duplicate_decisions_merge_ck" CHECK (("duplicate_decisions"."decision" in ('merged', 'merge_undone')) = ("duplicate_decisions"."merge_id" is not null)),
	CONSTRAINT "duplicate_decisions_by_ck" CHECK ("duplicate_decisions"."by_account_id" is not null or "duplicate_decisions"."redacted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "duplicate_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_low" integer NOT NULL,
	"cat_high" integer NOT NULL,
	"source" text NOT NULL,
	"says" text NOT NULL,
	"device_id" text,
	"sighting_id" integer,
	"score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "duplicate_reports_pair_ck" CHECK ("duplicate_reports"."cat_low" < "duplicate_reports"."cat_high"),
	CONSTRAINT "duplicate_reports_source_ck" CHECK ("duplicate_reports"."source" in ('spotter_question', 'new_cat_check', 'sweep', 'game', 'team')),
	CONSTRAINT "duplicate_reports_says_ck" CHECK ("duplicate_reports"."says" in ('same', 'different', 'not_sure'))
);
--> statement-breakpoint
CREATE TABLE "new_cat_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer NOT NULL,
	"by_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "new_cat_checks_by_ck" CHECK ("new_cat_checks"."by_account_id" is not null or "new_cat_checks"."redacted_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_ck";--> statement-breakpoint
DROP INDEX "points_ledger_once_a_day_uq";--> statement-breakpoint
ALTER TABLE "points_ledger" ALTER COLUMN "sighting_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "reason_text" text;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "by_account_id" text;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "role_at_time" text;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "survivor_chosen" text;--> statement-breakpoint
-- A volatile default (txid_current()) makes ADD COLUMN rewrite the table and
-- stamp every existing row with this migration's transaction id. cat_identity
-- is empty in production (nothing in the app writes it yet, SYC-59), so the
-- rewrite is harmless, and no existing row could pass a guard's
-- "txid = txid_current()" check in a later transaction anyway.
ALTER TABLE "cat_identity" ADD COLUMN "txid" bigint DEFAULT txid_current() NOT NULL;--> statement-breakpoint
ALTER TABLE "cat_identity" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "sighting_move_id" integer;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_action" text;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_cat_id" integer;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_by_account_id" text;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "team_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD COLUMN "duplicate_cat_low" integer;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD COLUMN "duplicate_cat_high" integer;--> statement-breakpoint
CREATE INDEX "merge_follow_changes_merge_idx" ON "merge_follow_changes" USING btree ("merge_id");--> statement-breakpoint
CREATE INDEX "merge_follow_changes_device_idx" ON "merge_follow_changes" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "sighting_moves_sighting_idx" ON "sighting_moves" USING btree ("sighting_id","id");--> statement-breakpoint
CREATE INDEX "sighting_moves_merge_idx" ON "sighting_moves" USING btree ("merge_id");--> statement-breakpoint
CREATE INDEX "duplicate_decisions_pair_idx" ON "duplicate_decisions" USING btree ("cat_low","cat_high","id");--> statement-breakpoint
CREATE INDEX "duplicate_reports_pair_idx" ON "duplicate_reports" USING btree ("cat_low","cat_high");--> statement-breakpoint
CREATE INDEX "duplicate_reports_device_idx" ON "duplicate_reports" USING btree ("device_id") WHERE "duplicate_reports"."device_id" is not null;--> statement-breakpoint
CREATE INDEX "new_cat_checks_cat_idx" ON "new_cat_checks" USING btree ("cat_id","id");--> statement-breakpoint
CREATE INDEX "sightings_cat_idx" ON "sightings" USING btree ("cat_id") WHERE "sightings"."cat_id" is not null;--> statement-breakpoint
CREATE INDEX "cat_identity_canonical_idx" ON "cat_identity" USING btree ("canonical_cat_id");--> statement-breakpoint
CREATE INDEX "cat_identity_cat_idx" ON "cat_identity" USING btree ("cat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_duplicate_pair_uq" ON "points_ledger" USING btree ("device_id","duplicate_cat_low","duplicate_cat_high");--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_once_a_day_uq" ON "points_ledger" USING btree ("device_id","cat_id","athens_day") WHERE "points_ledger"."sighting_id" is not null and "points_ledger"."points" > 0;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_ck" CHECK (("notifications"."kind" = 'cat' and "notifications"."cat_update_id" is not null)
      or ("notifications"."kind" in ('week_result', 'merged', 'duplicate_points') and "notifications"."cat_update_id" is null and "notifications"."message" is not null));--> statement-breakpoint
ALTER TABLE "cat_identity" ADD CONSTRAINT "cat_identity_survivor_chosen_ck" CHECK ("cat_identity"."survivor_chosen" is null or "cat_identity"."survivor_chosen" in ('default', 'switched'));--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_team_action_ck" CHECK ("sighting_matches"."team_action" IS NULL OR "sighting_matches"."team_action" IN ('matched', 'made_new_cat', 'looks_right', 'different_cat', 'new_cat', 'hidden'));--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_team_step_ck" CHECK (("sighting_matches"."team_action" IS NULL) = ("sighting_matches"."team_at" IS NULL)
        AND ("sighting_matches"."team_action" IS NOT NULL OR "sighting_matches"."team_by_account_id" IS NULL)
        AND ("sighting_matches"."team_action" IS NULL OR "sighting_matches"."team_by_account_id" IS NOT NULL OR "sighting_matches"."redacted_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_team_cat_ck" CHECK (("sighting_matches"."team_cat_id" IS NOT NULL) = coalesce("sighting_matches"."team_action" IN ('matched', 'made_new_cat', 'different_cat', 'new_cat'), false));--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_award_ck" CHECK (("points_ledger"."sighting_id" is not null and "points_ledger"."duplicate_cat_low" is null and "points_ledger"."duplicate_cat_high" is null)
        or ("points_ledger"."sighting_id" is null and "points_ledger"."duplicate_cat_low" is not null and "points_ledger"."duplicate_cat_high" is not null
          and "points_ledger"."duplicate_cat_low" < "points_ledger"."duplicate_cat_high"));

-- rollback-begin
-- -- SYC-150 PR 2.1. Roll the app back first: code that writes moves, merges or duplicates needs all of this.
-- -- Lost on the way down: every move, merge detail, follow change, duplicate report, decision and check;
-- -- the duplicate-finder points rows (profiles.points keeps what they paid); and the merged and
-- -- duplicate_points bell lines, which the old check would refuse.
-- DELETE FROM "notifications" WHERE "kind" IN ('merged', 'duplicate_points');
-- ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_ck";
-- ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_ck" CHECK (("notifications"."kind" = 'cat' and "notifications"."cat_update_id" is not null)
--       or ("notifications"."kind" = 'week_result' and "notifications"."cat_update_id" is null and "notifications"."message" is not null));
-- DELETE FROM "points_ledger" WHERE "sighting_id" IS NULL;
-- ALTER TABLE "points_ledger" DROP CONSTRAINT "points_ledger_award_ck";
-- DROP INDEX "points_ledger_duplicate_pair_uq";
-- DROP INDEX "points_ledger_once_a_day_uq";
-- CREATE UNIQUE INDEX "points_ledger_once_a_day_uq" ON "points_ledger" USING btree ("device_id","cat_id","athens_day") WHERE "points_ledger"."points" > 0;
-- ALTER TABLE "points_ledger" DROP COLUMN "duplicate_cat_high";
-- ALTER TABLE "points_ledger" DROP COLUMN "duplicate_cat_low";
-- ALTER TABLE "points_ledger" ALTER COLUMN "sighting_id" SET NOT NULL;
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_team_cat_ck";
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_team_step_ck";
-- ALTER TABLE "sighting_matches" DROP CONSTRAINT "sighting_matches_team_action_ck";
-- ALTER TABLE "sighting_matches" DROP COLUMN "redacted_at";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_at";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_by_account_id";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_cat_id";
-- ALTER TABLE "sighting_matches" DROP COLUMN "team_action";
-- ALTER TABLE "observations" DROP COLUMN "sighting_move_id";
-- ALTER TABLE "cat_identity" DROP CONSTRAINT "cat_identity_survivor_chosen_ck";
-- DROP INDEX "cat_identity_cat_idx";
-- DROP INDEX "cat_identity_canonical_idx";
-- ALTER TABLE "cat_identity" DROP COLUMN "redacted_at";
-- ALTER TABLE "cat_identity" DROP COLUMN "txid";
-- ALTER TABLE "cat_identity" DROP COLUMN "survivor_chosen";
-- ALTER TABLE "cat_identity" DROP COLUMN "role_at_time";
-- ALTER TABLE "cat_identity" DROP COLUMN "by_account_id";
-- ALTER TABLE "cat_identity" DROP COLUMN "reason_text";
-- DROP INDEX "sightings_cat_idx";
-- DROP TABLE "new_cat_checks";
-- DROP TABLE "duplicate_reports";
-- DROP TABLE "duplicate_decisions";
-- DROP TABLE "sighting_moves";
-- DROP TABLE "merge_follow_changes";
-- rollback-end