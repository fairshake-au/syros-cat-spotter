import { movedAwayNotices } from "../lib/movedAway";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  coloniesTable,
  db,
  findPersonById,
  LAST_MANAGER,
  myColonies,
  setOwnLanguage,
  type PersonWithScopes,
} from "@workspace/db";
import { ActionRefused, signOutEverywhere, stopHelping } from "../lib/people/actions";
import { SIGN_IN_PAGE } from "../lib/teamAuth/config";
import { clearInviteSession, clearSession } from "../lib/teamAuth/session";
import { isBrowserNavigation, setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { isTeamRole } from "../lib/teamRoles";
import { formRoute } from "./teamCorrections";
import { MY_COLONIES_PATH, MY_PAGE_PATH } from "../lib/teamPages/layout";
import {
  renderMyColoniesPage,
  renderMyPage,
  renderMyProblem,
  renderStopHelpingConfirm,
  renderStoppedPage,
  MY_STOP_PATH,
  type MyPerson,
} from "../lib/teamPages/myPages";
import {
  renderGuardianCatPage,
  renderGuardianColonyPage,
  renderGuardianNotFound,
  renderPublicCatForGuardian,
} from "../lib/teamPages/guardianPages";
import { can, holdsStartRow } from "../lib/capabilities";
import { canonicalCats, catTargetWithCanonical } from "../lib/capabilityTargets";
import { catsInColony } from "../lib/colonyMembership";
import { guardianCats, guardianCatView } from "../lib/guardianCatView";
import { publicCatView } from "../lib/publicCat";
import { z } from "zod";
import { ObservationRefused } from "../lib/observations";
import { refuseSignedIn } from "../middlewares/requireTeam";
import {
  GUARDIAN_LIFE_STATUSES,
  guardianPutsBack,
  guardianSaysLifeStatus,
  guardianSaysSterilised,
  myStatementsOnCat,
} from "../lib/guardianStatements";
import { myCatPath, renderGuardianProblem } from "../lib/teamPages/guardianPages";
import { sitesForPerson } from "../lib/teamSites";

// SYC-53 PR 1.3: "My page" and "My colonies" (roles-and-invites.md §2.6, §6.2
// note 1, §9.1, §9.5, §13.1). Any accepted person, no capability: these are
// about yourself, so requireTeam runs with `own` (a person who holds nothing
// any more can still sign out and stop helping). Every POST is behind the
// dashboard's Origin check (formRoute); a missing Origin is refused too. Each
// change goes through PR 1.1's functions, which refuse the last manager.
// Pressing a button twice changes nothing the second time.

const router: IRouter = Router();
const OWN = { own: true } as const;

/** What the pages need to say about the signed-in person, from the record now. */
async function aboutMe(person: PersonWithScopes): Promise<MyPerson> {
  return {
    name: person.name,
    language: person.language,
    team: person.scopes.some((s) => isTeamRole(s.role)),
    management: person.scopes.some((s) => s.role === "management"),
    placements: await myColonies(person.id),
    starting: holdsStartRow(person),
  };
}

/** GET /api/team/my: the sentence about yourself, language, sign out, stop helping. */
router.get("/team/my", requireTeam(undefined, OWN), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const me = await aboutMe(teamPerson(res));
  res.type("html").send(renderMyPage({ person: me, savedLanguage: req.query["saved"] === "language" }));
});

/** GET /api/team/my/colonies: a guardian's colonies; the team gets a link to the island's pages. */
router.get("/team/my/colonies", requireTeam(undefined, OWN), async (_req: Request, res: Response) => {
  setTeamHeaders(res);
  const person = teamPerson(res);
  const me = await aboutMe(person);
  res.type("html").send(renderMyColoniesPage({ person: me, movedAway: await movedAwayNotices(person) }));
});

