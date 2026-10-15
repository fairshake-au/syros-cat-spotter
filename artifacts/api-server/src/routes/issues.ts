import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { catsTable, db, photosTable, sightingsTable, welfareReportsTable } from "@workspace/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { verifyDeviceSecret } from "../lib/deviceAuth";
import { addressKey, consume, declareLimit } from "../lib/limits";
import { safeError } from "../lib/logger";
import { kick } from "../lib/mail/outbox";
import { logVerdict, turnstileMode, verifyTurnstile } from "../lib/turnstile";
import { takeUncheckedAllowance, uncheckedResetAt } from "../lib/uncheckedLimit";
import {
  HIDING_REASONS,
  applyHideRules,
  issueClock,
  storedHidden,
} from "../lib/issues/hide";

/**
 * "Report an issue" (SYC-44 PR 5.1; spec docs/specs/report-an-issue.md §5.1,
 * §6, §8, §9.5, §13; plan docs/superpowers/plans/syc-44-report-an-issue.md,
 * PR 5.1).
 *
 * POST /api/issues. Public, device-authenticated (trust-on-first-use, with
 * the new-phone cap), behind the same CORS and pre-launch pass as
 * /api/reports. The steps, in this order (the order is the security):
 *
 *   1. body and device;
 *   2. duplicate: a report already sent with this (device, clientRef) gets
 *      its STORED answer, with or without a token, unless it is an upgrade
 *      case (spec §9.5; see `upgradeEligible`);
 *   3. courtesy: the same device, photo (or cat) and reason within 24 hours
 *      is treated as that report (spec §8.1; a courtesy, not a control);
 *   4. attempts: 60 calls an hour per address, BEFORE the token, so junk
 *      tokens can't buy unlimited calls to Cloudflare (plan review finding 7);
 *   5. the token (action report_issue, cdata = clientRef). In enforce:
 *      rejected → 428, nothing written; our key broken → 503; Cloudflare
 *      unreachable → saved as unchecked, behind the unchecked fence (3 an
 *      hour per address, shared with the cat-in-trouble form). In off and
 *      observe nothing is refused, and NOTHING HIDES: a hide needs an `ok`
 *      verdict in enforce (plan PR 1.1; plan review finding 2);
 *   6. 20 issue reports an hour per address (429);
 *   7. the cat must exist (404); the photo must be found (404) and be that
 *      cat's main photo or a photo on one of its resolved sightings (422);
 *   8. one transaction: the row, then the hide rules (lib/issues/hide.ts),
 *      then the alert. The reply's `hidden` is read back from the row.
 *
 * Nothing about the sender is kept but the device id (for the resend check;
 * SYC-63 clears it). The address is used for limits only, hashed there, and
 * never stored on the row. Request bodies are never logged.
 */
const router: IRouter = Router();

const HOUR_MS = 60 * 60 * 1000;
const TOO_MANY = { error: "Too many requests. Please try again later." };

export const ISSUE_ATTEMPTS_PER_HOUR = 60;
export const ISSUE_REPORTS_PER_HOUR = 20;
const ATTEMPTS_BUCKET = "issue_attempt";
const REPORTS_BUCKET = "issue_report";
declareLimit(ATTEMPTS_BUCKET, ISSUE_ATTEMPTS_PER_HOUR, HOUR_MS);
declareLimit(REPORTS_BUCKET, ISSUE_REPORTS_PER_HOUR, HOUR_MS);

export const ISSUE_REASONS = [
  "photo_private",
  "photo_inappropriate",
  "photo_not_cat",
  "wrong_cat",
  "wrong_name",
  "wrong_info",
  "location_revealing",
  "cat_died",
  "other",
] as const;
/** Reasons that are about one photo, so must name it (the database checks this too). */
const PHOTO_REQUIRED: ReadonlySet<string> = new Set(["photo_private", "photo_inappropriate", "photo_not_cat"]);
/** Offered from both the cat page and a photo. */
const PHOTO_OPTIONAL: ReadonlySet<string> = new Set(["wrong_cat"]);

const IssueBody = z.object({
  deviceId: z.string().min(1).max(128),
  clientRef: z.string().min(8).max(100),
  reason: z.enum(ISSUE_REASONS),
  catId: z.number().int().positive(),
  photoPublicId: z.string().min(1).max(100).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  language: z.enum(["en", "el", "fr"]).catch("en"),
});

type IssueRow = {
  id: number;
  publicId: string;
  reason: string | null;
  photoId: number | null;
  state: string;
  tokenChecked: boolean | null;
  hiddenByReport: boolean;
  hideSkipped: string | null;
};

