import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { MOVE_REASONS_FROM_SCREEN, MOVE_SOURCES_FROM_SCREEN, moveSightings, type MoveInput, type MoveRefusalCode } from "../lib/moveSightings";
import { loadMoveScreen } from "../lib/moveScreen";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { renderMovePage, renderMoveStopPage, type MovePageOptions } from "../lib/teamPages/movePage";
import type { MoveSource } from "../lib/teamPages/moveLinks";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
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

// ── The move screen (which-cat-is-which.md §5.1, §5.2; SYC-150 PR 3.3) ───────
//
// The dashboard has no scripts, and its forms post a browser form and are
// answered with a page (teamCorrections.ts, confirm.ts). So the screen is a
// GET page, and "Move" posts a form to a thin route that calls the same
// `moveSightings` as the JSON route above: the same checks, the same locks,
// the same refusals. A refusal comes back as this page again, with the
// refusal's words and what was filled in kept. Nothing about a position is in
// an address: only sighting numbers and the cat they are under.

const NUMBER = /^\d{1,9}$/;
const one = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : undefined;
const many = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

interface Ask {
  cat: number | null;
  sightings: number[];
  to?: number;
  fresh: boolean;
  q: string;
  source: MoveSource;
  report?: string;
}

/** What the address (or the form) asked for. Anything not a plain number is dropped. */
function askOf(src: unknown): Ask {
  const o = (typeof src === "object" && src !== null ? src : {}) as Record<string, unknown>;
  const cat = one(o["cat"]);
  const to = one(o["to"]);
  const source = one(o["source"]) ?? "";
  const report = one(o["report"]);
  const listed = [...(one(o["s"]) ?? "").split(","), ...many(o["tick"])].map((x) => x.trim()).filter((x) => NUMBER.test(x)).map(Number);
  return {
    cat: cat !== undefined && NUMBER.test(cat) ? Number(cat) : null,
    sightings: [...new Set(listed)].sort((a, b) => a - b).slice(0, 100),
    to: to !== undefined && NUMBER.test(to) ? Number(to) : undefined,
    fresh: one(o["new"]) === "1" || one(o["mode"]) === "new",
    q: (one(o["q"]) ?? "").slice(0, 60),
    source: (MOVE_SOURCES_FROM_SCREEN as readonly string[]).includes(source) ? (source as MoveSource) : "cat_page",
    report: report !== undefined && report.length <= 100 ? report : undefined,
  };
}

/** Draws the screen for this ask; a stop (nothing to move from here) is its own page. */
async function drawScreen(res: Response, status: number, ask: Ask, extra: Pick<MovePageOptions, "problem" | "kept"> = {}) {
  const person = teamPerson(res);
  setTeamHeaders(res);
  if (ask.cat === null) {
    res.status(404).type("html").send(renderMoveStopPage(person.name, { message: "That cat doesn't exist.", now: [] }, null));
    return;
  }
  const load = await loadMoveScreen(person, {
    cat: ask.cat,
    sightingIds: ask.sightings,
    toCatId: ask.to,
    fresh: ask.fresh,
    q: ask.q,
  });
  if (load.kind === "stop") {
    res.status(load.status).type("html").send(renderMoveStopPage(person.name, load, ask.cat));
    return;
  }
  res.status(status).type("html").send(
    renderMovePage(load.screen, {
      personName: person.name,
      ask: { cat: ask.cat, sightings: ask.sightings, source: ask.source, report: ask.report, fresh: ask.fresh, q: ask.q, to: ask.to },
      ...extra,
    }),
  );
}

/** GET /api/team/sightings/move?cat=&s=&to=|new=1: the move screen. */
router.get("/team/sightings/move", requireTeam("move_sighting"), async (req: Request, res: Response) => {
  await drawScreen(res, 200, askOf(req.query));
});

const MOVE_REASONS: readonly string[] = MOVE_REASONS_FROM_SCREEN;