// ── SYC-53 PR 2.1: her colony and her cats (roles-and-invites.md §2.2, §6.1) ──
//
// `view_exact_location`, placed, with the target READ FROM THE RECORD: the
// colony in the path is only a name for what she asks about, checked against
// her placements by can(); a cat's colony is its newest standing `colony`
// statement (lib/capabilityTargets.ts, through any merge). What she gets is
// built by lib/guardianCatView.ts alone, never the team's cat view. A cat
// outside her colonies, or in none, is answered with the public view, not a
// refusal (spec §2.2: she sees "exactly what the public sees"). The door is
// requireTeam with no capability: anyone who may enter; the check is here.

const ID_RE = /^\d{1,9}$/;
const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";

/** GET /api/team/my/colonies/:id: one of her colonies, every cat in it at its exact first position. */
router.get("/team/my/colonies/:id", requireTeam(), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const person = teamPerson(res);
  const raw = String(req.params["id"]);
  const colonyId = ID_RE.test(raw) ? Number(raw) : null;
  // Another colony, or none at all, answer the same: not found (nothing
  // about whether it exists).
  const notFound = () => {
    if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
    res.status(404).type("html").send(renderGuardianNotFound(person, "colony"));
  };
  if (colonyId === null || !can(person, "view_exact_location", { colonyId })) return notFound();
  const [colony] = await db
    .select({ id: coloniesTable.id, name: coloniesTable.name })
    .from(coloniesTable)
    .where(eq(coloniesTable.id, colonyId));
  if (!colony) return notFound();

  // The cats in it now (the one membership rule), leaving out any cat merged
  // into another: that cat now lives on as the one it was merged into.
  const inColony = await catsInColony(colonyId);
  const canonical = await canonicalCats(inColony);
  const ids = inColony.filter((id) => canonical.get(id) === id);
  const cats = (await guardianCats(ids, new Map(ids.map((id) => [id, colonyId])))).sort(
    (a, b) => a.name.localeCompare(b.name, "el") || a.id - b.id,
  );
  // Her colony's sites: SYC-209's one filter, narrowed to this colony (SYC-416).
  const sites = await sitesForPerson(person, [colonyId]);
  if (wantsJson(req)) return void res.json({ colony, cats, sites });
  res.type("html").send(renderGuardianColonyPage({ who: person, colony, cats, sites }));
});

/**
 * GET /api/team/my/cats/:id: one cat. In one of her colonies: her view, in
 * full. Anywhere else, or in no colony: the public view, field for field the
 * `cat` of GET /api/cats/:id. Nothing in the request but the cat's id counts.
 */
router.get("/team/my/cats/:id", requireTeam(), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const person = teamPerson(res);
  const raw = String(req.params["id"]);
  const notFound = () => {
    if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
    res.status(404).type("html").send(renderGuardianNotFound(person, "cat"));
  };
  if (!ID_RE.test(raw)) return notFound();
  const catId = Number(raw);
  const { target, canonicalId } = await catTargetWithCanonical(catId);
  if (
    canonicalId !== null &&
    typeof target.colonyId === "number" &&
    can(person, "view_exact_location", target)
  ) {
    const cat = await guardianCatView(canonicalId, target.colonyId);
    if (!cat) return notFound();
    // The cat's colony's sites: SYC-209's one filter, narrowed to it (SYC-416).
    const sites = await sitesForPerson(person, [target.colonyId]);
    // Her OWN statements on this cat (PR 2.2): what she may put back, and
    // where Syros Cats looked again. Nobody else's statements, ever.
    const mine = await myStatementsOnCat(person.id, canonicalId);
    if (wantsJson(req)) return void res.json({ view: "guardian", cat, sites, mine });
    const saved = typeof req.query["saved"] === "string" ? req.query["saved"] : null;
    return void res
      .type("html")
      .send(renderGuardianCatPage(person, cat, sites, undefined, { mine, saved }));
  }
  const cat = await publicCatView(catId);
  if (!cat) return notFound();
  if (wantsJson(req)) return void res.json({ view: "public", cat });
  res.type("html").send(renderPublicCatForGuardian(person, cat));
});

// ── SYC-53 PR 2.2: what she says about a cat (spec §2.2, §7.2, Q3) ──────────
//
// The door is requireTeam with no capability and the dashboard's Origin
// (formRoute); `set_sterilisation` / `set_life_status` are checked inside,
// for the cat's colony READ FROM THE RECORD under a lock
// (lib/guardianStatements.ts). Only the cat's id and her answer are read from
// the request: a date, role or scope sent along is ignored (Decision G, T23).

