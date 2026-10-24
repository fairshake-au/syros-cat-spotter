ALTER TABLE "cats" ADD COLUMN "name_pending" boolean DEFAULT false NOT NULL;
-- rollback-begin
-- -- Run this only after the code that reads name_pending is rolled back (app first, then database).
-- -- A cat left for spotters keeps its SYR number as its name; only the flag goes.
-- ALTER TABLE "cats" DROP COLUMN "name_pending";
-- rollback-end
