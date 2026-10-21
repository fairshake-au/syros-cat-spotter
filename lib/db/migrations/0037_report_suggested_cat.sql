ALTER TABLE "welfare_reports" ADD COLUMN "reporter_cat_id" integer;
-- rollback-begin
-- ALTER TABLE "welfare_reports" DROP COLUMN "reporter_cat_id";
-- rollback-end