/** §5.3 leaves the offer of a merge to a merge screen (PR 4.2): until then the screen says to ask. */
const MERGE_ASK = "These look like the same cat. Ask for a merge.";

/**
 * POST /api/team/sightings/move/form: "Move", from the screen. Origin, session
 * and capability first (formRoute), then the form is checked as the JSON route
 * checks its body (MoveBody), then `moveSightings` does the move.
 */
router.post("/team/sightings/move/form", ...formRoute("move_sighting"), async (req: Request, res: Response) => {
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const ask = askOf(body);
  const reason = one(body["reason"]);
  const reasonText = (one(body["reasonText"]) ?? "").replace(/\r\n?/g, "\n").trim();
  const name = (one(body["name"]) ?? "").trim();
  const letSpottersName = one(body["letSpottersName"]) === "1";
  const mainPhoto = one(body["mainPhoto"]);
  const kept = { reason, reasonText, name, letSpottersName, mainPhoto };
  const problem = (message: string, status = 400, link?: { href: string; label: string }) =>
    drawScreen(res, status, ask, { problem: { message, link }, kept });

  if (ask.cat === null || ask.sightings.length === 0) return void (await drawScreen(res, 400, ask));
  if (reason === undefined || !MOVE_REASONS.includes(reason)) return void (await problem("Choose why you are moving it."));
  if (reason === "other" && reasonText === "") return void (await problem("Say what the other reason is."));
  if (reasonText.length > REASON_TEXT_MAX) return void (await problem(`Keep the reason to ${REASON_TEXT_MAX} characters.`));
  if (!ask.fresh && ask.to === undefined) return void (await problem("Choose which cat it is, or say it's a new cat."));
  if (ask.fresh && letSpottersName && name !== "") return void (await problem("Type a name, or tick “Let spotters name it”, not both."));
  if (ask.fresh && !letSpottersName && name === "") return void (await problem("Type a name, or tick “Let spotters name it”."));
  if (mainPhoto !== undefined && !/^\d{1,10}$/.test(mainPhoto)) return void (await problem("Choose the cat's next main photo."));

  const candidate = {
    sightingIds: ask.sightings,
    expectedCatId: ask.cat,
    ...(ask.fresh ? { newCat: letSpottersName ? { letSpottersName: true } : { name, letSpottersName: false } } : { toCatId: ask.to }),
    ...(mainPhoto !== undefined ? { newMainPhotoId: Number(mainPhoto) } : {}),
    reason,
    ...(reasonText !== "" ? { reasonText } : {}),
    source: ask.source,
    ...(ask.report ? { reportId: ask.report } : {}),
  };
  const parsed = MoveBody.safeParse(candidate);
  if (!parsed.success) return void (await problem("Something in the form wasn't right. Check it and try again."));
  const newCat = parsed.data.newCat
    ? { letSpottersName: parsed.data.newCat.letSpottersName, ...(parsed.data.newCat.letSpottersName ? {} : { name: parsed.data.newCat.name ?? "" }) }
    : undefined;
  const input: MoveInput = { ...parsed.data, newCat };

  const outcome = await moveSightings(teamPerson(res), input);
  if (outcome.ok) {
    // Back to the cat the sightings left, where History shows the move.
    return void res.redirect(303, `/api/team/cats/${outcome.fromCatId}?done=moved#history`);
  }
  const { code, message, extra } = outcome.refused;
  if (code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
  const status = STATUS[code];
  // Someone moved it first, or it isn't matched: the screen says where it is now.
  if (code === "MOVED_ALREADY" || code === "NOT_RESOLVED" || code === "NOT_FOUND") {
    return void (await drawScreen(res, status, ask, { problem: { message } }));
  }
  if (code === "MERGE_INSTEAD") return void (await problem(MERGE_ASK, status));
  if (code === "NAME_TAKEN" && extra.cat) {
    return void (await problem(message, status, { href: `/api/team/cats/${extra.cat.id}`, label: `Open ${extra.cat.name}` }));
  }
  await problem(message, status);
});

export default router;
