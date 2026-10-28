import { Router, type IRouter } from "express";
import { checkFingerprintJobToken } from "../lib/internalAuth";
import { runDuplicateSweep } from "../lib/duplicateSweep";
import { safeError } from "../lib/logger";

/**
 * SYC-59 PR 5.3 (which-cat-is-which.md §3.1 item 3, §9.6, D11): the nightly
 * look-alike sweep's one door. It takes the fingerprint job's token
 * (FINGERPRINT_JOB_TOKEN, lib/internalAuth.ts) because it runs right after
 * that job's batch in .github/workflows/fingerprints-nightly.yml, on the
 * fingerprints it just made; no new secret.
 *
 * - POST /api/internal/duplicates/sweep: with the app switch
 *   `duplicate_sweep` off (the default) it does nothing and answers
 *   200 {ran:false}. On, it writes at most 10 `sweep` reports and answers
 *   200 {ran:true, cats, candidates, written}, all COUNTS; never an id. Any
 *   failure is a 500.
 *
 * The token is checked here as well as in the pre-launch gate. Logs carry
 * counts and ms only.
 */
const router: IRouter = Router();

router.post("/internal/duplicates/sweep", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const auth = checkFingerprintJobToken(req.headers.authorization);
  if (auth === "not_configured") {
    res.status(503).json({ error: "not_configured" });
    return;
  }
  if (auth !== "ok") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const startedAt = Date.now();
  try {
    const outcome = await runDuplicateSweep();
    req.log.info({ ...outcome, ms: Date.now() - startedAt }, "duplicate sweep: finished");
    res.status(200).json(outcome);
  } catch (err) {
    req.log.error({ err: safeError(err), ms: Date.now() - startedAt }, "duplicate sweep: failed");
    res.status(500).json({ error: "duplicate_sweep_failed" });
  }
});

export default router;
