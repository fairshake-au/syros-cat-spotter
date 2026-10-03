CREATE TABLE "sighting_matches" (
	"sighting_id" integer PRIMARY KEY NOT NULL,
	"compared_cat_ids" integer[],
	"suggested" jsonb,
	"matcher_failed" boolean DEFAULT false NOT NULL,
	"matched_at" timestamp with time zone,
	"choice" text,
	"chosen_cat_id" integer,
	"suggested_rank" integer,
	"picked_from" text,
	"miss_kind" text,
	"opened_picker" boolean,
	"chosen_at" timestamp with time zone,
	CONSTRAINT "sighting_matches_choice_ck" CHECK ("sighting_matches"."choice" IS NULL OR "sighting_matches"."choice" IN ('suggested', 'hand_pick', 'new_cat', 'unlabelled')),
	CONSTRAINT "sighting_matches_picked_from_ck" CHECK ("sighting_matches"."picked_from" IS NULL OR "sighting_matches"."picked_from" IN ('nearby', 'search', 'name_prompt')),
	CONSTRAINT "sighting_matches_miss_kind_ck" CHECK ("sighting_matches"."miss_kind" IS NULL OR "sighting_matches"."miss_kind" IN ('matcher_miss', 'distance_miss')),
	CONSTRAINT "sighting_matches_chosen_ck" CHECK (("sighting_matches"."choice" IS NULL) = ("sighting_matches"."chosen_at" IS NULL)),
	CONSTRAINT "sighting_matches_rank_ck" CHECK (("sighting_matches"."choice" = 'suggested') = ("sighting_matches"."suggested_rank" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD CONSTRAINT "sighting_matches_sighting_id_sightings_id_fk" FOREIGN KEY ("sighting_id") REFERENCES "public"."sightings"("id") ON DELETE cascade ON UPDATE no action;

-- rollback-begin
-- DROP TABLE "sighting_matches";
-- rollback-end
