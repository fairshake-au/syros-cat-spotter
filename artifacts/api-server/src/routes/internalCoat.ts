import { Router, type IRouter } from "express";
import { z } from "zod";
import { checkMailDrainToken } from "../lib/internalAuth";
import { MAX_SWEEP_LIMIT, sweepCoatReadings } from "../lib/coatReading/sweep";
import { safeError } from "../lib/logger";

/**
 * POST /api/internal/coat/sweep (SYC-161 plan, PR 1; Decision D1).
 *
 * The manual colour run: `{ mode, limit, exclude, reread }`, where `mode` is
 * `dry_run` (the default; no model call, no write), `trial` (calls the model,
 * writes nothing) or `write`. `limit` is at most 50; `exclude` lists cat ids
 * not to write; `reread` (default false) also reads cats last read by an
 * older reader version, behind SYC-398 §7's guards. Started by hand from
 * .github/workflows/coat-readings.yml.
 *
 * Opened by MAIL_DRAIN_TOKEN (Decision D1: no new secret). The token is
 * checked here as well as in the pre-launch gate, so it still holds after the
 * gate is switched off at launch. A leaked token can at worst bring forward
 * readings that are due anyway, capped by the hourly budget: a photo is read
 * at most once per reader version (R4, as SYC-398 §7 amends it), and each
 * new version takes a PR and a publish.
 *
 * Nothing in this PR calls the sweep automatically (that is PR 2).
 */
const router: IRouter = Router();

const Body = z
  .object({
    mode: z.enum(["dry_run", "trial", "write"]).default("dry_run"),
    limit: z.number().int().min(1).max(MAX_SWEEP_LIMIT).default(MAX_SWEEP_LIMIT),
    exclude: z.array(z.number().int().positive()).max(500).default([]),
    // SYC-398 §7: the one checked re-read, off unless asked for. A real
    // boolean only: "true" as a string is refused, never read as yes.
    reread: z.boolean().default(false),
  })
  .strict();

router.post("/internal/coat/sweep", async (req, res) => {
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
  const parsed = Body.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues.map((i) => i.message) });
    return;
  }
  try {
    res.status(200).json(await sweepCoatReadings(parsed.data));
  } catch (err) {
    req.log.error({ err: safeError(err) }, "coat sweep failed");
    res.status(500).json({ error: "sweep_failed" });
  }
});

export default router;
