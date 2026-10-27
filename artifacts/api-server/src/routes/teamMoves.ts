import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { MOVE_REASONS_FROM_SCREEN, MOVE_SOURCES_FROM_SCREEN, moveSightings, type MoveRefusalCode } from "../lib/moveSightings";
import { refuseSignedIn, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";

// Moving a sighting to the right cat (which-cat-is-which.md §9.7 move; SYC-150
// PR 3.2). JSON in, JSON out: the move screen (PR 3.3) sends what it expects
// to find, and is told exactly what happened or why nothing did. Origin, the
// session and `move_sighting` (island, TEAM) are checked first (formRoute).

const router: IRouter = Router();

const REASON_TEXT_MAX = 500;
const noNul = (s: string) => !s.includes(String.fromCharCode(0));
const id = z.number().int().positive().max(2_147_483_647);

export const MoveBody = z
  .object({
    sightingIds: z.array(id).min(1).max(100),
    expectedCatId: id,
    toCatId: id.optional(),
    newCat: z
      .object({
        name: z.string().max(200).refine(noNul).optional(),
        letSpottersName: z.boolean(),
      })
      .optional(),
    newMainPhotoId: z.number().int().min(0).max(2_147_483_647).optional(),
    reason: z.enum(MOVE_REASONS_FROM_SCREEN),
    reasonText: z.string().trim().min(1).max(REASON_TEXT_MAX).refine(noNul).optional(),
    source: z.enum(MOVE_SOURCES_FROM_SCREEN),
    reportId: z.string().min(1).max(100).optional(),
  })
  // A cat, or a new one: never both, never neither.
  .refine((b) => (b.toCatId === undefined) !== (b.newCat === undefined), { path: ["toCatId"] })
  // A typed name, or "Let spotters name it": never both.
  .refine((b) => !(b.newCat?.letSpottersName && b.newCat.name !== undefined && b.newCat.name.trim() !== ""), { path: ["newCat"] })
  // "Other…" says what.
  .refine((b) => b.reason !== "other" || b.reasonText !== undefined, { path: ["reasonText"] })
  // A move from a report names it.
  .refine((b) => b.source !== "report" || b.reportId !== undefined, { path: ["reportId"] });

const STATUS: Record<Exclude<MoveRefusalCode, "NOT_AUTHORISED">, number> = {
  NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  NOT_RESOLVED: 409,
  SAME_CAT: 400,
  MOVED_ALREADY: 409,
  MERGE_INSTEAD: 409,
  ALREADY_ITS_OWN_CAT: 409,
  MAIN_PHOTO_NEEDED: 400,
  EMPTY_NAME: 400,
  OFFENSIVE_NAME: 400,
  SYR_SHAPED_NAME: 400,
  NAME_HAS_LINK: 400,
  NAME_TAKEN: 409,
};

/** POST /api/team/sightings/move (§9.7). */
router.post("/team/sightings/move", ...formRoute("move_sighting"), async (req: Request, res: Response) => {
  const parsed = MoveBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Field names only, never what was typed (the team routes' convention).
    res.status(400).json({ error: "Invalid request", fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))] });
    return;
  }
  const body = parsed.data;
  const newCat = body.newCat
    ? {
        letSpottersName: body.newCat.letSpottersName,
        ...(body.newCat.letSpottersName ? {} : { name: body.newCat.name ?? "" }),
      }
    : undefined;
  const outcome = await moveSightings(teamPerson(res), { ...body, newCat });
  if (!outcome.ok) {
    const { code, message, extra } = outcome.refused;
    if (code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
    res.status(STATUS[code]).json({ error: message, code, ...extra });
    return;
  }
  const { batchId, fromCatId, toCatId, madeNewCat, moves } = outcome;
  res.json({ batchId, fromCatId, toCatId, madeNewCat, moves });
});

export default router;
