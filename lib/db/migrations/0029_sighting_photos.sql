CREATE TABLE "sighting_photos" (
	"sighting_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"role" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "sighting_photos_sighting_id_position_pk" PRIMARY KEY("sighting_id","position"),
	CONSTRAINT "sighting_photos_role_ck" CHECK ("sighting_photos"."role" IN ('first','face','body')),
	CONSTRAINT "sighting_photos_position_ck" CHECK ("sighting_photos"."position" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "no_cat_in_any_photo" boolean;--> statement-breakpoint
ALTER TABLE "sighting_matches" ADD COLUMN "mixed_cats" boolean;--> statement-breakpoint
ALTER TABLE "sighting_photos" ADD CONSTRAINT "sighting_photos_sighting_id_sightings_id_fk" FOREIGN KEY ("sighting_id") REFERENCES "public"."sightings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sighting_photos" ADD CONSTRAINT "sighting_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sighting_photos_role_uq" ON "sighting_photos" USING btree ("sighting_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "sighting_photos_photo_uq" ON "sighting_photos" USING btree ("photo_id");--> statement-breakpoint
-- SYC-415: every existing sighting has exactly one photo, its first. One row
-- each, so sighting_photos lists every sighting's photos. A sighting whose
-- photo row is gone (sightings.photo_id has no foreign key) gets no row, and
-- if two sightings ever shared a photo the earlier one keeps it; the readers
-- fall back to sightings.photo_id for a sighting with no rows.
INSERT INTO "sighting_photos" ("sighting_id", "photo_id", "role", "position")
SELECT s."id", s."photo_id", 'first', 1
  FROM "sightings" s
  JOIN "photos" p ON p."id" = s."photo_id"
ORDER BY s."id"
ON CONFLICT ("photo_id") DO NOTHING;
--> statement-breakpoint
-- The extra-photo boxes stay hidden until switched on (SYC-415 plan Decision
-- P1). DO NOTHING so a value already set is never overwritten.
INSERT INTO "app_settings" ("key", "value") VALUES ('extra_photos_on', 'false'::jsonb)
ON CONFLICT ("key") DO NOTHING;
-- Roll the app back first: new code reads sighting_photos on every upload,
-- repeat and cat page. Rolling back forgets which photo was face or body;
-- cover photos stay in sightings.photo_id and every photo stays in photos.
-- rollback-begin
-- DELETE FROM "app_settings" WHERE "key" = 'extra_photos_on';
-- ALTER TABLE "sighting_matches" DROP COLUMN "mixed_cats";
-- ALTER TABLE "sighting_matches" DROP COLUMN "no_cat_in_any_photo";
-- DROP TABLE "sighting_photos";
-- rollback-end
