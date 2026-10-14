import { Router, type IRouter, type Request, type Response } from "express";
import { searchTeamCats, teamCatView } from "../lib/teamCatView";
import { getQueueReport } from "../lib/welfareQueue";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { can } from "../lib/capabilities";
import {
  renderCatPage,
  renderCatSearchPage,
  renderNoSuchCat,
} from "../lib/teamPages/catPages";

// The staff dashboard's "Cats" screens (SYC-43 part 2 plan, PR 3). Read-only;
// the correction forms on the cat page post to routes/teamCorrections.ts (PR 4).
// Both show exact positions, so both need view_exact_location. A browser gets
// the page; a caller asking for JSON (Accept: application/json) gets the same
// data as JSON. Neither ever goes through the public cat serialiser.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";

const TIE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
    // ?tie=<publicId>: choosing a cat for that welfare report (PR 5). Only
    // a well-formed id is used; it is escaped wherever it is drawn.
    const tieId = typeof req.query["tie"] === "string" ? req.query["tie"] : "";
    const tie = TIE_ID_RE.test(tieId)
      ? {
          publicId: tieId,
          report: await getQueueReport(tieId),
          canTie: can(person, "change_report_state"),
        }
      : undefined;
    res.type("html").send(renderCatSearchPage(q, results, person.name, tie));
  },
);

const CAT_ID_RE = /^\d{1,9}$/;
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** GET /api/team/cats/:id: the team's page for one cat. */
router.get(
  "/team/cats/:id",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const raw = String(req.params["id"]);
    const view = CAT_ID_RE.test(raw) ? await teamCatView(Number(raw), new Date(), person) : null;
    if (!view) {
      if (wantsJson(req)) return void res.status(404).json({ error: "Not found" });
      return void res.status(404).type("html").send(renderNoSuchCat(person.name));
    }
    if (wantsJson(req)) return void res.json(view);
    // After a correction (PR 4) the form comes back here with ?done=<key>.
    // Only a fixed key is shown, never the query text itself.
    const done = typeof req.query["done"] === "string" ? req.query["done"] : undefined;
    const s = req.query["s"];
    const at = typeof s === "string" && CAT_ID_RE.test(s) ? Number(s) : undefined;
    // After Hide or Restore (PR 6): the photo the page lands on, by publicId.
    const p = req.query["p"];
    const photo = typeof p === "string" && PHOTO_ID_RE.test(p) ? p : undefined;
    res.type("html").send(
      renderCatPage(view, person.name, { may: (c) => can(person, c), done, at, photo }),
    );
  },
);

export default router;
