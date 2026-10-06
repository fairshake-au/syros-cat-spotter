import { Router, type IRouter, type Request, type Response } from "express";
import { db, photosTable, welfareReportPhotosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listWelfareQueue } from "../lib/welfareQueue";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam } from "../middlewares/requireTeam";

// The welfare queue's data and photos for the staff dashboard (SYC-43 part 2
// plan, PR 1). No CORS headers: app.ts skips /api/team/. Every route here
// uses requireTeam("view_exact_location"): it shows exact positions.

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

export default router;
