CREATE TABLE "held_typing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"session_version" integer NOT NULL,
	"form_key" text NOT NULL,
	"landing_path" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "held_typing" ADD CONSTRAINT "held_typing_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "held_typing_created_at_idx" ON "held_typing" USING btree ("created_at");
-- rollback-begin
-- DROP TABLE "held_typing";
-- rollback-end
