import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, photosTable, welfareReportPhotosTable, welfareReportsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getQueueReport, listWelfareQueue } from "../lib/welfareQueue";
import { getIssueReport, listIssues } from "../lib/issues/queue";
import {
  hideFromIssue,
  keepHidden,
  ISSUE_OUTCOME_TEXT,
  restoreFromIssue,
  type OpenState,
} from "../lib/issues/teamActions";
import {
  CHANGED_MESSAGE,
  moveReportState,
  NOTE_MAX,
  REPORT_STATES,
  sentReportRef,
  writeTeamNote,
} from "../lib/welfareActions";
import { ObservationRefused } from "../lib/observations";
import {
  TIE_CHANGED_MESSAGE,
  TIE_SAME_MESSAGE,
  tieReportToCat,
} from "../lib/welfareTie";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import {
  requireOrigin,
  setTeamHeaders,
} from "../lib/teamAuth/refuse";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
import { renderPage } from "../lib/teamPages/layout";
import { can } from "../lib/capabilities";
import { photoTargets } from "../lib/capabilityTargets";
import { hiddenPhotoIds } from "../lib/photoVisibility";
import { isVariantSize, variantFor } from "../lib/photoVariants";
import { escapeHtml } from "../lib/teamPages/escape";
import {
  cleanTeamSentence,
  REPORT_OUTCOME_CLOSE,
  REPORT_OUTCOME_LEAD,
  TEAM_SENTENCE_MAX,
} from "../lib/mail/reportTemplates";
import { kickRow } from "../lib/mail/outbox";
import { REPORTER_ON_CLOSE, reporterOnClose } from "../lib/welfare/reporterEmail";
import { renderConfirmPage } from "../lib/teamPages/confirm";

// The welfare queue's data and photos for the staff dashboard (SYC-43 part 2
// plan, PR 1 and PR 2). No CORS headers: app.ts skips /api/team/. The queue
// and the reporters' photos need `view_welfare_queue`, which only the team
// holds (roles spec §6.2 note 4); a cat guardian's own read-only reports get
// their own routes in PR 3.3. The catalogue photo route needs
// `view_exact_location` for the photo's cats' colonies, read from the record.
// The POST routes at the end check Origin first, then their capability, with
// no target: island-only.

const router: IRouter = Router();

/** GET /api/team/reports: the queue as JSON (SYC-42 2.2); the page's data. */
router.get(
  "/team/reports",
  requireTeam("view_welfare_queue"),
  async (_req: Request, res: Response) => {
    setTeamHeaders(res); // before any await, so an error answer carries them too
    const queue = await listWelfareQueue();
    res.json(queue);
  },
);

/**
 * GET /api/team/issues: the Issues section as JSON (SYC-44 PR 7.1; spec
 * §5.3). `view_welfare_queue`, island-only: refused, not hidden, for anyone
 * without it. No device, address or contact: lib/issues/queue.ts reads none.
 */
router.get(
  "/team/issues",
  requireTeam("view_welfare_queue"),
  async (_req: Request, res: Response) => {
    setTeamHeaders(res); // before any await, so an error answer carries them too
    res.json(await listIssues());
  },
);

const notFound = (res: Response) => {
  setTeamHeaders(res);
  res.status(404).json({ error: "Not found" });
};

/**
 * The queue's JSON for a report just written to, for the state and note
 * routes' answers. `getQueueReport` is welfare-only (SYC-44 PR 4.1); a
 * "Report an issue" row (`kind = 'content'`) answers in the Issues section's
 * shape (PR 7.1). Neither: a 404 `{ error: "not_found" }`, never a `200 null`
 * (review of #170, finding 4). Returns undefined after answering.
 */
async function queueReportOr404(res: Response, publicId: string) {
  const report = (await getQueueReport(publicId)) ?? (await getIssueReport(publicId));
  if (report === null) {
    setTeamHeaders(res);
    res.status(404).json({ error: "not_found" });
    return undefined;
  }
  return report;
}

