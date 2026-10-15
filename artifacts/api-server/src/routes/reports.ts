import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  mailOutboxTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { verifyDeviceSecret } from "../lib/deviceAuth";
import { sharedLimiter } from "../lib/limits";
import { safeError } from "../lib/logger";
import { validatePhotoBase64 } from "../lib/imageValidation";
import {
  PHOTO_WAIT_MINUTES,
  enqueueUncheckedPhotoFollowUp,
  enqueueUncheckedWelfareAlert,
  enqueueWelfareAlert,
  kick,
} from "../lib/mail/outbox";
import {
  logVerdict,
  turnstileMode,
  verifyTurnstile,
  type TurnstileAction,
} from "../lib/turnstile";
import {
  takeUncheckedAllowance,
  uncheckedResetAt,
  type UncheckedBucket,
} from "../lib/uncheckedLimit";

/**
 * "This cat needs help" (SYC-42 plan, Slice 1 items 1.2–1.4; spec §4).
 *
 * - The report row is written FIRST and is the source of truth. Its alert is
 *   queued in the same transaction; no email is ever sent inline, so nothing
 *   that happens to mail can lose a report (spec §4.3, §8.3; test 7).
 * - The text goes first and the photo second, so on a weak signal the small
 *   part arrives even if the big one struggles.
 * - The device secret is a courtesy check against a broken app, not abuse
 *   control (spec §4.4). Until launch the pre-launch gate limits these routes
 *   to testers; shared limits are SYC-105.
 * - Turnstile (SYC-170; report-an-issue spec §9.5). Both writes run, in this
 *   order: body, device, THE DUPLICATE CHECK (a report already sent with this
 *   device and clientRef gets its original answer, with or without a token,
 *   so a resend from the app's saved list is never swallowed), then the
 *   token. A rejected token is 428 and writes nothing; our own broken key is
 *   503; Cloudflare unreachable is accepted as unchecked, behind its own
 *   small limit. See `tokenGate`.
 * - Request bodies are never logged (the request log records method and
 *   path only), so a note, coordinates or a device id never reach the logs
 *   (item 1.7; test 19).
 */
const router: IRouter = Router();

// Counted in Postgres (SYC-105 PR 2.1; lib/limits.ts), so the limits hold
// across servers and restarts. These two routes FAIL OPEN: if the counter
// itself breaks, the request goes through and the failure is logged, because
// a hurt-cat report must never be lost to a limiter (plan review finding 16).
// Every other limiter in the app fails closed.
const TOO_MANY = { error: "Too many requests. Please try again later." };

// 10 reports per IP per hour (spec §2.6).
const reportLimiter = sharedLimiter({
  bucket: "report",
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: TOO_MANY,
  failOpen: true,
});

const draftLimiter = sharedLimiter({
  bucket: "report_draft",
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: TOO_MANY,
  failOpen: true,
});

// The new-phone cap on these routes fails open too (lib/deviceAuth.ts).
const WELFARE_DEVICE_AUTH = { limiterFailsOpen: true } as const;

const Language = z.enum(["en", "el", "fr"]).catch("en");
const Severity = z.enum(["attention", "urgent"]);
const Lat = z.number().finite().min(-90).max(90);
const Lng = z.number().finite().min(-180).max(180);
const ClientRef = z.string().min(8).max(100);
const DeviceId = z.string().min(1).max(128);

const DraftBody = z.object({
  deviceId: DeviceId,
  clientRef: ClientRef,
  severity: Severity,
  lat: Lat,
  lng: Lng,
  isLitter: z.boolean().optional(),
  language: Language,
});

const SubmitBody = z.object({
  deviceId: DeviceId,
  clientRef: ClientRef,
  severity: Severity,
  isLitter: z.boolean().default(false),
  lat: Lat,
  lng: Lng,
  note: z.string().max(4000).optional().nullable(),
  language: Language,
  // False when the reporter sent no photo: then the alert goes at once.
  hasPhoto: z.boolean().default(true),
});

const PhotoBody = z.object({
  deviceId: DeviceId,
  photoBase64: z.string().min(1),
});