const SterilisedBody = z.object({
  sterilised: z.union([z.enum(["yes", "no"]), z.boolean()]),
});

const LifeBody = z.union([
  z.object({
    putBack: z.union([z.number().int().positive(), z.string().regex(/^\d{1,9}$/)]),
  }),
  z.object({
    status: z.enum(GUARDIAN_LIFE_STATUSES),
    reason: z.string().trim().min(1).max(200),
  }),
]);

/** What a refusal from her statement routes looks like, page or JSON. */
function refusedStatement(req: Request, res: Response, err: unknown, catId: number): void {
  if (!(err instanceof ObservationRefused)) throw err;
  const person = teamPerson(res);
  req.log.info({ reason: err.code }, "guardian statement refused");
  if (err.code === "NOT_AUTHORISED") return refuseSignedIn(req, res);
  if (err.code === "NOT_FOUND") {
    if (!wantsPage(req)) return void res.status(404).json({ error: "Not found" });
    return void res.status(404).type("html").send(renderGuardianNotFound(person, "cat"));
  }
  const conflict = err.code === "NOT_YOUR_ROW" || err.code === "ALREADY_SUPERSEDED";
  const status = conflict ? 409 : 400;
  if (!wantsPage(req)) return void res.status(status).json({ error: conflict ? "not_yours_to_put_back" : "refused" });
  res
    .status(status)
    .type("html")
    .send(renderGuardianProblem(person, conflict ? "gcat.problem.notYours" : "gcat.problem.choose", catId));
}

function badBody(req: Request, res: Response, catId: number, key: "gcat.problem.choose" | "gcat.problem.reason"): void {
  if (!wantsPage(req)) return void res.status(400).json({ error: "Invalid request" });
  res.status(400).type("html").send(renderGuardianProblem(teamPerson(res), key, catId));
}

/** POST /api/team/my/cats/:id/sterilisation: "she is sterilised" or "she isn't". */
router.post("/team/my/cats/:id/sterilisation", ...formRoute(), async (req: Request, res: Response) => {
  const raw = String(req.params["id"]);
  if (!ID_RE.test(raw)) return void res.status(404).json({ error: "Not found" });
  const catId = Number(raw);
  const parsed = SterilisedBody.safeParse(req.body ?? {});
  if (!parsed.success) return badBody(req, res, catId, "gcat.problem.choose");
  const sterilised = parsed.data.sterilised === true || parsed.data.sterilised === "yes";
  try {
    const row = await guardianSaysSterilised(teamPerson(res), catId, sterilised);
    if (!wantsPage(req)) return void res.status(201).json({ statementId: row.id });
    res.redirect(303, `${myCatPath(catId)}?saved=sterilised`);
  } catch (err) {
    refusedStatement(req, res, err, catId);
  }
});

/**
 * POST /api/team/my/cats/:id/life-status: homed, in care or has died, with a
 * short reason; or `putBack`, the id of her own change to undo (30 days).
 */
router.post("/team/my/cats/:id/life-status", ...formRoute(), async (req: Request, res: Response) => {
  const raw = String(req.params["id"]);
  if (!ID_RE.test(raw)) return void res.status(404).json({ error: "Not found" });
  const catId = Number(raw);
  const parsed = LifeBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    const missingReason = typeof req.body?.status === "string" && !String(req.body?.reason ?? "").trim();
    return badBody(req, res, catId, missingReason ? "gcat.problem.reason" : "gcat.problem.choose");
  }
  try {
    const person = teamPerson(res);
    const row =
      "putBack" in parsed.data
        ? await guardianPutsBack(person, catId, Number(parsed.data.putBack))
        : await guardianSaysLifeStatus(person, catId, parsed.data.status, parsed.data.reason);
    if (!wantsPage(req)) return void res.status(201).json({ statementId: row.id });
    res.redirect(303, `${myCatPath(catId)}?saved=${"putBack" in parsed.data ? "putBack" : "life"}`);
  } catch (err) {
    refusedStatement(req, res, err, catId);
  }
});

