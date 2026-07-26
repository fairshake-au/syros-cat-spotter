import { Router, type IRouter } from "express";
import { getCampaign } from "../lib/campaign";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/campaign", (_req, res) => {
  try {
    res.json(getCampaign());
  } catch (err) {
    // `getCampaign` refuses to serve a malformed number rather than rendering a
    // typo as a plausible figure. That's the right call, but it must not become
    // an unhandled 500: answer with a code the client already knows how to show
    // as "couldn't load the campaign", and make the real cause loud in the log.
    logger.error({ err }, "campaign config is invalid; serving 503");
    res.status(503).json({ error: "Campaign unavailable", code: "campaign_misconfigured" });
  }
});

export default router;
