CREATE TABLE "push_roundup_runs" (
	"round_up_date" date PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"devices" integer
);

-- data-spine.md PR 9 (SYC-218): one row per evening sighting round-up, keyed
-- by its Europe/Athens date; inserting the row is the claim. Holds no device
-- id. Additive: old code never reads it, so rollback is a plain drop (the
-- only loss is the record of which evenings were sent, which may resend one
-- evening's round-up if the new code is redeployed the same evening).
-- rollback-begin
-- DROP TABLE "push_roundup_runs";
-- rollback-end
