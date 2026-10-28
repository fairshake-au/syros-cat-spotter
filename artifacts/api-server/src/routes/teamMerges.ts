import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { mergeCats, undoMerge, type MergeRefusalCode } from "../lib/mergeCats";
import { loadMergeScreen, type MergeAsk } from "../lib/mergeScreen";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { renderMergePage, renderMergeStopPage, type MergePageOptions } from "../lib/teamPages/mergePage";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
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

// ── The merge screen (which-cat-is-which.md §4.1; SYC-59 PR 4.2) ─────────────
//
// As for the move screen (routes/teamMoves.ts): the dashboard has no scripts,
// and its forms post a browser form and are answered with a page. So the
// screen is a GET page, and "Merge" posts a form to a thin route that calls
// the same `mergeCats` as the JSON route above: the same checks, locks and
// refusals. A refusal comes back as the screen again, with the refusal's
// words and what was typed kept. Only cat numbers are in an address.

const NUMBER = /^\d{1,9}$/;
const one = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
const numberOf = (v: unknown): number | undefined => {
  const s = one(v);
  return s !== undefined && NUMBER.test(s) ? Number(s) : undefined;
};

/** What the address (or the form) asked for. Anything not a plain number is dropped. */
function mergeAskOf(src: unknown): Omit<MergeAsk, "a"> & { a: number | null } {
  const o = (typeof src === "object" && src !== null ? src : {}) as Record<string, unknown>;
  return {
    a: numberOf(o["a"]) ?? null,
    b: numberOf(o["b"]),
    survivor: numberOf(o["survivor"]),
    q: (one(o["q"]) ?? "").slice(0, 60),
  };
}

/** Draws the merge screen for this ask; a stop (nothing can be merged from here) is its own page. */
async function drawMerge(res: Response, status: number, ask: ReturnType<typeof mergeAskOf>, extra: Pick<MergePageOptions, "problem" | "kept"> = {}) {
  const person = teamPerson(res);
  setTeamHeaders(res);
  if (ask.a === null) {
    res.status(404).type("html").send(renderMergeStopPage(person.name, { message: "That cat doesn't exist." }, null));
    return;
  }
  const load = await loadMergeScreen(person, { ...ask, a: ask.a });
  if (load.kind === "stop") {
    res.status(load.status).type("html").send(renderMergeStopPage(person.name, load, ask.a));
    return;
  }
  res.status(status).type("html").send(
    renderMergePage(load, { personName: person.name, ask: { a: ask.a, b: ask.b, survivor: ask.survivor, q: ask.q }, ...extra }),
  );
}

/** GET /api/team/cats/merge?a=&b=&survivor=: the merge screen ("Same cat as…"). */
router.get("/team/cats/merge", requireTeam("merge_cats"), async (req: Request, res: Response) => {
  await drawMerge(res, 200, mergeAskOf(req.query));
});

/**
 * POST /api/team/cats/merge/form: "Merge", from the screen. Origin, session
 * and capability first (formRoute), then the form is checked as the JSON
 * route checks its body (MergeBody), then `mergeCats` does the merge.
 */
router.post("/team/cats/merge/form", ...formRoute("merge_cats"), async (req: Request, res: Response) => {
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const ask = mergeAskOf(body);
  const reasonText = (one(body["reasonText"]) ?? "").replace(/\r\n?/g, "\n").trim();
  const kept = { reasonText };
  const problem = (message: string, status = 400, link?: { href: string; label: string }) =>
    drawMerge(res, status, ask, { problem: { message, link }, kept });

  if (ask.a === null || ask.b === undefined) return void (await drawMerge(res, 400, ask));
  if (ask.survivor !== ask.a && ask.survivor !== ask.b) return void (await problem("Choose which record stays."));
  const n0 = numberOf(body["n0"]);
  const n1 = numberOf(body["n1"]);
  if (n0 === undefined || n1 === undefined) return void (await problem("Something in the form wasn't right. Check it and try again."));
  if (reasonText === "") return void (await problem("Say why they are the same cat."));
  if (reasonText.length > REASON_TEXT_MAX) return void (await problem(`Keep the reason to ${REASON_TEXT_MAX} characters.`));

  const candidate = {
    survivorId: ask.survivor,
    mergedId: ask.survivor === ask.a ? ask.b : ask.a,
    expectedSightingCounts: [n0, n1],
    reasonText,
    survivorChosen: "default",
  };
  const parsed = MergeBody.safeParse(candidate);
  if (!parsed.success) return void (await problem("Something in the form wasn't right. Check it and try again."));

  const outcome = await mergeCats(teamPerson(res), parsed.data);
  if (outcome.ok) {
    // To the cat that stays, where History shows the merge with Undo merge.
    return void res.redirect(303, `/api/team/cats/${outcome.survivorId}?done=merged#history`);
  }
  const { code, message, extra } = outcome.refused;
  if (code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
  const status = STATUS[code];
  if (code === "ALREADY_MERGED" && extra.catId !== undefined) {
    return void (await problem(message, status, { href: `/api/team/cats/${extra.catId}`, label: "Open that cat" }));
  }
  // OWNER_MUST_STAY and NAME_PENDING_MUST_GO: the screen draws the record that has to stay, whatever was posted.
  await problem(message, status);
});

export default router;
