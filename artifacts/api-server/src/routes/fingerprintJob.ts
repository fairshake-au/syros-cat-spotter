import { Router, type IRouter } from "express";
import { checkFingerprintJobToken } from "../lib/internalAuth";
import { fillMissing } from "../lib/fingerprint";
import { catsToCompare, displayPhotoOf } from "../lib/findFromPhoto";
import { safeError } from "../lib/logger";

/**
 * SYC-527 piece 3 (spec docs/specs/find-from-a-photo-whole-island.md §7): the
 * nightly looks-like batch's one door, with FINGERPRINT_JOB_TOKEN only
 * (lib/internalAuth.ts). Called by .github/workflows/fingerprints-nightly.yml.
 *
 * - POST /api/internal/fingerprints/nightly: fingerprints every active cat's
 *   display photo that has none, oldest first, for at most FINGERPRINT_BUDGET_MS (90 s, so the request stays under the proxy chain in front of the app)
 *   (it starts no new photo after that). Answers once the work is done, like
 *   the news check does: 200 {made, failed, left}, all COUNTS; never a photo
 *   id. Any failure is a 500.
 *
 * "Every active cat's display photo" is the same set the team's search
 * compares (catsToCompare with no narrowing, then the one stand-in rule), so
 * a hidden main photo's stand-in is the one fingerprinted. The token is
 * checked here as well as in the pre-launch gate, so it still holds after the
 * gate is switched off. It is never logged. Logs carry counts and ms only.
 */
const router: IRouter = Router();

/** The batch's time budget. The workflow's curl timeout is this plus headroom. */
export const FINGERPRINT_BUDGET_MS = 90_000;

router.post("/internal/fingerprints/nightly", async (req, res) => {
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
    const cats = await catsToCompare({});
    const photoIds = [...(await displayPhotoOf(cats.map((c) => c.id))).values()];
    const { made, failed, left } = await fillMissing(photoIds, FINGERPRINT_BUDGET_MS);
    const counts = { made, failed, left: left.length };
    req.log.info({ ...counts, cats: cats.length, ms: Date.now() - startedAt }, "fingerprint batch: finished");
    res.status(200).json(counts);
  } catch (err) {
    req.log.error({ err: safeError(err), ms: Date.now() - startedAt }, "fingerprint batch: failed");
    res.status(500).json({ error: "fingerprint_batch_failed" });
  }
});

export default router;