const ROW_FIELDS = {
  id: welfareReportsTable.id,
  publicId: welfareReportsTable.publicId,
  reason: welfareReportsTable.reason,
  photoId: welfareReportsTable.photoId,
  state: welfareReportsTable.state,
  tokenChecked: welfareReportsTable.tokenChecked,
  hiddenByReport: welfareReportsTable.hiddenByReport,
  hideSkipped: welfareReportsTable.hideSkipped,
};

function badRequest(res: Response, err: z.ZodError | string[]) {
  // Never echo the received values back: they can include the note.
  const fields = Array.isArray(err) ? err : [...new Set(err.issues.map((i) => i.path.join(".")))];
  res.status(400).json({ error: "Invalid request", fields });
}

/** The answer a sent report gets, now or on any repeat. Nothing else. */
function answer(res: Response, status: 200 | 201, row: IssueRow) {
  res.status(status).json({ publicId: row.publicId, hidden: storedHidden(row) });
}

/** This device's "Report an issue" row with this clientRef, if any. Content kind only. */
async function sentIssue(deviceId: string, clientRef: string): Promise<IssueRow | undefined> {
  const [row] = await db
    .select(ROW_FIELDS)
    .from(welfareReportsTable)
    .where(
      and(
        eq(welfareReportsTable.kind, "content"),
        eq(welfareReportsTable.reporterDevice, deviceId),
        eq(welfareReportsTable.clientRef, clientRef),
      ),
    );
  return row;
}

/** Has this photo ever been restored (rule (ii))? */
async function everRestored(photoId: number, q: Pick<typeof db, "execute"> = db): Promise<boolean> {
  const r = await q.execute(
    sql`select 1 from photo_visibility_events where photo_id = ${photoId} and action = 'restore' limit 1`,
  );
  return r.rows.length > 0;
}

/**
 * The upgrade case (spec §9.5): an existing report that was saved without a
 * verified token (Cloudflare unreachable, or the check not enforced), that
 * the team hasn't decided (still new or looking), and whose photo has never
 * been restored. A resend with an `ok` token re-marks it checked and runs
 * the hide rules for it. Without this a Cloudflare blip on the first send
 * would leave a real privacy report unable ever to hide.
 */
async function upgradeEligible(row: IssueRow): Promise<boolean> {
  if (row.state !== "new" && row.state !== "looking") return false;
  const unchecked = row.tokenChecked !== true || row.hideSkipped === "unchecked";
  if (!unchecked) return false;
  if (row.photoId !== null && (await everRestored(row.photoId))) return false;
  return true;
}

/**
 * Count one request in `bucket` for this address. "ok", "full" (429), or
 * "error" (the counter broke: these limits fail closed, 503).
 */
async function take(bucket: string, limit: number, address: string): Promise<"ok" | "full" | "error"> {
  try {
    const r = await consume(bucket, addressKey(address), limit, HOUR_MS, undefined, issueClock() ?? Date.now());
    return r.allowed ? "ok" : "full";
  } catch {
    return "error";
  }
}

function refuseLimit(req: Request, res: Response, outcome: "full" | "error", bucket: string): void {
  if (outcome === "error") {
    req.log.error({ bucket }, "issue limit counter failed");
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "try_again" });
    return;
  }
  res.status(429).json(TOO_MANY);
}

/**
 * The Turnstile step. Returns the verdict for this report, or undefined once
 * it has answered the request itself.
 *
 * - `tokenChecked` is what goes on the row (null: no check enforced;
 *   true: checked; false: Cloudflare unreachable).
 * - `tokenOk` is true ONLY for an `ok` verdict in enforce mode: the one case
 *   in which a report may hide.
 */
async function tokenStep(
  req: Request,
  res: Response,
  clientRef: string,
): Promise<{ tokenChecked: boolean | null; tokenOk: boolean } | undefined> {
  const mode = turnstileMode();
  if (mode === "off") return { tokenChecked: null, tokenOk: false };
  const token: unknown = (req.body as { turnstileToken?: unknown } | undefined)?.turnstileToken;
  const verdict = await verifyTurnstile(token, "report_issue", clientRef);
  if (mode === "observe") {
    logVerdict(mode, "report_issue", verdict);
    const tokenChecked = verdict.outcome === "ok" ? true : verdict.outcome === "unreachable" ? false : null;
    return { tokenChecked, tokenOk: false };
  }
  if (verdict.outcome !== "ok") logVerdict(mode, "report_issue", verdict);
  switch (verdict.outcome) {
    case "ok":
      return { tokenChecked: true, tokenOk: true };
    case "rejected":
      res.status(428).json({ error: "challenge_required" });
      return undefined;
    case "not_configured":
      res.status(503).json({ error: "turnstile_not_configured" });
      return undefined;
    case "unreachable": {
      const address = req.ip ?? "unknown";
      let allowance: Awaited<ReturnType<typeof takeUncheckedAllowance>>;
      try {
        // The same fence as the cat-in-trouble form: 3 an hour per address,
        // both forms together, and the island-wide 30. Fails closed.
        allowance = await takeUncheckedAllowance("report", address);
      } catch (err) {
        req.log.error({ err: safeError(err) }, "unchecked limit counter failed");
        res.status(503).json({ error: "try_again" });
        return undefined;
      }
      if (allowance === "island") {
        res.status(503).json({ error: "try_again" });
        return undefined;
      }
      if (allowance === "address") {
        const resetAt = await uncheckedResetAt("report", address).catch(() => undefined);
        if (resetAt) res.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
        res.status(429).json(TOO_MANY);
        return undefined;
      }
      return { tokenChecked: false, tokenOk: false };
    }
  }
}

