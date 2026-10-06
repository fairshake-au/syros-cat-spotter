import { Router, type IRouter, type Request, type Response } from "express";
import { searchTeamCats, teamCatView } from "../lib/teamCatView";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import {
  renderCatPage,
  renderCatSearchPage,
  renderNoSuchCat,
} from "../lib/teamPages/catPages";

// The staff dashboard's "Cats" screens (SYC-43 part 2 plan, PR 3). Read-only.
// Both show exact positions, so both need view_exact_location. A browser gets
// the page; a caller asking for JSON (Accept: application/json) gets the same
// data as JSON. Neither ever goes through the public cat serialiser.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";

/** GET /api/team/cats?q=: find a cat by name (folded) or SYR number. */
router.get(
  "/team/cats",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res); // before any await, so an error answer carries them too
    // Only a single string is a query; ?q=a&q=b or ?q[x]=1 is no query.
    const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
    const results = await searchTeamCats(q);
    if (wantsJson(req)) return void res.json({ query: q, results });
    res.type("html").send(renderCatSearchPage(q, results, person.name));
  },
);

const CAT_ID_RE = /^\d{1,9}$/;

/** GET /api/team/cats/:id: the team's page for one cat. */
router.get(
  "/team/cats/:id",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    const view = CAT_ID_RE.test(raw) ? await teamCatView(Number(raw)) : null;
    if (!view) {
      if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchCat(person.name));
    }
    if (wantsJson(req)) return void res.json(view);
    res.type("html").send(renderCatPage(view, person.name));
  },
);

export default router;