// Photo ids are base64url (report photos) or uuids (catalogue photos).
// Anything else is simply not a photo: answered before Postgres, which
// would refuse some bytes (a NUL, say) with an error instead.
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Uploads only ever store these (lib/imageValidation.ts). Anything else in a
// row is served as nothing, never as the type the row claims.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

/** A photo removed for good (SYC-462 spec §3.1 R2/R3): gone, said plainly. */
const removedForGood = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).type("text").send("Removed for good.");
};

/**
 * GET /api/team/report-photos/:publicId: **the only route that serves a
 * report photo** (spec §4.3). It reads welfare_report_photos and nothing
 * else, so the public photo route, which reads `photos`, can never serve one.
 * Served with the stored type, never cached, never sniffed.
 */
router.get(
  "/team/report-photos/:publicId",
  requireTeam("view_welfare_queue"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const publicId = String(req.params["publicId"]);
    if (!PHOTO_ID_RE.test(publicId)) return notFound(res);
    const [photo] = await db
      .select({
        bytes: welfareReportPhotosTable.bytes,
        mime: welfareReportPhotosTable.mime,
      })
      .from(welfareReportPhotosTable)
      .where(eq(welfareReportPhotosTable.publicId, publicId));
    if (!photo || !IMAGE_TYPES.has(photo.mime)) return notFound(res);
    res.setHeader("Content-Type", photo.mime);
    res.send(photo.bytes);
  },
);

/**
 * GET /api/team/issue-photos/:reportPublicId: **the photo an issue report
 * points at**, by the REPORT's public id, hidden or not (SYC-44 PR 7.1; plan
 * review finding 14). `view_welfare_queue`, island-only, so a cat guardian who
 * may see her colony's catalogue photos (/team/photos/) never reaches a photo
 * through an issue report. It serves that one photo and nothing else; a
 * hidden one only to a holder of `hide_photo` too (spec §5.3). Never cached.
 */
router.get(
  "/team/issue-photos/:reportPublicId",
  requireTeam("view_welfare_queue"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const reportId = String(req.params["reportPublicId"]);
    if (!PHOTO_ID_RE.test(reportId)) return notFound(res);
    const [photo] = await db
      .select({ id: photosTable.id, mime: photosTable.mime, removedAt: photosTable.removedAt })
      .from(welfareReportsTable)
      .innerJoin(photosTable, eq(photosTable.id, welfareReportsTable.photoId))
      .where(
        and(
          eq(welfareReportsTable.publicId, reportId),
          eq(welfareReportsTable.kind, "content"),
          eq(welfareReportsTable.isDraft, false),
        ),
      );
    if (!photo || !IMAGE_TYPES.has(photo.mime)) return notFound(res);
    if (photo.removedAt !== null) return removedForGood(res);
    if (!can(teamPerson(res), "hide_photo") && (await hiddenPhotoIds([photo.id])).has(photo.id)) {
      req.log.info({ reason: "hidden_photo" }, "team request refused");
      return refuseSignedIn(req, res);
    }
    // The picture itself is read only now the checks have passed.
    const [full] = await db
      .select({ data: photosTable.data })
      .from(photosTable)
      .where(eq(photosTable.id, photo.id));
    // Removed between the two reads (SYC-462 spec §6 item 1): still gone, never a 500.
    if (!full || full.data === null) return removedForGood(res);
    res.setHeader("Content-Type", photo.mime);
    res.send(Buffer.from(full.data, "base64"));
  },
);

/**
 * GET /api/team/photos/:publicId: catalogue photos for the dashboard. Stays
 * under /api/team/ so the pre-launch gate and CORS rules need no new
 * exception.
 *
 * `view_exact_location` for EVERY cat the photo is tied to, each cat's colony
 * read from the record (lib/capabilityTargets.ts; test T5), never from the
 * request: the team passes everywhere, a cat guardian only for her own
 * colonies' cats, and nobody but the team for a photo of a cat in no colony.
 * A photo hidden from the public is served only to a holder of `hide_photo`
 * (roles spec §6.2 note 4): the team sees hidden items, a guardian doesn't.
 */