/**
 * The Turnstile step (spec §9.5). Returns the value for `token_checked`, or
 * undefined once it has answered the request itself.
 *
 * - off: no check; null.
 * - observe: check and log, refuse nothing; true when ok, false when
 *   Cloudflare was unreachable, otherwise null (nothing was enforced).
 * - enforce: ok → true; rejected → 428 challenge_required, nothing written;
 *   not_configured → 503 turnstile_not_configured (our key, never the
 *   sender's fault, and never accepted unchecked); unreachable → false,
 *   after the unchecked limit (429 beyond it).
 */
async function tokenGate(
  req: import("express").Request,
  res: import("express").Response,
  action: TurnstileAction,
  clientRef: string,
  bucket: UncheckedBucket,
): Promise<boolean | null | undefined> {
  const mode = turnstileMode();
  if (mode === "off") return null;
  const token: unknown = (req.body as { turnstileToken?: unknown } | undefined)?.turnstileToken;
  const verdict = await verifyTurnstile(token, action, clientRef);
  if (mode === "observe") {
    logVerdict(mode, action, verdict);
    return verdict.outcome === "ok" ? true : verdict.outcome === "unreachable" ? false : null;
  }
  if (verdict.outcome !== "ok") logVerdict(mode, action, verdict);
  switch (verdict.outcome) {
    case "ok":
      return true;
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
        allowance = await takeUncheckedAllowance(bucket, address);
      } catch (err) {
        // The outage fence FAILS CLOSED (review of #151, finding 10): a
        // counter that cannot count must not become an unbounded unchecked
        // list. The app retries a 503 with no strike, so nothing is lost.
        req.log.error({ err: safeError(err) }, "unchecked limit counter failed");
        res.status(503).json({ error: "try_again" });
        return undefined;
      }
      if (allowance === "island") {
        // The island-wide outage fence (review of #151, finding 5): the app
        // retries a 503 with no strike, so the report stays on the phone.
        res.status(503).json({ error: "try_again" });
        return undefined;
      }
      if (allowance === "address") {
        const resetAt = await uncheckedResetAt(bucket, address).catch(() => undefined);
        if (resetAt) res.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
        res.status(429).json({ error: "Too many requests. Please try again later." });
        return undefined;
      }
      return false;
    }
  }
}

/**
 * The "needs help" report already sent with this device and clientRef, if
 * there is one. Welfare kind only (SYC-44 PR 4.1): a "Report an issue" row
 * that shares the reference is a different report, never "already sent".
 */
async function sentReport(deviceId: string, clientRef: string) {
  const [row] = await db
    .select({ publicId: welfareReportsTable.publicId })
    .from(welfareReportsTable)
    .where(
      and(
        eq(welfareReportsTable.kind, "welfare"),
        eq(welfareReportsTable.reporterDevice, deviceId),
        eq(welfareReportsTable.clientRef, clientRef),
        eq(welfareReportsTable.isDraft, false),
      ),
    );
  return row;
}

function newPublicId(): string {
  return randomBytes(18).toString("base64url");
}

function badRequest(res: import("express").Response, err: z.ZodError) {
  // Never echo the received values back: they can include the note.
  res.status(400).json({
    error: "Invalid request",
    fields: [...new Set(err.issues.map((i) => i.path.join(".")))],
  });
}

