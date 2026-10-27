-- SYC-150 PR 3.1 (which-cat-is-which.md §9.12): the nightly news check
-- silences a change caused by a move or a merge, with its own reason.
ALTER TABLE "cat_news_changes" DROP CONSTRAINT "cat_news_changes_reason_ck";--> statement-breakpoint
ALTER TABLE "cat_news_changes" ADD CONSTRAINT "cat_news_changes_reason_ck" CHECK ("cat_news_changes"."silenced_reason" IS NULL OR "cat_news_changes"."silenced_reason" IN ('import', 'legacy', 'old_news', 'first_seen', 'deceased', 'bulk', 'moved', 'merged'));
-- rollback-begin
-- -- SYC-150 PR 3.1. Roll the app back first: the new check writes these reasons.
-- -- Any change already silenced as moved or merged is relabelled old_news on the way down,
-- -- the nearest older reason (a change that was never news), so the old check accepts it.
-- UPDATE "cat_news_changes" SET "silenced_reason" = 'old_news' WHERE "silenced_reason" IN ('moved', 'merged');
-- ALTER TABLE "cat_news_changes" DROP CONSTRAINT "cat_news_changes_reason_ck";
-- ALTER TABLE "cat_news_changes" ADD CONSTRAINT "cat_news_changes_reason_ck" CHECK ("cat_news_changes"."silenced_reason" IS NULL OR "cat_news_changes"."silenced_reason" IN ('import', 'legacy', 'old_news', 'first_seen', 'deceased', 'bulk'));
-- rollback-end
