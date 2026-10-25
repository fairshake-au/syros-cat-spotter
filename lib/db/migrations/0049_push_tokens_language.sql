ALTER TABLE "push_tokens" ADD COLUMN "language" text;
-- SYC-706: the app language a phone registered with, so the Monday weekly push arrives in it. Null (old builds) is sent English.
-- Rolling back drops the column; pushes go back to English for everyone.
-- rollback-begin
-- ALTER TABLE "push_tokens" DROP COLUMN "language";
-- rollback-end