// ── 1.2 Draft: once severity and location are set ──────────────────────────
router.post("/reports/draft", draftLimiter, async (req, res) => {
  const parsed = DraftBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const body = parsed.data;
  if (!(await verifyDeviceSecret(req, res, body.deviceId, WELFARE_DEVICE_AUTH))) return;

  // A draft call for a report already sent changes nothing (below), so it
  // gets that answer before any token is asked for.
  if (await sentReport(body.deviceId, body.clientRef)) {
    res.status(204).end();
    return;
  }
  const tokenChecked = await tokenGate(req, res, "welfare_draft", body.clientRef, "draft");
  if (tokenChecked === undefined) return;

  await db
    .insert(welfareReportsTable)
    .values({
      publicId: newPublicId(),
      kind: "welfare",
      severity: body.severity,
      isLitter: body.isLitter ?? false,
      lat: body.lat,
      lng: body.lng,
      reporterLanguage: body.language,
      reporterDevice: body.deviceId,
      clientRef: body.clientRef,
      isDraft: true,
      tokenChecked,
    })
    .onConflictDoUpdate({
      target: [
        welfareReportsTable.reporterDevice,
        welfareReportsTable.kind,
        welfareReportsTable.clientRef,
      ],
      set: {
        severity: body.severity,
        isLitter: body.isLitter ?? false,
        lat: body.lat,
        lng: body.lng,
        reporterLanguage: body.language,
        tokenChecked,
      },
      // A sent report is never turned back into a draft, or changed by one.
      setWhere: sql`${welfareReportsTable.isDraft} = true`,
    });
  res.status(204).end();
});

// ── 1.3 Submit ─────────────────────────────────────────────────────────────
router.post("/reports", reportLimiter, async (req, res) => {
  const parsed = SubmitBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const body = parsed.data;
  if (!(await verifyDeviceSecret(req, res, body.deviceId, WELFARE_DEVICE_AUTH))) return;

  // The duplicate check comes BEFORE the token (spec §9.5): a resend of a
  // report already sent gets its original 200, with or without a token.
  const already = await sentReport(body.deviceId, body.clientRef);
  if (already) {
    res.status(200).json({ publicId: already.publicId });
    return;
  }
  const tokenChecked = await tokenGate(req, res, "welfare_report", body.clientRef, "report");
  if (tokenChecked === undefined) return;

  const note = body.note?.trim() ? body.note.trim() : null;
  const now = new Date();
  const photoState = body.hasPhoto ? "pending" : "none";

  const created = await db.transaction(async (tx) => {
    // Insert, or turn this device's draft into the report. A report that was
    // already sent is left alone and nothing new is queued (test 13).
    const [row] = await tx
      .insert(welfareReportsTable)
      .values({
        publicId: newPublicId(),
        kind: "welfare",
        severity: body.severity,
        isLitter: body.isLitter,
        lat: body.lat,
        lng: body.lng,
        note,
        reporterLanguage: body.language,
        reporterDevice: body.deviceId,
        clientRef: body.clientRef,
        isDraft: false,
        photoState,
        submittedAt: now,
        tokenChecked,
      })
      .onConflictDoUpdate({
        target: [
          welfareReportsTable.reporterDevice,
          welfareReportsTable.kind,
          welfareReportsTable.clientRef,
        ],
        set: {
          severity: body.severity,
          isLitter: body.isLitter,
          lat: body.lat,
          lng: body.lng,
          note,
          reporterLanguage: body.language,
          isDraft: false,
          photoState,
          submittedAt: now,
          tokenChecked,
        },
        setWhere: sql`${welfareReportsTable.isDraft} = true`,
      })
      .returning({ id: welfareReportsTable.id, publicId: welfareReportsTable.publicId });
    if (!row) return null;
    // Wait up to 10 minutes for the photo, so the alert can carry it.
    const dueAt = body.hasPhoto
      ? new Date(now.getTime() + PHOTO_WAIT_MINUTES * 60_000)
      : null;
    // An unchecked report's alert is capped (10 an hour in total, then one
    // "waiting" email an hour); every other report's alert goes as before.
    if (tokenChecked === false) await enqueueUncheckedWelfareAlert(tx, row.id, dueAt);
    else await enqueueWelfareAlert(tx, row.id, "alert", dueAt);
    return row;
  });

  if (!created) {
    const [existing] = await db
      .select({ publicId: welfareReportsTable.publicId })
      .from(welfareReportsTable)
      .where(
        and(
          eq(welfareReportsTable.kind, "welfare"),
          eq(welfareReportsTable.reporterDevice, body.deviceId),
          eq(welfareReportsTable.clientRef, body.clientRef),
        ),
      );
    res.status(200).json({ publicId: existing!.publicId });
    return;
  }

  res.status(201).json({ publicId: created.publicId });
  if (!body.hasPhoto) kick();
});