const photoAccess = requireTeam("view_exact_location", {
  target: (req) => photoTargets(String(req.params["publicId"])),
});

/**
 * The checks every catalogue-photo route shares, so the photo and its small
 * and medium versions (SYC-396 PR 1.2) can't drift apart. Runs after
 * `photoAccess` (capability, each cat's colony read from the record). Finds the
 * photo and refuses a hidden one to anyone without `hide_photo`. It answers
 * the refusal itself and returns null, or returns the photo to serve.
 */
async function servablePhoto(
  req: Request,
  res: Response,
): Promise<{ id: number; mime: string; removedAt: Date | null } | null> {
  const publicId = String(req.params["publicId"]);
  if (!PHOTO_ID_RE.test(publicId)) {
    notFound(res);
    return null;
  }
  const [photo] = await db
    .select({ id: photosTable.id, mime: photosTable.mime, removedAt: photosTable.removedAt })
    .from(photosTable)
    .where(eq(photosTable.publicId, publicId));
  if (!photo || !IMAGE_TYPES.has(photo.mime)) {
    notFound(res);
    return null;
  }
  // SYC-462: removed for good. Said before the hidden check, so whoever may
  // see this cat's photos learns it is gone rather than "not allowed".
  if (photo.removedAt !== null) {
    removedForGood(res);
    return null;
  }
  if (
    !can(teamPerson(res), "hide_photo") &&
    (await hiddenPhotoIds([photo.id])).has(photo.id)
  ) {
    req.log.info({ reason: "hidden_photo" }, "team request refused");
    refuseSignedIn(req, res);
    return null;
  }
  return photo;
}

router.get("/team/photos/:publicId", photoAccess, async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const photo = await servablePhoto(req, res);
  if (!photo) return;
  // The picture itself is read only now the checks have passed.
  const [full] = await db
    .select({ data: photosTable.data })
    .from(photosTable)
    .where(eq(photosTable.id, photo.id));
  if (!full) return notFound(res);
  // Removed between the two reads (SYC-462 spec §6 item 1): still gone, never a 500.
  if (full.data === null) return removedForGood(res);
  res.setHeader("Content-Type", photo.mime);
  res.send(Buffer.from(full.data, "base64"));
});

/**
 * GET /api/team/photos/:publicId/:size: the small (160 px) or medium (640 px)
 * version of a catalogue photo, for lists and grids (SYC-396 PR 1.2; spec
 * §11). Exactly the photo route's checks (`photoAccess` and `servablePhoto`),
 * so a hidden photo's versions are hidden too. A JPEG with no location data,
 * kept by the browser privately but revalidated on every view (ETag), never in a shared cache.
 */
router.get("/team/photos/:publicId/:size", photoAccess, async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const size = String(req.params["size"]);
  if (!isVariantSize(size)) return notFound(res);
  const photo = await servablePhoto(req, res);
  if (!photo) return;
  const bytes = await variantFor(photo.id, size);
  if (!bytes) return notFound(res);
  // Only now, with access and the hidden check passed, may it be kept. "no-cache"
  // makes the browser ask again on every view, so a photo hidden later is refused
  // at once (never served from the browser copy), and a 304 sends no picture.
  const etag = `"${createHash("sha1").update(bytes).digest("hex")}"`;
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("ETag", etag);
  const sent = String(req.headers["if-none-match"] ?? "")
    .split(",")
    .map((t) => t.trim());
  if (sent.includes(etag) || sent.includes("*")) {
    res.status(304).end();
    return;
  }
  res.type("jpeg").send(bytes);
});

// ── PR 2: moving a report and the team note ────────────────────────────────

