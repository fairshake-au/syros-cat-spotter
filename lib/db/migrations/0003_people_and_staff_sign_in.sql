CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text,
	CONSTRAINT "people_email_unique" UNIQUE("email"),
	CONSTRAINT "people_email_lowercase_ck" CHECK ("people"."email" = lower(btrim("people"."email"))),
	CONSTRAINT "people_email_shape_ck" CHECK ("people"."email" ~ '^[^@]+@[^@]+$'),
	CONSTRAINT "people_email_not_role_ck" CHECK (split_part(split_part("people"."email", '@', 1), '+', 1) NOT IN ('admin', 'info', 'hello', 'contact', 'team', 'office', 'support'))
);
--> statement-breakpoint
CREATE TABLE "person_scopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"colony_id" integer,
	CONSTRAINT "person_scopes_role_scope_unique" UNIQUE NULLS NOT DISTINCT("person_id","role","colony_id"),
	CONSTRAINT "person_scopes_role_ck" CHECK ("person_scopes"."role" IN ('staff', 'guardian', 'volunteer', 'vet'))
);
--> statement-breakpoint
CREATE TABLE "team_handoff_spent" (
	"jti" text PRIMARY KEY NOT NULL,
	"spent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_scopes" ADD CONSTRAINT "person_scopes_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE no action ON UPDATE no action;
-- CAUTION: this rollback deletes the list of people. Take a backup first.
-- rollback-begin
-- DROP TABLE "team_handoff_spent";
-- DROP TABLE "person_scopes";
-- DROP TABLE "people";
-- rollback-end