// ── 1.4 The photo, second ──────────────────────────────────────────────────
router.put("/reports/:publicId/photo", async (req, res) => {
  const parsed = PhotoBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const body = parsed.data;
  if (!(await verifyDeviceSecret(req, res, body.deviceId, WELFARE_DEVICE_AUTH))) return;

  const publicId = String(req.params["publicId"] ?? "");
  const [report] = await db
    .select()
    .from(welfareReportsTable)
    .where(
      and(
        eq(welfareReportsTable.publicId, publicId),
        // SYC-44 PR 4.1: only a "needs help" report takes a photo here. An
        // issue row's public id aimed at this route would otherwise set
        // photo_state = 'attached', which its database check refuses (500).
        eq(welfareReportsTable.kind, "welfare"),
        eq(welfareReportsTable.isDraft, false),
      ),
    );
  // The same answer for "no such report", "not your report" and "not a
  // needs-help report".
  if (!report || report.reporterDevice !== body.deviceId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // The second caller of the shared photo check (spec §4.3): magic bytes,
  // full decode, EXIF rotation and metadata strip, bounded re-encode.
  const validated = await validatePhotoBase64(body.photoBase64);
  if ("error" in validated) {
    // The same bytes will be refused again, so stop waiting for them: the
    // alert goes now and says the photo couldn't be received, rather than
    // "still uploading" (review of #55). A later good photo still attaches.
    if (report.photoState === "pending") {
      await db.transaction(async (tx) => {
        await tx
          .update(welfareReportsTable)
          .set({ photoState: "failed" })
          .where(and(eq(welfareReportsTable.id, report.id), eq(welfareReportsTable.photoState, "pending")));
        await tx
          .update(mailOutboxTable)
          .set({ nextAttemptAt: new Date() })
          .where(
            and(
              eq(mailOutboxTable.reportId, report.id),
              eq(mailOutboxTable.state, "queued"),
              sql`${mailOutboxTable.payload}->>'kind' = 'alert'`,
            ),
          );
      });
      res.status(400).json({ error: validated.error });
      kick();
      return;
    }
    res.status(400).json({ error: validated.error });
    return;
  }

  const shouldKick = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(welfareReportPhotosTable)
      .values({
        publicId: newPublicId(),
        reportId: report.id,
        bytes: validated.buffer,
        mime: validated.mime,
      })
      .onConflictDoNothing({ target: welfareReportPhotosTable.reportId })
      .returning({ id: welfareReportPhotosTable.id });
    if (!inserted.length) return false; // a resend of a photo we already have
    await tx
      .update(welfareReportsTable)
      .set({ photoState: "attached" })
      .where(eq(welfareReportsTable.id, report.id));
    // Still waiting? Send the alert now, with the photo.
    const bumped = await tx
      .update(mailOutboxTable)
      .set({ nextAttemptAt: new Date() })
      .where(
        and(
          eq(mailOutboxTable.reportId, report.id),
          eq(mailOutboxTable.state, "queued"),
          sql`${mailOutboxTable.payload}->>'kind' = 'alert'`,
        ),
      )
      .returning({ id: mailOutboxTable.id });
    if (!bumped.length) {
      // The alert already went (or is going) without it: a short follow-up.
      // Not when the report never had an alert of its own (SYC-170: an
      // unchecked report beyond the hour's 10 is counted in the "waiting"
      // email instead), or the cap could be walked round one photo at a time.
      const [main] = await tx
        .select({ id: mailOutboxTable.id })
        .from(mailOutboxTable)
        .where(
          and(
            eq(mailOutboxTable.reportId, report.id),
            sql`${mailOutboxTable.payload}->>'kind' = 'alert'`,
          ),
        )
        .limit(1);
      if (main) {
        // An unchecked report's follow-up counts toward the hour's 10.
        if (report.tokenChecked === false) await enqueueUncheckedPhotoFollowUp(tx, report.id);
        else await enqueueWelfareAlert(tx, report.id, "photo", null);
      }
    }
    return true;
  });

  res.status(200).json({ ok: true });
  if (shouldKick) kick();
});

export default router;
