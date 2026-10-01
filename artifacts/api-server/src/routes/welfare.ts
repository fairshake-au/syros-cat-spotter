import { Router, type IRouter } from "express";
import {
  getGuidance,
  isGuidanceLanguage,
} from "@workspace/welfare-guidance";

/**
 * SYC-42 plan, Slice 0 item 0.3: the injured-cat advice, the vet list and the
 * Municipality's number, served from the one settings file (Decision 6).
 *
 * Behind the pre-launch gate like the rest of /api. `Cache-Control: no-cache`
 * plus a strong ETag: the app always revalidates, and an unchanged file costs
 * a 304. The app keeps the last version it downloaded and falls back to the
 * copy built into it, so the advice shows with no signal.
 */
const router: IRouter = Router();

router.get("/welfare/guidance", (req, res) => {
  const requested = req.query["lang"];
  const language = isGuidanceLanguage(requested) ? requested : "en";
  const guidance = getGuidance(language);
  const etag = `"${guidance.version}-${language}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Vary", "Accept-Encoding");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.json(guidance);
});

export default router;