const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const StateBody = z.object({
  from: z.enum(REPORT_STATES),
  to: z.enum(REPORT_STATES),
  // SYC-42 Slice 3 (§5.3(h)): one optional line added to the reporter's
  // fixed "Done" email. Ignored for any other state. Never free composition.
  reporterSentence: z
    .string()
    .max(TEAM_SENTENCE_MAX * 2)
    .optional()
    .nullable()
    .transform((v, ctx) => {
      try {
        return cleanTeamSentence(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "too long" });
        return z.NEVER;
      }
    }),
  // SYC-515: set by the "Close this report and email...?" page's button.
  confirm: z.literal("1").optional(),
  // What that page said would happen to the reporter; checked again on press.
  expect: z.enum(REPORTER_ON_CLOSE).optional(),
});
export const NoteBody = z.object({ note: z.string().max(NOTE_MAX) });

/** A browser form post gets a redirect; anything else gets JSON. */
const isFormPost = (req: Request) =>
  Boolean(req.is("application/x-www-form-urlencoded"));

/** Where a browser goes next: the queue, with this report in view. */
const backToReport = (publicId: string, changed = false) =>
  `/api/team${changed ? `?changed=${encodeURIComponent(publicId)}` : ""}#r-${encodeURIComponent(publicId)}`;

/**
 * 400 with field names only: never the values, which can include the note.
 * A browser form post gets a short page with a way back to the report rather
 * than bare JSON; a JSON caller gets the field names.
 */
function badRequest(
  req: Request,
  res: Response,
  fields: string[],
  publicId: string,
) {
  setTeamHeaders(res);
  if (!isFormPost(req)) {
    res.status(400).json({ error: "Invalid request", fields });
    return;
  }
  const why = fields.includes("note")
    ? `A team note can be at most ${NOTE_MAX.toLocaleString("en-GB")} characters.`
    : fields.includes("catId")
      ? "That cat couldn't be found."
      : "Something in the form wasn't right.";
  const back = PUBLIC_ID_RE.test(publicId)
    ? backToReport(publicId)
    : "/api/team";
  res
    .status(400)
    .type("html")
    .send(
      renderPage({
        title: "That didn't save",
        active: "queue",
        personName: teamPerson(res).name,
        body:
          `<p>${escapeHtml(why)} Nothing was changed.</p>` +
          `<p><a href="${escapeHtml(back)}">Back to the report</a></p>`,
      }),
    );
}

/**
 * A browser sends a textarea's line breaks as CRLF, which its own maxlength
 * counts as one character. Store and count them as LF, so a note that fits
 * the box always fits the limit.
 */
const withLfNote = (body: unknown): unknown => {
  if (!body || typeof body !== "object") return body;
  const note = (body as Record<string, unknown>)["note"];
  return typeof note === "string"
    ? { ...body, note: note.replace(/\r\n?/g, "\n") }
    : body;
};

const fieldsOf = (err: z.ZodError) => [
  ...new Set(err.issues.map((i) => i.path.join("."))),
];

/**
 * SYC-515: the "Close this report and email the person who sent it?" page.
 * The email's two fixed sentences are the template's own constants; the
 * extra-line box (Done only, and only when the email goes now) sits above
 * the button. Everything printed is escaped.
 */
