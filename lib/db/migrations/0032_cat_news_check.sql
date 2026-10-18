CREATE TABLE "cat_news_baseline" (
	"cat_id" integer PRIMARY KEY NOT NULL,
	"sterilised_confirmed" boolean NOT NULL,
	"notified_sterilised_at" timestamp with time zone,
	"notified_homed_at" timestamp with time zone,
	"life_status" text NOT NULL,
	"last_sighting_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cat_news_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"cat_id" integer NOT NULL,
	"change" text NOT NULL,
	"evidence_ids" integer[] NOT NULL,
	"caused_by_devices" text[],
	"found_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"silenced_reason" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_note" text,
	CONSTRAINT "cat_news_changes_change_ck" CHECK ("cat_news_changes"."change" IN ('sterilised', 'homed', 'seen_again')),
	CONSTRAINT "cat_news_changes_state_ck" CHECK ("cat_news_changes"."state" IN ('watched', 'held', 'sent', 'silenced', 'expired')),
	CONSTRAINT "cat_news_changes_silenced_ck" CHECK (("cat_news_changes"."state" = 'silenced') = ("cat_news_changes"."silenced_reason" IS NOT NULL)),
	CONSTRAINT "cat_news_changes_reason_ck" CHECK ("cat_news_changes"."silenced_reason" IS NULL OR "cat_news_changes"."silenced_reason" IN ('import', 'legacy', 'old_news', 'first_seen', 'deceased', 'bulk'))
);
--> statement-breakpoint
CREATE TABLE "cat_news_runs" (
	"athens_date" date PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"cats_walked" integer NOT NULL,
	"changes_found" integer NOT NULL,
	"silenced_bulk" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cat_news_changes_found_idx" ON "cat_news_changes" USING btree ("found_at" DESC NULLS LAST);--> statement-breakpoint
COMMENT ON TABLE "cat_news_baseline" IS 'SYC-45: written only by the nightly news check (lib/news/nightly.ts), never read by the resolver or anything that shows a cat''s status. A cache for spotting changes, not a source of truth (email-capture.md §5.3, Risk 8). Safe to empty: the next run re-seeds and sends nothing.';

-- rollback-begin
-- DROP TABLE "cat_news_runs";
-- DROP TABLE "cat_news_changes";
-- DROP TABLE "cat_news_baseline";
-- rollback-end
