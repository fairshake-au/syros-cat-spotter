import { Router, type IRouter, type Request, type Response } from "express";
import { markLooksRight } from "../lib/matchesToCheck";
import { MATCHES_PATH } from "../lib/teamPages/matchesToCheckPage";
import { teamPerson } from "../middlewares/requireTeam";
import { formRoute } from "./teamCorrections";

// SYC-795: "Looks right" on the Matches to check list (the list itself is in
// teamHome.ts, with the other check lists). `move_sighting`, island-only.

const router: IRouter = Router();

const NUMBER = /^\d{1,9}$/;

/** POST /api/team/matches-to-check/:sightingId/looks-right: writes the match record's team step once, then back to the list. */
router.post("/team/matches-to-check/:sightingId/looks-right", ...formRoute("move_sighting"), async (req: Request, res: Response) => {
  const raw = String(req.params["sightingId"]);
  if (!NUMBER.test(raw)) return void res.status(404).type("text").send("Not found");
  await markLooksRight(teamPerson(res), Number(raw));
  res.redirect(303, MATCHES_PATH);
});

export default router;
