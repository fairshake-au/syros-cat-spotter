CREATE TABLE "photo_variants" (
	"photo_id" integer NOT NULL,
	"size" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_variants_photo_id_size_pk" PRIMARY KEY("photo_id","size"),
	CONSTRAINT "photo_variants_size_ck" CHECK ("photo_variants"."size" in ('small','medium'))
);
--> statement-breakpoint
ALTER TABLE "photo_variants" ADD CONSTRAINT "photo_variants_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;
-- rollback-begin
-- DROP TABLE "photo_variants";
-- rollback-end
