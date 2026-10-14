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
import { validatePhotoBase64 } from "../lib/imageValidation";
import {
  PHOTO_WAIT_MINUTES,
  enqueueWelfareAlert,
  kick,
} from "../lib/mail/outbox";

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
 *   to testers; Turnstile and shared limits are Slice 4 (SYC-170, SYC-105).
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

  await db
    .insert(welfareReportsTable)
    .values({
      publicId: newPublicId(),
      severity: body.severity,
      isLitter: body.isLitter ?? false,
      lat: body.lat,
      lng: body.lng,
      reporterLanguage: body.language,
      reporterDevice: body.deviceId,
      clientRef: body.clientRef,
      isDraft: true,
    })
    .onConflictDoUpdate({
      target: [welfareReportsTable.reporterDevice, welfareReportsTable.clientRef],
      set: {
        severity: body.severity,
        isLitter: body.isLitter ?? false,
        lat: body.lat,
        lng: body.lng,
        reporterLanguage: body.language,
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
      })
      .onConflictDoUpdate({
        target: [welfareReportsTable.reporterDevice, welfareReportsTable.clientRef],
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
        },
        setWhere: sql`${welfareReportsTable.isDraft} = true`,
      })
      .returning({ id: welfareReportsTable.id, publicId: welfareReportsTable.publicId });
    if (!row) return null;
    // Wait up to 10 minutes for the photo, so the alert can carry it.
    const dueAt = body.hasPhoto
      ? new Date(now.getTime() + PHOTO_WAIT_MINUTES * 60_000)
      : null;
    await enqueueWelfareAlert(tx, row.id, "alert", dueAt);
    return row;
  });

  if (!created) {
    const [existing] = await db
      .select({ publicId: welfareReportsTable.publicId })
      .from(welfareReportsTable)
      .where(
        and(
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
        eq(welfareReportsTable.isDraft, false),
      ),
    );
  // The same answer for "no such report" and "not your report".
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
      await enqueueWelfareAlert(tx, report.id, "photo", null);
    }
    return true;
  });

  res.status(200).json({ ok: true });
  if (shouldKick) kick();
});

export default router;