function reporterConfirmPage(o: {
  publicId: string;
  from: string;
  to: string;
  now: "will_send" | "held" | "may_not_arrive";
  sentence: string | null | undefined;
  personName: string;
}): string {
  const held = o.now === "held";
  const lines = [REPORT_OUTCOME_LEAD, REPORT_OUTCOME_CLOSE];
  if (held)
    lines.push(
      "They haven't confirmed their email yet. If they do while this report is still closed, they get the standard message.",
    );
  if (o.now === "may_not_arrive") lines.push("Our last email to them didn't arrive, so this one may not either.");
  const box =
    !held && o.to === "done"
      ? `<label class="label" for="reporter-sentence">Add a line to the email (optional) ` +
        '<span class="hint">This goes to a member of the public, added to the fixed message. Keep it short.</span></label>' +
        `<input id="reporter-sentence" name="reporterSentence" type="text" class="text" maxlength="${TEAM_SENTENCE_MAX}"` +
        (o.sentence ? ` value="${escapeHtml(o.sentence)}"` : "") +
        ">"
      : "";
  return renderConfirmPage({
    title: "Close this report and email the person who sent it?",
    lines,
    action: `/api/team/reports/${encodeURIComponent(o.publicId)}/state`,
    fields: { from: o.from, to: o.to, expect: o.now },
    extra: box,
    yes: held ? "Close the report" : "Close and send the email",
    cancelHref: `/api/team?open=${encodeURIComponent(o.publicId)}#r-${encodeURIComponent(o.publicId)}`,
    cancelLabel: "Back to the Queue (nothing changed)",
    personName: o.personName,
    active: "queue",
  });
}

/**
 * POST /api/team/reports/:publicId/state: move a sent report to one of the
 * four states. `from` is the state the page showed; if the report is no
 * longer there, someone else moved it first and nothing is written. A move
 * to a closing state sends the reporter their one outcome email, if they
 * left and confirmed an address (SYC-42 Slice 3); `reporterSentence` adds
 * one line to it on Done.
 */
router.post(
  "/team/reports/:publicId/state",
  requireOrigin(TEAM_ORIGIN),
  requireTeam("change_report_state"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const person = teamPerson(res);
    const publicId = String(req.params["publicId"]);
    const parsed = StateBody.safeParse(req.body ?? {});
    if (!parsed.success)
      return badRequest(req, res, fieldsOf(parsed.error), publicId);
    const { from, to, reporterSentence, confirm, expect } = parsed.data;
    // "Move" to where it already is: nothing to record.
    if (from === to) return badRequest(req, res, ["to"], publicId);
    if (!PUBLIC_ID_RE.test(publicId)) return notFound(res);
    // SYC-44 PR 7.1 (ship review, finding 1): an issue whose photo is still
    // hidden is closed only by Keep hidden or Restore, never by a plain close
    // (from a stale page, say), or the photo would stay hidden with nothing
    // left listing it. The page doesn't offer it; this refuses it.
    if (to === "done" || to === "nothing_needed") {
      const issue = await getIssueReport(publicId);
      if (issue?.photo?.hidden && !issue.photo.removed) {
        if (isFormPost(req)) return void res.redirect(303, backToIssue(publicId, "photo_hidden"));
        return void res.status(409).json({
          error: "photo_hidden",
          message: ISSUE_OUTCOME_TEXT.photo_hidden,
          report: issue,
        });
      }
    }

    // SYC-515: a person closing a report whose reporter would be emailed (or
    // would be, once they confirm) gets a second page first. The answer is
    // worked out here from the record, never from the form. The data routes
    // (JSON) act in one step, as every confirm page does.
    // A confirm press always says what the page promised.
    if (isFormPost(req) && confirm && expect === undefined)
      return badRequest(req, res, ["expect"], publicId);
    let expectReporter = expect;
    if (isFormPost(req) && (to === "done" || to === "nothing_needed")) {
      const row = await sentReportRef(publicId);
      // Not there, or already moved by someone else: moveReportState answers.
      if (row && row.state === from) {
        const now = await reporterOnClose(db, row.id);
        if (!confirm && (now === "will_send" || now === "held" || now === "may_not_arrive")) {
          return void res
            .status(200)
            .type("html")
            .send(reporterConfirmPage({ publicId, from, to, now, sentence: reporterSentence, personName: person.name }));
        }
        // One tap ("none", "already sent"): hold the move to that answer.
        if (!confirm) expectReporter = now;
      }
    }

    const outcome = await moveReportState({
      publicId,
      from,
      to,
      person,
      reporterSentence,
      expectReporter,
      onQueued: kickRow,
    });
    if (outcome === "not_found") return notFound(res);
    if (isFormPost(req)) {
      return void res.redirect(
        303,
        backToReport(publicId, outcome === "changed"),
      );
    }
    const report = await queueReportOr404(res, publicId);
    if (!report) return;
    if (outcome === "changed") {
      return void res.status(409).json({
        error: "changed_by_someone_else",
        message: CHANGED_MESSAGE,
        report,
      });
    }
    res.json(report);
  },
);

