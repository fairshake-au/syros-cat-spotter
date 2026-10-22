CREATE TABLE "photo_fingerprints" (
	"photo_id" integer PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"vector" real[] NOT NULL,
	"made_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_fingerprints_vector_len_ck" CHECK (array_ndims("photo_fingerprints"."vector") = 1 and cardinality("photo_fingerprints"."vector") = 384)
);
--> statement-breakpoint
ALTER TABLE "photo_fingerprints" ADD CONSTRAINT "photo_fingerprints_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;
-- rollback-begin
-- DROP TABLE "photo_fingerprints";
-- rollback-end
