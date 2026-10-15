import { Router, type IRouter, type Request, type Response } from "express";
import { db, photosTable, welfareReportPhotosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getQueueReport, listWelfareQueue } from "../lib/welfareQueue";
import {
  CHANGED_MESSAGE,
  moveReportState,
  NOTE_MAX,
  REPORT_STATES,
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
import { escapeHtml } from "../lib/teamPages/escape";

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

const notFound = (res: Response) => {
  setTeamHeaders(res);
  res.status(404).json({ error: "Not found" });
};

// Photo ids are base64url (report photos) or uuids (catalogue photos).
// Anything else is simply not a photo: answered before Postgres, which
// would refuse some bytes (a NUL, say) with an error instead.
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Uploads only ever store these (lib/imageValidation.ts). Anything else in a
// row is served as nothing, never as the type the row claims.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

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
router.get(
  "/team/photos/:publicId",
  requireTeam("view_exact_location", {
    target: (req) => photoTargets(String(req.params["publicId"])),
  }),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const publicId = String(req.params["publicId"]);
    if (!PHOTO_ID_RE.test(publicId)) return notFound(res);
    const [photo] = await db
      .select({ id: photosTable.id, data: photosTable.data, mime: photosTable.mime })
      .from(photosTable)
      .where(eq(photosTable.publicId, publicId));
    if (!photo || !IMAGE_TYPES.has(photo.mime)) return notFound(res);
    if (
      !can(teamPerson(res), "hide_photo") &&
      (await hiddenPhotoIds([photo.id])).has(photo.id)
    ) {
      req.log.info({ reason: "hidden_photo" }, "team request refused");
      return refuseSignedIn(req, res);
    }
    res.setHeader("Content-Type", photo.mime);
    res.send(Buffer.from(photo.data, "base64"));
  },
);

// ── PR 2: moving a report and the team note ────────────────────────────────

const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const StateBody = z.object({
  from: z.enum(REPORT_STATES),
  to: z.enum(REPORT_STATES),
});
const NoteBody = z.object({ note: z.string().max(NOTE_MAX) });

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
 * POST /api/team/reports/:publicId/state: move a sent report to one of the
 * four states. `from` is the state the page showed; if the report is no
 * longer there, someone else moved it first and nothing is written. Sends
 * nothing to anyone (reporter email is Slice 3).
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
    const { from, to } = parsed.data;
    // "Move" to where it already is: nothing to record.
    if (from === to) return badRequest(req, res, ["to"], publicId);
    if (!PUBLIC_ID_RE.test(publicId)) return notFound(res);

    const outcome = await moveReportState({
      publicId,
      from,
      to,
      person,
    });
    if (outcome === "not_found") return notFound(res);
    if (isFormPost(req)) {
      return void res.redirect(
        303,
        backToReport(publicId, outcome === "changed"),
      );
    }
    const report = await getQueueReport(publicId);
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
    if (isFormPost(req)) return void res.redirect(303, backToReport(publicId));
    res.json(await getQueueReport(publicId));
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

export default router;
