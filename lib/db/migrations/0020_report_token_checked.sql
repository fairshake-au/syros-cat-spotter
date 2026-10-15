-- SYC-170 PR 1.1 (spec docs/specs/report-an-issue.md §9.5): whether a
-- cat-in-trouble report's Turnstile token was checked. Nullable, no default:
-- every existing row stays null, meaning "sent before Turnstile". true =
-- checked; false = accepted while Cloudflare was unreachable.
ALTER TABLE "welfare_reports" ADD COLUMN "token_checked" boolean;
-- Additive. Roll the app back first (new code writes this column on every
-- report), then drop it; the only thing lost is which reports were checked.
-- rollback-begin
-- ALTER TABLE "welfare_reports" DROP COLUMN "token_checked";
-- rollback-end
