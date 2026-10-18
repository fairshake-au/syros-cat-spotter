import { Router, type IRouter, type Request, type Response } from "express";
import { checkNewsJobToken } from "../lib/internalAuth";
import { lastNewsRun, runNightlyNewsCheck } from "../lib/news/nightly";
import { safeError } from "../lib/logger";

/**
 * SYC-45 Slice 1 (syc-344-email-capture.md, PR 1.1): the nightly news
 * check's two doors, each with NEWS_JOB_TOKEN only (lib/internalAuth.ts).
 *
 * - POST /api/internal/news/nightly: called each night by the mail-drain-cron
 *   Worker's second cron, with .github/workflows/news-nightly.yml as the
 *   daily backup. 200 with the night's counts; 200 {already: true} if
 *   tonight (the Athens date) has finished; 200 {busy: true} if another
 *   caller is running it now. Any failure is a 500, which the Worker turns
 *   into an alarm. `silencedBulk: true` means more than 50 news changes were
 *   found and all were silenced: the Worker alarms on that too (plan C14).
 * - GET /api/internal/news/last-run: the newest finished night, for the
 *   Worker's "no finished run in 36 hours" alarm.
 *
 * The token is checked here as well as in the pre-launch gate, so it still
 * holds after the gate is switched off at launch. It is never logged.
 */
const router: IRouter = Router();

function authorised(req: Request, res: Response): boolean {
  res.setHeader("Cache-Control", "no-store");
  const auth = checkNewsJobToken(req.headers.authorization);
  if (auth === "ok") return true;
  if (auth === "not_configured") res.status(503).json({ error: "not_configured" });
  else res.status(401).json({ error: "unauthorized" });
  return false;
}

router.post("/internal/news/nightly", async (req, res) => {
  if (!authorised(req, res)) return;
  try {
    const result = await runNightlyNewsCheck();
    if (result.status === "already") {
      res.status(200).json({ already: true, night: result.night });
      return;
    }
    if (result.status === "busy") {
      res.status(200).json({ busy: true, night: result.night });
      return;
    }
    const { status: _status, ...counts } = result;
    if (counts.silencedBulk) {
      req.log.error(counts, "news check: more than 50 news changes tonight, all silenced");
    } else {
      req.log.info(counts, "news check: finished");
    }
    res.status(200).json(counts);
  } catch (err) {
    req.log.error({ err: safeError(err) }, "news check: failed");
    res.status(500).json({ error: "news_check_failed" });
  }
});

router.get("/internal/news/last-run", async (req, res) => {
  if (!authorised(req, res)) return;
  const run = await lastNewsRun();
  res.status(200).json({
    lastRun: run
      ? {
          night: run.athensDate,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt.toISOString(),
          catsWalked: run.catsWalked,
          changesFound: run.changesFound,
          silencedBulk: run.silencedBulk,
        }
      : null,
  });
});

export default router;
