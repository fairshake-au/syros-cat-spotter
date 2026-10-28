import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { mergeCats, undoMerge, type MergeRefusalCode } from "../lib/mergeCats";
import { refuseSignedIn, teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";

// Merging two records of the same cat, and undoing a merge
// (which-cat-is-which.md §4, §9.7 merge and undo; SYC-59 PR 4.1). JSON in,
// JSON out: the merge and undo screens (PR 4.2) send what they expect to
// find, and are told exactly what happened or why nothing did. Origin, the
// session and `merge_cats` (island, TEAM) are checked first (formRoute).

const router: IRouter = Router();

const REASON_TEXT_MAX = 500;
const noNul = (s: string) => !s.includes(String.fromCharCode(0));
const id = z.number().int().positive().max(2_147_483_647);
const count = z.number().int().min(0).max(2_147_483_647);
const reasonText = z.string().trim().min(1).max(REASON_TEXT_MAX).refine(noNul);

export const MergeBody = z.object({
  survivorId: id,
  mergedId: id,
  expectedSightingCounts: z.tuple([count, count]),
  // "Why?" is required (§4.1).
  reasonText,
  survivorChosen: z.enum(["default", "switched"]),
});

export const UndoBody = z.object({
  reasonText,
  alsoMoveSightingIds: z.array(id).max(500).default([]),
});

const STATUS: Record<Exclude<MergeRefusalCode, "NOT_AUTHORISED">, number> = {
  NOT_FOUND: 404,
  SAME_CAT: 400,
  ALREADY_MERGED: 409,
  TWO_OWNERS: 409,
  OWNER_MUST_STAY: 409,
  NAME_PENDING_MUST_GO: 409,
  STALE: 409,
  ALREADY_UNDONE: 409,
  UNDO_LATER_MERGE_FIRST: 409,
  NOT_TO_MOVE: 409,
};

const invalid = (res: Response, error: z.ZodError) =>
  // Field names only, never what was typed (the team routes' convention).
  res.status(400).json({ error: "Invalid request", fields: [...new Set(error.issues.map((i) => i.path.join(".")))] });

/** POST /api/team/cats/merge (§9.7). */
router.post("/team/cats/merge", ...formRoute("merge_cats"), async (req: Request, res: Response) => {
  const parsed = MergeBody.safeParse(req.body ?? {});
  if (!parsed.success) return void invalid(res, parsed.error);
  const outcome = await mergeCats(teamPerson(res), parsed.data);
  if (!outcome.ok) {
    const { code, message, extra } = outcome.refused;
    if (code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
    return void res.status(STATUS[code]).json({ error: message, code, ...extra });
  }
  const { mergeId, survivorId, mergedId, moved, followsAdded, paid } = outcome;
  // Counts only for the phones: which phones follow or were paid is not the screen's business.
  res.json({ mergeId, survivorId, mergedId, moved, followsAdded: followsAdded.length, paid: paid.length });
});

/** POST /api/team/cats/merge/:id/undo (§9.7). */
router.post("/team/cats/merge/:id/undo", ...formRoute("merge_cats"), async (req: Request, res: Response) => {
  const raw = String(req.params["id"]);
  if (!/^\d{1,9}$/.test(raw)) return void res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  const parsed = UndoBody.safeParse(req.body ?? {});
  if (!parsed.success) return void invalid(res, parsed.error);
  const outcome = await undoMerge(teamPerson(res), Number(raw), parsed.data);
  if (!outcome.ok) {
    const { code, message, extra } = outcome.refused;
    if (code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
    return void res.status(STATUS[code]).json({ error: message, code, ...extra });
  }
  const { undoId, mergeId, catId, survivorId, movedBack, alsoMoved, followsRemoved } = outcome;
  res.json({ undoId, mergeId, catId, survivorId, movedBack, alsoMoved, followsRemoved });
});

export default router;