/** GET /api/team/my/stop-helping: the second page, "are you sure?". Changes nothing. */
router.get("/team/my/stop-helping", requireTeam(undefined, OWN), (_req: Request, res: Response) => {
  setTeamHeaders(res);
  const p = teamPerson(res);
  res.type("html").send(renderStopHelpingConfirm({ name: p.name, language: p.language }));
});

const wantsPage = (req: Request) => isBrowserNavigation(req) || Boolean(req.is("application/x-www-form-urlencoded"));

/** POST /api/team/my/language: saves people.language; the page then follows what is live. */
router.post("/team/my/language", ...formRoute(undefined, OWN), async (req: Request, res: Response) => {
  const person = teamPerson(res);
  const asked = typeof req.body?.language === "string" ? req.body.language : "";
  if (!["en", "el", "fr"].includes(asked)) {
    req.log.info({ reason: "bad_language" }, "language change refused");
    if (!wantsPage(req)) return void res.status(400).json({ error: "not_a_language" });
    return void res.status(400).type("html").send(renderMyPage({ person: await aboutMe(person), problem: "my.language.bad" }));
  }
  await setOwnLanguage(person.id, asked);
  if (!wantsPage(req)) return void res.json({ ok: true });
  res.redirect(303, `${MY_PAGE_PATH}?saved=language`);
});

/**
 * POST /api/team/my/sign-out-everywhere: yourself, through PR 1.1's function
 * (the other managers are told; the last manager is refused, plainly).
 */
router.post("/team/my/sign-out-everywhere", ...formRoute(undefined, OWN), async (req: Request, res: Response) => {
  const person = teamPerson(res);
  try {
    await signOutEverywhere(person, person.id);
  } catch (err) {
    if (!(err instanceof ActionRefused)) throw err;
    req.log.info({ reason: err.reason }, "sign out everywhere refused");
    const lastManager = err.message === LAST_MANAGER;
    if (!wantsPage(req)) return void res.status(409).json({ error: lastManager ? "last_manager" : "refused" });
    return void res
      .status(409)
      .type("html")
      .send(renderMyPage({ person: await aboutMe(person), problem: lastManager ? "my.signOut.lastManager" : "my.problem.generic" }));
  }
  // Her cookie is already dead (the version rose); clear it as well.
  clearSession(res);
  clearInviteSession(res);
  if (wantsPage(req)) return void res.redirect(303, SIGN_IN_PAGE);
  res.status(204).end();
});

/**
 * POST /api/team/my/stop-helping: recorded as `left` by `self` (§9.1). Not
 * management's "mark as left": that route refuses yourself. The last manager
 * is refused with a plain explanation and nothing changes. Pressing it twice
 * is harmless: the second finds her already gone and says so.
 */
router.post("/team/my/stop-helping", ...formRoute(undefined, OWN), async (req: Request, res: Response) => {
  const person = teamPerson(res);
  const forPage = { name: person.name, language: person.language };
  try {
    await stopHelping(person);
  } catch (err) {
    if (!(err instanceof ActionRefused)) throw err;
    if (err.message === LAST_MANAGER) {
      req.log.info({ reason: "last_manager" }, "stop helping refused");
      if (!wantsPage(req)) return void res.status(409).json({ error: "last_manager" });
      return void res.status(409).type("html").send(renderStopHelpingConfirm(forPage, undefined, true));
    }
    // Already gone (a second press at the same moment): nothing more to do.
    if (await findPersonById(person.id)) {
      req.log.info({ reason: "refused" }, "stop helping refused");
      if (!wantsPage(req)) return void res.status(409).json({ error: "refused" });
      return void res.status(409).type("html").send(renderMyProblem(forPage, "my.problem.generic"));
    }
  }
  req.log.info("stopped helping");
  clearSession(res);
  clearInviteSession(res);
  if (!wantsPage(req)) return void res.json({ ok: true });
  res.type("html").send(renderStoppedPage(person.language));
});

export default router;
