ALTER TABLE "cats" ADD COLUMN "name_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- SYC-677 Ruling R22a: "syros-cats-team" discovers the cats the team makes
-- from a vet batch. Its credential is a hash no secret can match (not hex,
-- like the deleted-device marker's), so nobody can bind a phone to it.
INSERT INTO "device_credentials" ("device_id", "secret_hash") VALUES ('syros-cats-team', 'unbindable:syros-cats-team') ON CONFLICT ("device_id") DO UPDATE SET "secret_hash" = EXCLUDED."secret_hash";
-- rollback-begin
-- -- Run this only after the code that reads name_pending is rolled back (app first, then database).
-- -- A cat left for spotters keeps its SYR number as its name; only the flag goes.
-- -- The team desk's credential goes too, only if it is still the unbindable one.
-- DELETE FROM "device_credentials" WHERE "device_id" = 'syros-cats-team' AND "secret_hash" = 'unbindable:syros-cats-team';
-- ALTER TABLE "cats" DROP COLUMN "name_pending";
-- rollback-end
