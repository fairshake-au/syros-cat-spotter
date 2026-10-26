import { Router, type IRouter, type Request, type Response } from "express";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { renderWordsPage } from "../lib/teamPages/help";

// Words we use (SYC-739): the dashboard's words, each defined once. Linked
// from Home and from every "How this page works" fold. `view_welfare_queue`,
// island-only like Home, so a cat guardian gets the 403.

const router: IRouter = Router();

router.get("/team/words", requireTeam("view_welfare_queue"), (_req: Request, res: Response) => {
  setTeamHeaders(res);
  res.type("html").send(renderWordsPage({ personName: teamPerson(res).name }));
});

export default router;
