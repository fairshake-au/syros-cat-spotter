import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The sign-in Worker's own secret (`INTERNAL_PEOPLE_TOKEN`), shared by the
 * SYC-113 pre-launch gate and PR #20's `/api/internal/*` routes, so both
 * check it the same way. Created here because SYC-113 landed first
 * (docs/superpowers/plans/syc-113-pre-launch-gates.md, item 2, step 3).
 *
 * - "not_configured": the server has no token; callers answer
 *   503 {"error":"not_configured"} (fails closed, never open).
 * - "unauthorized": missing or wrong token.
 * - "ok": `Authorization: Bearer <INTERNAL_PEOPLE_TOKEN>`.
 *
 * Read from the environment on every call, so a removed secret takes effect
 * at once. Both sides are SHA-256 hashed and compared in constant time,
 * following lib/deviceAuth.ts.
 */
export type InternalAuthResult = "ok" | "unauthorized" | "not_configured";

function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

export function internalTokenConfigured(): boolean {
  return Boolean(process.env["INTERNAL_PEOPLE_TOKEN"]);
}

export function checkInternalToken(
  authorization: string | undefined,
): InternalAuthResult {
  const expected = process.env["INTERNAL_PEOPLE_TOKEN"] ?? "";
  if (!expected) return "not_configured";
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  const supplied = match?.[1] ?? "";
  if (!supplied) return "unauthorized";
  return timingSafeEqual(sha256(expected), sha256(supplied))
    ? "ok"
    : "unauthorized";
}

/**
 * SYC-42 plan, Slice 1 item 1.6: `MAIL_DRAIN_TOKEN`, the scheduled job's own
 * narrow token. It opens exactly these three paths and nothing else:
 * - POST /api/internal/mail/drain (SYC-42), and
 * - POST /api/internal/coat/sweep (SYC-161, Decision D1: the manual colour
 *   run, so it needs no new secret), and
 * - POST /api/internal/vet-batches/cleanup (SYC-677: removes vet visit
 *   batches left unfinished for 7 days; it answers with counts only).
 * The sign-in Worker's INTERNAL_PEOPLE_TOKEN opens none of them. A separate token
 * means a leaked drain token can at worst make the server send mail that was
 * already queued, bring forward colour readings that are due anyway,
 * capped by the hourly reading budget (a photo is never read twice), and
 * remove vet visit batch drafts that are due to go anyway. Held
 * only in the GitHub `production` environment, Replit's deployment secrets
 * and the mail-drain-cron Worker (spec §2.11).
 */
export const MAIL_DRAIN_PATH = "/api/internal/mail/drain";
export const COAT_SWEEP_PATH = "/api/internal/coat/sweep";
export const VET_BATCH_CLEANUP_PATH = "/api/internal/vet-batches/cleanup";

export function checkMailDrainToken(
  authorization: string | undefined,
): InternalAuthResult {
  const expected = process.env["MAIL_DRAIN_TOKEN"] ?? "";
  if (!expected) return "not_configured";
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  const supplied = match?.[1] ?? "";
  if (!supplied) return "unauthorized";
  return timingSafeEqual(sha256(expected), sha256(supplied))
    ? "ok"
    : "unauthorized";
}

/**
 * SYC-45 Slice 1 (syc-344-email-capture.md, PR 1.1): `NEWS_JOB_TOKEN`, the
 * nightly news check's own token, like MAIL_DRAIN_TOKEN. It opens exactly
 * these two paths and nothing else, and neither other token opens them:
 * - POST /api/internal/news/nightly (run tonight's check, once per Athens
 *   night whoever calls), and
 * - GET /api/internal/news/last-run (the Worker's "no run in 36 hours"
 *   alarm).
 * A leaked token can at worst run a check that sends nothing. Held only in
 * Replit's deployment secrets, the mail-drain-cron Worker and the GitHub
 * `production` environment; never in a file.
 */
export const NEWS_NIGHTLY_PATH = "/api/internal/news/nightly";
export const NEWS_LAST_RUN_PATH = "/api/internal/news/last-run";

export function checkNewsJobToken(
  authorization: string | undefined,
): InternalAuthResult {
  const expected = process.env["NEWS_JOB_TOKEN"] ?? "";
  if (!expected) return "not_configured";
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  const supplied = match?.[1] ?? "";
  if (!supplied) return "unauthorized";
  return timingSafeEqual(sha256(expected), sha256(supplied))
    ? "ok"
    : "unauthorized";
}

/**
 * SYC-527 piece 3: `FINGERPRINT_JOB_TOKEN`, the nightly looks-like batch's
 * own token, like NEWS_JOB_TOKEN. It opens exactly these two paths and
 * nothing else, and no other token opens them:
 * - POST /api/internal/fingerprints/nightly (fingerprint every active cat's
 *   display photo that has none, within a 90-second budget), and
 * - POST /api/internal/duplicates/sweep (SYC-59 PR 5.3, below).
 * A leaked token can at worst make the server do 90 seconds at a time of its own
 * fingerprinting, which a search would do anyway. Held only in Replit's
 * deployment secrets and the GitHub `production` environment; never in a file.
 */
export const FINGERPRINT_NIGHTLY_PATH = "/api/internal/fingerprints/nightly";
/**
 * SYC-59 PR 5.3: the nightly look-alike sweep, which runs straight after the
 * fingerprint batch and takes the same token (no new secret). Behind the app
 * switch `duplicate_sweep`; with it off the route does nothing. A leaked
 * token can at worst run a sweep that writes at most 10 pairs onto the
 * team's list, and only while the switch is on.
 */
export const DUPLICATE_SWEEP_PATH = "/api/internal/duplicates/sweep";

export function checkFingerprintJobToken(
  authorization: string | undefined,
): InternalAuthResult {
  const expected = process.env["FINGERPRINT_JOB_TOKEN"] ?? "";
  if (!expected) return "not_configured";
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  const supplied = match?.[1] ?? "";
  if (!supplied) return "unauthorized";
  return timingSafeEqual(sha256(expected), sha256(supplied))
    ? "ok"
    : "unauthorized";
}
