ALTER TABLE "photo_variants" DROP CONSTRAINT "photo_variants_size_ck";--> statement-breakpoint
ALTER TABLE "photo_variants" ADD CONSTRAINT "photo_variants_size_ck" CHECK ("photo_variants"."size" in ('small','medium','card'));
-- rollback-begin
-- DELETE FROM "photo_variants" WHERE "size" = 'card';
-- ALTER TABLE "photo_variants" DROP CONSTRAINT "photo_variants_size_ck";
-- ALTER TABLE "photo_variants" ADD CONSTRAINT "photo_variants_size_ck" CHECK ("photo_variants"."size" in ('small','medium'));
-- rollback-end
