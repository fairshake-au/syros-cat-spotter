import { Router, type IRouter, type Request, type Response } from "express";
import {
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
    team: person.scopes.some((s) => s.role === "staff" || s.role === "management"),
    management: person.scopes.some((s) => s.role === "management"),
    placements: await myColonies(person.id),
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
  const me = await aboutMe(teamPerson(res));
  res.type("html").send(renderMyColoniesPage({ person: me }));
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
