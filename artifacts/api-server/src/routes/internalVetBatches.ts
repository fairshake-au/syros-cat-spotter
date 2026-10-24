import { Router, type IRouter } from "express";
import { checkMailDrainToken } from "../lib/internalAuth";
import { safeError } from "../lib/logger";
import { removeStaleBatches } from "../lib/vetBatches";

/**
 * POST /api/internal/vet-batches/cleanup (SYC-677).
 *
 * Removes every unsaved vet visit batch untouched for 7 days, with its staged
 * photos (lib/vetBatches.ts removeStaleBatches). Opened by MAIL_DRAIN_TOKEN
 * like the coat sweep (no new secret): a leaked token can at worst remove
 * drafts that are due to go anyway. Checked here as well as in the pre-launch
 * gate, so it still holds after the gate is switched off. Answers and logs
 * counts only ({removed, failed}; 500 if any failed), never a batch, a person or a photo.
 */
const router: IRouter = Router();

router.post("/internal/vet-batches/cleanup", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const auth = checkMailDrainToken(req.headers.authorization);
  if (auth === "not_configured") {
    res.status(503).json({ error: "not_configured" });
    return;
  }
  if (auth !== "ok") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const { removed, failed } = await removeStaleBatches();
    req.log.info({ removed, failed }, "vet batch clean-up: finished");
    // A batch that could not be removed fails the run (500), so the workflow
    // fails and GitHub emails; the body is still counts only.
    res.status(failed > 0 ? 500 : 200).json({ removed, failed });
  } catch (err) {
    req.log.error({ err: safeError(err) }, "vet batch clean-up: failed");
    res.status(500).json({ error: "cleanup_failed" });
  }
});

export default router;
