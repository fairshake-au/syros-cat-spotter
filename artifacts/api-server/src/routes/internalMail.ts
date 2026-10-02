import { Router, type IRouter } from "express";
import { checkMailDrainToken } from "../lib/internalAuth";
import { drainDue, overdueWelfareAlerts, OVERDUE_MINUTES } from "../lib/mail/outbox";

/**
 * POST /api/internal/mail/drain (SYC-42 plan, Slice 1 item 1.6, layer 3).
 *
 * Called every 10 minutes by .github/workflows/mail-drain.yml with
 * MAIL_DRAIN_TOKEN. Sends what's due, then answers non-2xx if any welfare
 * alert has been unsent for over an hour, so the scheduled run fails and
 * GitHub emails Samuel. That's a delivery path independent of Resend, and it
 * pages nobody (F1): it is about the system being broken, not about a cat.
 *
 * The token is checked here as well as in the pre-launch gate, so it still
 * holds after the gate is switched off at launch.
 */
const router: IRouter = Router();

router.post("/internal/mail/drain", async (req, res) => {
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
  const result = await drainDue(25);
  const overdue = await overdueWelfareAlerts();
  if (overdue > 0) {
    req.log.error(
      { overdue, ...result },
      `mail drain: ${overdue} welfare alert(s) unsent for over ${OVERDUE_MINUTES} minutes`,
    );
    res.status(500).json({ error: "welfare_alert_overdue", overdue, ...result });
    return;
  }
  res.status(200).json({ overdue: 0, ...result });
});

export default router;
