ALTER TABLE "feeding_sites" ADD COLUMN "position_approximate" boolean DEFAULT false NOT NULL;
-- rollback-begin
-- -- SYC-705: added column; old code ignores it, so no app rollback is needed first.
-- ALTER TABLE "feeding_sites" DROP COLUMN "position_approximate";
-- rollback-end
