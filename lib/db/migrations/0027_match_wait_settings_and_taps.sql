CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donation_link_taps" (
	"day" date PRIMARY KEY NOT NULL,
	"taps" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- SYC-36, Samuel's Decision 6 (15 Oct 2026, "show both and I'll confirm with
-- them"): the feeding nudge's figures and "Help feed a cat" button are on at
-- launch, pointing at Syros Cats' own donation page. If they say no, the row
-- is emptied with `db-ops set-setting` and the nudge goes words-only, with no
-- new release. DO NOTHING so a value already set is never overwritten.
INSERT INTO "app_settings" ("key", "value")
VALUES ('feed_nudge_donate_url', '"https://syroscats.com/donations"'::jsonb)
ON CONFLICT ("key") DO NOTHING;
-- Rolling this back forgets the switches (the server then uses its defaults:
-- no donation link, the nine sign-off facts hidden) and the daily tap counts.
-- Roll the app back first: new code reads both tables on every request to
-- /api/app-settings and /api/go/feed.
-- rollback-begin
-- DROP TABLE "donation_link_taps";
-- DROP TABLE "app_settings";
-- rollback-end
