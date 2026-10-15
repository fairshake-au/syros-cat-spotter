CREATE TABLE "rate_limit_counters" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_ms" integer NOT NULL,
	"hits" integer NOT NULL,
	CONSTRAINT "rate_limit_counters_bucket_key_window_start_pk" PRIMARY KEY("bucket","key","window_start")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_salts" (
	"day" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- Rolling this back only forgets recent rate-limit counts (throwaway
-- windows, none longer than a day), so limits start fresh. Roll the app back
-- first: new code counts every limited request here, and with the table gone
-- the cat-in-trouble routes let requests through while every other limiter
-- refuses.
-- rollback-begin
-- DROP TABLE "rate_limit_counters";
-- DROP TABLE "rate_limit_salts";
-- rollback-end
