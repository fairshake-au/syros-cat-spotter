import { Router, type IRouter } from "express";
import { getCampaign } from "../lib/campaign";

const router: IRouter = Router();

router.get("/campaign", (_req, res) => {
  res.json(getCampaign());
});

export default router;
