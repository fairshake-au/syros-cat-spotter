import { Router, type IRouter, type Request, type Response } from "express";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { renderSettingsPage } from "../lib/teamPages/settingsPage";

// Settings (SYC-694): the list of Areas, Vet settings and App switches.
// `view_welfare_queue`, island-only like Home and each of the three, so a cat
// guardian gets the 403. The page only links: each one checks its own capability.

const router: IRouter = Router();

router.get("/team/settings", requireTeam("view_welfare_queue"), (_req: Request, res: Response) => {
  setTeamHeaders(res);
  res.type("html").send(renderSettingsPage({ personName: teamPerson(res).name }));
});

export default router;
