CREATE TABLE "vet_batch_cats" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"position" integer NOT NULL,
	"cat_id" integer,
	"new_cat" jsonb,
	"confirmed" boolean DEFAULT false NOT NULL,
	"did" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"treated_note" text DEFAULT '' NOT NULL,
	"cost_eur" text DEFAULT '' NOT NULL,
	"paid_by" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"also_same_day" boolean DEFAULT false NOT NULL,
	"suggestions" jsonb,
	CONSTRAINT "vet_batch_cats_identity_ck" CHECK ("vet_batch_cats"."cat_id" is null or "vet_batch_cats"."new_cat" is null)
);
--> statement-breakpoint
CREATE TABLE "vet_batch_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_cat_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vet_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone,
	"date" text NOT NULL,
	"clinic_id" text,
	"colony_id" integer,
	"area_key" text,
	"price_eur" numeric(7, 2),
	"paid_by" text DEFAULT '' NOT NULL,
	"vaccines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vaccine_other" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "vet_batches_place_ck" CHECK ("vet_batches"."colony_id" is null or "vet_batches"."area_key" is null)
);
--> statement-breakpoint
CREATE TABLE "vet_visit_photos" (
	"photo_id" integer PRIMARY KEY NOT NULL,
	"visit_id" integer NOT NULL,
	"cat_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vet_batch_cats" ADD CONSTRAINT "vet_batch_cats_batch_id_vet_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."vet_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_batch_cats" ADD CONSTRAINT "vet_batch_cats_cat_id_cats_id_fk" FOREIGN KEY ("cat_id") REFERENCES "public"."cats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_batch_photos" ADD CONSTRAINT "vet_batch_photos_batch_cat_id_vet_batch_cats_id_fk" FOREIGN KEY ("batch_cat_id") REFERENCES "public"."vet_batch_cats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_batch_photos" ADD CONSTRAINT "vet_batch_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_batches" ADD CONSTRAINT "vet_batches_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_batches" ADD CONSTRAINT "vet_batches_colony_id_colonies_id_fk" FOREIGN KEY ("colony_id") REFERENCES "public"."colonies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_visit_photos" ADD CONSTRAINT "vet_visit_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_visit_photos" ADD CONSTRAINT "vet_visit_photos_cat_id_cats_id_fk" FOREIGN KEY ("cat_id") REFERENCES "public"."cats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vet_batch_cats_batch_idx" ON "vet_batch_cats" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "vet_batch_photos_cat_idx" ON "vet_batch_photos" USING btree ("batch_cat_id","position");--> statement-breakpoint
CREATE INDEX "vet_batch_photos_photo_idx" ON "vet_batch_photos" USING btree ("photo_id");
-- rollback-begin
-- DROP TABLE "vet_visit_photos";
-- DROP TABLE "vet_batch_photos";
-- DROP TABLE "vet_batch_cats";
-- DROP TABLE "vet_batches";
-- rollback-end