/**
 * The photo this report is about, if it is one of this cat's: its main photo
 * or the photo of one of its resolved sightings. "not_found" when no photo
 * has that public id; "not_this_cat" otherwise (422), so nobody can hide
 * another cat's photo through a report about a different one.
 */
async function photoOfCat(
  cat: { id: number; primaryPhotoId: number },
  photoPublicId: string,
): Promise<{ id: number } | "not_found" | "not_this_cat"> {
  const [photo] = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.publicId, photoPublicId));
  if (!photo) return "not_found";
  if (photo.id === cat.primaryPhotoId) return photo;
  const [sighting] = await db
    .select({ id: sightingsTable.id })
    .from(sightingsTable)
    .where(
      and(
        eq(sightingsTable.catId, cat.id),
        eq(sightingsTable.photoId, photo.id),
        eq(sightingsTable.status, "resolved"),
      ),
    )
    .limit(1);
  return sighting ? photo : "not_this_cat";
}

function newPublicId(): string {
  return randomBytes(18).toString("base64url");
}

router.post("/issues", async (req, res) => {
  // ── 1. Body and device ──
  const parsed = IssueBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const body = parsed.data;
  const photoPublicId = body.photoPublicId?.trim() || null;
  if (PHOTO_REQUIRED.has(body.reason) && !photoPublicId) return badRequest(res, ["photoPublicId"]);
  if (!PHOTO_REQUIRED.has(body.reason) && !PHOTO_OPTIONAL.has(body.reason) && photoPublicId) {
    return badRequest(res, ["photoPublicId"]);
  }
  if (!(await verifyDeviceSecret(req, res, body.deviceId))) return;
  const address = req.ip ?? "unknown";

  // ── 2. Duplicate, before any token (spec §9.5) ──
  const already = await sentIssue(body.deviceId, body.clientRef);
  if (already) {
    const hasToken = typeof (req.body as { turnstileToken?: unknown }).turnstileToken === "string";
    if (!hasToken || turnstileMode() !== "enforce" || !(await upgradeEligible(already))) {
      return answer(res, 200, already);
    }
    return upgrade(req, res, already, body.clientRef, address);
  }

  // ── 3. Courtesy: the same device, photo (or cat) and reason in 24 hours ──
  const pinned = issueClock();
  const since =
    pinned === null
      ? sql`now() - interval '24 hours'`
      : sql`to_timestamp(${pinned} / 1000.0) - interval '24 hours'`;
  const [recent] = await db
    .select(ROW_FIELDS)
    .from(welfareReportsTable)
    .leftJoin(photosTable, eq(photosTable.id, welfareReportsTable.photoId))
    .where(
      and(
        eq(welfareReportsTable.kind, "content"),
        eq(welfareReportsTable.reporterDevice, body.deviceId),
        eq(welfareReportsTable.reason, body.reason),
        eq(welfareReportsTable.catId, body.catId),
        photoPublicId ? eq(photosTable.publicId, photoPublicId) : isNull(welfareReportsTable.photoId),
        gt(welfareReportsTable.createdAt, since),
      ),
    )
    .orderBy(desc(welfareReportsTable.id))
    .limit(1);
  if (recent) return answer(res, 200, recent);

  // ── 4. Attempts, before the token ──
  const attempt = await take(ATTEMPTS_BUCKET, ISSUE_ATTEMPTS_PER_HOUR, address);
  if (attempt !== "ok") return refuseLimit(req, res, attempt, ATTEMPTS_BUCKET);

  // ── 5. The token ──
  const token = await tokenStep(req, res, body.clientRef);
  if (!token) return;

  // ── 6. 20 issue reports an hour per address ──
  const counted = await take(REPORTS_BUCKET, ISSUE_REPORTS_PER_HOUR, address);
  if (counted !== "ok") return refuseLimit(req, res, counted, REPORTS_BUCKET);

  // ── 7. The cat, and the photo ──
  const [cat] = await db
    .select({ id: catsTable.id, primaryPhotoId: catsTable.primaryPhotoId })
    .from(catsTable)
    .where(eq(catsTable.id, body.catId));
  if (!cat) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  let photoId: number | null = null;
  if (photoPublicId) {
    const photo = await photoOfCat(cat, photoPublicId);
    if (photo === "not_found") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (photo === "not_this_cat") {
      res.status(422).json({ error: "photo_not_of_this_cat" });
      return;
    }
    photoId = photo.id;
  }

  // ── 8. One transaction: the row, the hide, the alert ──
  const note = body.note?.trim() ? body.note.trim() : null;
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(welfareReportsTable)
      .values({
        publicId: newPublicId(),
        kind: "content",
        reason: body.reason,
        catId: cat.id,
        photoId,
        severity: "attention",
        isLitter: false,
        photoState: "none",
        note,
        reporterLanguage: body.language,
        reporterDevice: body.deviceId,
        clientRef: body.clientRef,
        isDraft: false,
        submittedAt: sql`now()`,
        tokenChecked: token.tokenChecked,
      })
      .onConflictDoNothing({
        target: [welfareReportsTable.reporterDevice, welfareReportsTable.kind, welfareReportsTable.clientRef],
      })
      .returning({ id: welfareReportsTable.id });
    // Two sends of one clientRef at once: the loser replies with the winner's row.
    if (!row) return null;
    await applyHideRules(tx, {
      reportId: row.id,
      reason: body.reason,
      photoId,
      tokenOk: token.tokenOk,
      address,
    });
    const [stored] = await tx.select(ROW_FIELDS).from(welfareReportsTable).where(eq(welfareReportsTable.id, row.id));
    return stored!;
  });

  if (!saved) {
    const winner = await sentIssue(body.deviceId, body.clientRef);
    return answer(res, 200, winner!);
  }
  req.log.info(
    { reason: body.reason, hidden: storedHidden(saved), hideSkipped: saved.hideSkipped, tokenChecked: saved.tokenChecked },
    "issue report saved",
  );
  answer(res, 201, saved);
  if (saved.hiddenByReport) kick();
});

