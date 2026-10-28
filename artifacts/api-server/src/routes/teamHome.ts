import { Router, type IRouter, type Request, type Response } from "express";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { homeData } from "../lib/dashboard/home";
import { renderHomePage } from "../lib/teamPages/homePage";
import { visibleColonyIds } from "../lib/guardianView";
import { newCatsAfterFailedCheck } from "../lib/matcherHealth";
import { renderNewCatsPage } from "../lib/teamPages/newCatsPage";
import { nearbyCatsOf } from "../lib/newCatsNearby";
import { can } from "../lib/capabilities";
import { listDuplicates } from "../lib/duplicateList";

// Home: the first page after signing in (SYC-396 spec §4; plan PR 2.1).
// `view_welfare_queue`, island-only: it shows the whole island's reports, so
// a cat guardian gets the 403. The Queue keeps GET /api/team.

const router: IRouter = Router();

router.get(
  "/team/home",
  requireTeam("view_welfare_queue"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res); // before any await, so an error answer carries them too
    const started = Date.now();
    const now = new Date();
    const data = await homeData(now, {}, visibleColonyIds(person));
    // Every figure is worked out on each request; each page records how long it took (§9.6).
    req.log.info({ ms: Date.now() - started }, "home figures worked out");
    // SYC-59 PR 5.1: the Possible duplicates count, for those who may open the list. A failed count hides the tile, not Home.
    const duplicates = can(person, "review_duplicates") ? await listDuplicates(now).then((l) => l.length, () => 0) : 0;
    res.type("html").send(
      renderHomePage(data, { personName: person.name, now, costs: can(person, "view_vet_costs"), duplicates,
        batches: can(person, "log_vet_visit") && can(person, "view_vet_costs") && can(person, "find_cat_from_photo"),
      }),
    );
  },
);

// SYC-531: cats named "new" after the look-alike check failed. Same door as Home.
router.get(
  "/team/new-cats-to-check",
  requireTeam("view_welfare_queue"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res);
    const cats = await newCatsAfterFailedCheck();
    if (req.accepts(["html", "json"]) === "json") return void res.json({ cats });
    const nearby = await nearbyCatsOf(cats.map((c) => c.catId));
    res.type("html").send(renderNewCatsPage(cats, person.name, nearby));
  },
);

export default router;
