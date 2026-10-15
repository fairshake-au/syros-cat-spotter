import { Router, type IRouter } from "express";
import { handleResendEvent, verifyResendSignature, type WebhookEvent } from "../lib/mail/resendWebhook";
import { safeError } from "../lib/logger";

/**
 * POST /api/internal/resend/webhook (SYC-42 plan, Slice 3 item 3.6).
 *
 * Resend can't carry our internal token, so the pre-launch gate lets exactly
 * this path through and the Svix signature is the door
 * (lib/mail/resendWebhook.ts). app.ts gives this path the raw body, because
 * the signature is over the exact bytes Resend sent.
 */
const router: IRouter = Router();

router.post("/internal/resend/webhook", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const check = verifyResendSignature(req.headers, raw);
  if (check === "not_configured") {
    req.log.error({ reason: check }, "resend webhook: RESEND_WEBHOOK_SECRET is not set; refused");
    res.status(503).json({ error: "not_configured" });
    return;
  }
  if (check !== "ok") {
    req.log.warn({ reason: check }, "resend webhook: refused");
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as WebhookEvent;
  } catch {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const outcome = await handleResendEvent(event);
    // The type and what was done; never an address.
    req.log.info({ type: typeof event.type === "string" ? event.type.slice(0, 40) : null, ...outcome }, "resend webhook");
    res.status(200).json({ ok: true });
  } catch (err) {
    req.log.error({ err: safeError(err) }, "resend webhook: failed; Resend will retry");
    res.status(500).json({ error: "try_again" });
  }
});

export default router;