/**
 * Steps 4–8 for an upgrade case (spec §9.5). The report is already saved, so
 * any refusal of the token just repeats its stored answer; a good token
 * re-marks it checked and, if the rules allow, hides now.
 */
async function upgrade(
  req: Request,
  res: Response,
  existing: IssueRow,
  clientRef: string,
  address: string,
): Promise<void> {
  const attempt = await take(ATTEMPTS_BUCKET, ISSUE_ATTEMPTS_PER_HOUR, address);
  if (attempt !== "ok") return refuseLimit(req, res, attempt, ATTEMPTS_BUCKET);
  const token: unknown = (req.body as { turnstileToken?: unknown }).turnstileToken;
  const verdict = await verifyTurnstile(token, "report_issue", clientRef);
  if (verdict.outcome !== "ok") {
    logVerdict("enforce", "report_issue", verdict);
    return answer(res, 200, existing);
  }
  const counted = await take(REPORTS_BUCKET, ISSUE_REPORTS_PER_HOUR, address);
  if (counted !== "ok") return refuseLimit(req, res, counted, REPORTS_BUCKET);

  const updated = await db.transaction(async (tx) => {
    // Lock the report, then check the conditions again under the lock: the
    // team may have decided it, or restored its photo, since the first read.
    const locked = await tx.execute<{ id: number }>(
      sql`select id from welfare_reports where id = ${existing.id} for update`,
    );
    if (!locked.rows[0]) return null;
    const [row] = await tx.select(ROW_FIELDS).from(welfareReportsTable).where(eq(welfareReportsTable.id, existing.id));
    if (!row || row.state === "done" || row.state === "nothing_needed") return row ?? null;
    if (row.tokenChecked === true && row.hideSkipped !== "unchecked") return row;
    if (row.photoId !== null && (await everRestored(row.photoId, tx))) return row;
    await tx.update(welfareReportsTable).set({ tokenChecked: true }).where(eq(welfareReportsTable.id, row.id));
    if (row.reason && HIDING_REASONS.has(row.reason) && !row.hiddenByReport) {
      await applyHideRules(tx, {
        reportId: row.id,
        reason: row.reason,
        photoId: row.photoId,
        tokenOk: true,
        address,
      });
    }
    const [stored] = await tx.select(ROW_FIELDS).from(welfareReportsTable).where(eq(welfareReportsTable.id, row.id));
    return stored!;
  });
  const row = updated ?? existing;
  req.log.info({ reason: row.reason, hidden: storedHidden(row), hideSkipped: row.hideSkipped }, "issue report upgraded");
  answer(res, 200, row);
  if (row.hiddenByReport && !existing.hiddenByReport) kick();
}

export default router;
