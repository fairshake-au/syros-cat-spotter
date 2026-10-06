import { Router, type IRouter, type Request, type Response } from "express";
import { db, photosTable, welfareReportPhotosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getQueueReport, listWelfareQueue } from "../lib/welfareQueue";
import {
  moveReportState,
  NOTE_MAX,
  REPORT_STATES,
  writeTeamNote,
} from "../lib/welfareActions";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import { requireOrigin, setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";

// The welfare queue's data and photos for the staff dashboard (SYC-43 part 2
// plan, PR 1 and PR 2). No CORS headers: app.ts skips /api/team/. The reading
// routes use requireTeam("view_exact_location"): they show exact positions.
// The two POST routes at the end check Origin first, then their capability.

const router: IRouter = Router();

/** GET /api/team/reports: the queue as JSON (SYC-42 2.2); the page's data. */
router.get(
  "/team/reports",
  requireTeam("view_exact_location"),
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
  requireTeam("view_exact_location"),
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
 * GET /api/team/photos/:publicId: catalogue photos for the dashboard. It
 * serves photos hidden from the public too (spec §6: staff see hidden items),
 * and stays under /api/team/ so the pre-launch gate and CORS rules need no
 * new exception.
 */
router.get(
  "/team/photos/:publicId",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const publicId = String(req.params["publicId"]);
    if (!PHOTO_ID_RE.test(publicId)) return notFound(res);
    const [photo] = await db
      .select({ data: photosTable.data, mime: photosTable.mime })
      .from(photosTable)
      .where(eq(photosTable.publicId, publicId));
    if (!photo || !IMAGE_TYPES.has(photo.mime)) return notFound(res);
    res.setHeader("Content-Type", photo.mime);
    res.send(Buffer.from(photo.data, "base64"));
  },
);

// ── PR 2: moving a report and the team note ────────────────────────────────

export const CHANGED_MESSAGE =
  "Someone else changed this report a moment ago. Here's where it is now.";

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

/** 400 with field names only: never the values, which can include the note. */
function badRequest(res: Response, fields: string[]) {
  setTeamHeaders(res);
  res.status(400).json({ error: "Invalid request", fields });
}

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
    if (!parsed.success) return badRequest(res, fieldsOf(parsed.error));
    const { from, to } = parsed.data;
    // "Move" to where it already is: nothing to record.
    if (from === to) return badRequest(res, ["to"]);
    if (!PUBLIC_ID_RE.test(publicId)) return notFound(res);

    const outcome = await moveReportState({
      publicId,
      from,
      to,
      personId: person.id,
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
    const parsed = NoteBody.safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, fieldsOf(parsed.error));
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

export default router;
