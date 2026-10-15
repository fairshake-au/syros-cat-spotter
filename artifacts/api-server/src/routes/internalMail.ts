import { Router, type IRouter } from "express";
import { checkMailDrainToken } from "../lib/internalAuth";
import { drainDue, overdueWelfareAlerts, sendIssueDigestIfDue, OVERDUE_MINUTES } from "../lib/mail/outbox";
import { sendDailyRoundUp, type RoundUpResult } from "../lib/sightingRoundUp";
import { sweepKeepSafeIfDue } from "../lib/keepSafe/sweep";
import { sweepRateLimitsIfDue } from "../lib/limits";
import { safeError } from "../lib/logger";

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
 *
 * The same call also sends the evening sighting round-up when it's due
 * (data-spine.md PR 9, `lib/sightingRoundUp.ts`), so it rides on this
 * schedule (and on any API request in the evening, `opportunisticRoundUp`)
 * rather than needing one of its own. It sends once per evening
 * whoever calls, so the token still can't make the server send anything
 * that wasn't already due. A round-up failure is logged and never changes
 * the status code: that stays about welfare alerts only.
 *
 * It also queues the daily "Issue reports: N waiting" digest when it is due
 * (SYC-44 PR 5.2, `sendIssueDigestIfDue`), once per Athens day.
 *
 * It also runs the keep-safe sweep (SYC-3, lib/keepSafe/sweep.ts), at most
 * hourly per server, and the rate-limit sweep (lib/limits.ts) on the same terms. A sweep failure is logged and never changes the status.
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
  // SYC-44 PR 5.2: queue the daily issues digest if it's due, so the drain
  // below sends it in this same call. A failure here is logged and never
  // changes the status.
  try {
    await sendIssueDigestIfDue();
  } catch (err) {
    req.log.error({ err: safeError(err) }, "issue digest: could not be queued");
  }
  const result = await drainDue(25);
  const overdue = await overdueWelfareAlerts();
  await sweepKeepSafeIfDue(req.log);
  await sweepRateLimitsIfDue(req.log);
  // After the welfare check, so a slow push service can't delay it.
  let roundUp: RoundUpResult | { status: "error" };
  try {
    roundUp = await sendDailyRoundUp();
  } catch (err) {
    req.log.error({ err: safeError(err) }, "sighting round-up failed");
    roundUp = { status: "error" };
  }
  if (overdue > 0) {
    req.log.error(
      { overdue, ...result },
      `mail drain: ${overdue} welfare alert(s) unsent for over ${OVERDUE_MINUTES} minutes`,
    );
    res.status(500).json({ error: "welfare_alert_overdue", overdue, ...result, roundUp: roundUp.status });
    return;
  }
  res.status(200).json({ overdue: 0, ...result, roundUp: roundUp.status });
});

export default router;
