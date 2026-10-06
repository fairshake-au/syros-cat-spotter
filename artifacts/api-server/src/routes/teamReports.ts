import { Router, type IRouter, type Request, type Response } from "express";
import { listWelfareQueue } from "../lib/welfareQueue";
import { setTeamHeaders } from "../lib/teamAuth/refuse";
import { requireTeam } from "../middlewares/requireTeam";

// The welfare queue's data and photos for the staff dashboard (SYC-43 part 2
// plan, PR 1). No CORS headers: app.ts skips /api/team/. Every route here
// uses requireTeam("view_exact_location"): it shows exact positions.

const router: IRouter = Router();

/** GET /api/team/reports: the queue as JSON (SYC-42 2.2); the page's data. */
router.get(
  "/team/reports",
  requireTeam("view_exact_location"),
  async (_req: Request, res: Response) => {
    setTeamHeaders(res); // before any await, so an error answer carries them too
    const queue = await listWelfareQueue();
    res.json(queue);
  },
);

export default router;
