import { isIslandWide, visibleColonyIds } from "../lib/guardianView";
import { Router, type IRouter, type Request, type Response } from "express";
import { searchTeamCats, teamCatView } from "../lib/teamCatView";
import { getQueueReport } from "../lib/welfareQueue";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { can } from "../lib/capabilities";
import { allColonyChoices } from "../lib/colonyCats";
import { renderCatPage, renderNoSuchCat } from "../lib/teamPages/catPages";
import { renderCatGridPage, withoutDefaultLives } from "../lib/teamPages/catGridPage";
import { parseCatFilters } from "../lib/teamCatFilters";
import { LIVES, listTeamCats } from "../lib/teamCatList";

// The staff dashboard's "Cats" screens (SYC-43 part 2 plan, PR 3). Read-only;
// the correction forms on the cat page post to routes/teamCorrections.ts (PR 4).
// Both show exact positions, so both need view_exact_location. A browser gets
// the page; a caller asking for JSON (Accept: application/json) gets the same
// data as JSON. Neither ever goes through the public cat serialiser.

const router: IRouter = Router();

const wantsJson = (req: Request) => req.accepts(["html", "json"]) === "json";

const TIE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/team/cats: every cat as a filterable photo grid (SYC-396 PR 1.3).
 * `?q=` still finds by name or SYR number, and `?tie=` still chooses a cat for
 * a welfare report. A caller asking for JSON gets the old search answer.
 */
router.get(
  "/team/cats",
  requireTeam("view_exact_location"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    // The strict header first, before any await, so any answer that isn't
    // the finished grid page (JSON, a 500 from an error below) carries it.
    // A refusal from requireTeam went out with the strict one before this.
    setTeamHeaders(res);
    if (wantsJson(req)) {
      // Only a single string is a query; ?q=a&q=b or ?q[x]=1 is no query.
      const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
      return void res.json({ query: q, results: await searchTeamCats(q) });
    }
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
    const filters = withoutDefaultLives(parseCatFilters(req.query), Boolean(tie));
    // Choosing a cat for a report: everyone is in, so a cat already tied always shows.
    const forList = tie && !filters.lives ? { ...filters, lives: [...LIVES] } : filters;
    const started = Date.now();
    const now = new Date();
    const { items, total, catCount } = await listTeamCats(forList, now);
    // Spec §9.6: each page records how long it took. Counts only, no names.
    req.log.info({ ms: Date.now() - started, shown: items.length, total }, "team cats list");
    const html = renderCatGridPage({
      items,
      total,
      catCount,
      filters,
      personName: person.name,
      tie,
      now,
      colonies: await allColonyChoices(visibleColonyIds(person)),
    });
    // Only now, with the page built and nothing left to fail: the grid page
    // is the one page that loads our own script (dashboard-grid.js), so it
    // alone gets the wider header (test/wideCsp.ts WIDE_CSP_ROUTES).
    setTeamHeaders(res, { scripts: true });
    res.type("html").send(html);
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
      renderCatPage(view, person.name, {
        may: (c) => can(person, c),
        done,
        at,
        photo,
        colonies: can(person, "assign_cat_to_colony")
          ? await allColonyChoices(visibleColonyIds(person))
          : undefined,
        allHistory: req.query["history"] === "all",
        island: isIslandWide(person),
      }),
    );
  },
);

export default router;
