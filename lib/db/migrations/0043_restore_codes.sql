ALTER TABLE "mail_tokens" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "mail_tokens" ADD COLUMN "code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_tokens" ADD COLUMN "handle_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_tokens_handle_hash_idx" ON "mail_tokens" USING btree ("handle_hash") WHERE "mail_tokens"."handle_hash" is not null;
-- rollback-begin
-- DROP INDEX "mail_tokens_handle_hash_idx";
-- ALTER TABLE "mail_tokens" DROP COLUMN "handle_hash";
-- ALTER TABLE "mail_tokens" DROP COLUMN "code_attempts";
-- ALTER TABLE "mail_tokens" DROP COLUMN "code_hash";
-- rollback-end