/**
 * POST /api/team/reports/:publicId/note: the team note, up to 2,000
 * characters. Team only: it is never shown to the reporter (spec §8.5).
 */
router.post(
  "/team/reports/:publicId/note",
  requireOrigin(TEAM_ORIGIN),
  requireTeam("add_team_note"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const person = teamPerson(res);
    const publicId = String(req.params["publicId"]);
    const parsed = NoteBody.safeParse(withLfNote(req.body ?? {}));
    if (!parsed.success)
      return badRequest(req, res, fieldsOf(parsed.error), publicId);
    if (!PUBLIC_ID_RE.test(publicId)) return notFound(res);

    const written = await writeTeamNote({
      publicId,
      note: parsed.data.note,
      personId: person.id,
    });
    if (!written) return notFound(res);
    // ?noted=: the queue says it's saved and keeps this report open.
    if (isFormPost(req)) {
      return void res.redirect(303, `/api/team?noted=${encodeURIComponent(publicId)}#r-${encodeURIComponent(publicId)}`);
    }
    const report = await queueReportOr404(res, publicId);
    if (report) res.json(report);
  },
);

// ── PR 5: which cat is this? ───────────────────────────────────────────────

/** A cat id from a form (text) or JSON (number): a positive whole number. */
const catIdField = z.preprocess(
  (v) => (typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v),
  z.number().int().positive().max(999_999_999),
);
/** What the page showed: empty (or missing, or null) means "not tied". */
const expectedCatField = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  catIdField.nullable(),
);
const TieBody = z.object({ catId: catIdField, expectedCatId: expectedCatField });

/** Where a browser goes after a tie: the queue, this row, with what happened. */
const backToTiedReport = (publicId: string, outcome: "ok" | "changed" | "same") =>
  `/api/team?tied=${outcome}&r=${encodeURIComponent(publicId)}#r-${encodeURIComponent(publicId)}`;

/**
 * POST /api/team/reports/:publicId/cat: tie a sent report to a cat, or move
 * it to another cat (lib/welfareTie.ts). `expectedCatId` is the cat the page
 * showed (empty = not tied); if the report has moved on since, someone else
 * tied it first and nothing is written. Two layers check the capability:
 * requireTeam here, and the same check inside tieReportToCat. Copies no
 * photo and never the reporter's note. Sends nothing to anyone.
 */
