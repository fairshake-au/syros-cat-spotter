import { Router, type IRouter, type Request, type Response } from "express";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { homeData } from "../lib/dashboard/home";
import { renderHomePage } from "../lib/teamPages/homePage";
import { visibleColonyIds } from "../lib/guardianView";
import { can } from "../lib/capabilities";

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
    res.type("html").send(renderHomePage(data, { personName: person.name, now, costs: can(person, "view_vet_costs") }));
  },
);

export default router;