router.post(
  "/team/reports/:publicId/cat",
  requireOrigin(TEAM_ORIGIN),
  requireTeam("change_report_state"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const person = teamPerson(res);
    const publicId = String(req.params["publicId"]);
    const parsed = TieBody.safeParse(req.body ?? {});
    if (!parsed.success)
      return badRequest(req, res, fieldsOf(parsed.error), publicId);
    if (!PUBLIC_ID_RE.test(publicId)) return notFound(res);

    let outcome;
    try {
      outcome = await tieReportToCat({
        person,
        publicId,
        catId: parsed.data.catId,
        expectedCatId: parsed.data.expectedCatId,
      });
    } catch (err) {
      if (err instanceof ObservationRefused && err.code === "NOT_AUTHORISED") {
        req.log.info({ reason: "missing_capability" }, "tie refused");
        return refuseSignedIn(req, res);
      }
      throw err;
    }
    if (outcome.kind === "report_not_found") return notFound(res);
    // SYC-44 PR 4.1: a "Report an issue" row is never tied to a cat (it would
    // write a `welfare_report` observation, i.e. evidence of life). The page
    // never offers the control; a hand-made request gets 409, nothing written.
    if (outcome.kind === "not_welfare") {
      req.log.info({ reason: "not_welfare" }, "tie refused");
      return void res.status(409).json({
        error: "not_welfare",
        message: "Only a \"needs help\" report can be tied to a cat.",
      });
    }
    if (outcome.kind === "cat_not_found")
      return badRequest(req, res, ["catId"], publicId);

    const form = isFormPost(req);
    if (outcome.kind === "tied") {
      if (form) return void res.redirect(303, backToTiedReport(publicId, "ok"));
      return void res.json(await getQueueReport(publicId));
    }
    const kind = outcome.kind; // "changed" | "same"
    if (form) return void res.redirect(303, backToTiedReport(publicId, kind));
    const report = await getQueueReport(publicId);
    if (kind === "changed") {
      return void res.status(409).json({
        error: "changed_by_someone_else",
        message: TIE_CHANGED_MESSAGE,
        report,
      });
    }
    res.json({ ...report, message: TIE_SAME_MESSAGE });
  },
);

// ── SYC-44 PR 7.1: the Issues row's actions (spec §5.4) ──────────────────

// Only from an open state: Keep hidden and Restore close a report, so one
// already closed is refused (review of 7.1, finding 3: a forged from=done
// wrote a done -> done event and reclassified a closed report).
const FromBody = z.object({ from: z.enum(["new", "looking"]) });

/** Where a browser goes after an Issues action: the queue, this row, what happened. */
const backToIssue = (publicId: string, outcome: string) =>
  `/api/team?issue=${encodeURIComponent(outcome)}&r=${encodeURIComponent(publicId)}#r-${encodeURIComponent(publicId)}`;

const ISSUE_ACTIONS = {
  "keep-hidden": { capability: "hide_photo", needsFrom: true },
  restore: { capability: "restore_photo", needsFrom: true },
  hide: { capability: "hide_photo", needsFrom: false },
} as const;

for (const [name, spec] of Object.entries(ISSUE_ACTIONS)) {
  /**
   * POST /api/team/issues/:publicId/keep-hidden | restore | hide. Origin first,
   * then the capability (island-only), then the action, in one transaction
   * (lib/issues/teamActions.ts). `from` is the state the page showed, for the
   * two that close the report.
   */
  router.post(
    `/team/issues/:publicId/${name}`,
    requireOrigin(TEAM_ORIGIN),
    requireTeam(spec.capability),
    async (req: Request, res: Response) => {
      setTeamHeaders(res);
      const person = teamPerson(res);
      const publicId = String(req.params["publicId"]);
      let from: OpenState | undefined;
      if (spec.needsFrom) {
        const parsed = FromBody.safeParse(req.body ?? {});
        if (!parsed.success) return badRequest(req, res, fieldsOf(parsed.error), publicId);
        from = parsed.data.from;
      }
      if (!PUBLIC_ID_RE.test(publicId)) return notFound(res);
      const outcome =
        name === "keep-hidden"
          ? await keepHidden(person, { publicId, from: from! }, kickRow)
          : name === "restore"
            ? await restoreFromIssue(person, { publicId, from: from! }, kickRow)
            : await hideFromIssue(person, { publicId });
      if (outcome === "not_found") return notFound(res);
      if (outcome === "not_authorised") {
        req.log.info({ reason: "missing_capability" }, "issue action refused");
        return refuseSignedIn(req, res);
      }
      if (isFormPost(req)) return void res.redirect(303, backToIssue(publicId, outcome));
      const report = await getIssueReport(publicId);
      const done = outcome === "kept" || outcome === "restored" || outcome === "hidden";
      res.status(done ? 200 : 409).json({ outcome, message: ISSUE_OUTCOME_TEXT[outcome], report });
    },
  );
}

export default router;
