import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { hashSecret, requireDeviceAuth, verifyDeviceSecret } from "../lib/deviceAuth";
import { fingerprintConfigured, ipFingerprint, looksLikeAddress } from "../lib/mail/fingerprint";
import { kickRow } from "../lib/mail/outbox";
import {
  addKeepSafeAddress,
  keepSafeState,
  removeKeepSafeAddress,
  requestRestore,
} from "../lib/keepSafe/service";
import { peekRestore, redeemRestore, replayAfterMove } from "../lib/keepSafe/move";
import { isTokenShaped, tokenLogId } from "../lib/keepSafe/tokens";

/**
 * "Keep my spots safe" and "Get your spots back" for the app (SYC-3 plan,
 * Slice 1 steps 3, 5 and 6). Every route proves the calling phone with its
 * device secret. All of them stay behind the pre-launch pass (Decision 5):
 * only the confirm and forget pages (mailPages.ts) sit outside it.
 *
 * No restore route accepts a username. Usernames are public, so one can never
 * restore anything (plan test 1).
 */

const router: IRouter = Router();

/** The one refusal for a link that can't be used, whatever the real reason. */
export const LINK_NOT_VALID = { error: "link_not_valid" } as const;

/** The one reply to a restore request, known address or not. */
export const SENT_IF_KNOWN = { status: "sent_if_known" } as const;

const SURFACES = new Set(["onboarding", "settings", "first_badge"]);
const LANGUAGES = new Set(["en", "el", "fr"]);
const WORDING = /^[a-z0-9._-]{1,40}$/;

let restorePadMs = 800;
// Adding an address does a little more work when the address is already
// confirmed somewhere (SYC-261), so its reply is padded too (review of #106,
// finding 3). The email itself goes after the reply.
let addPadMs = 300;

/** Tests only: the deadline pads (plan step 5; test 8 measures the real one). */
export function __setRestorePadForTest(ms: number | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  restorePadMs = ms ?? 800;
  addPadMs = ms ?? 300;
}

async function padTo(started: number, ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - started))));
}

// Plan step 6: 30 per IP per hour, each. A courtesy cap: the token itself is
// the security (one use, 15 minutes, bound to the asking phone).
const linkLimiter = () =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: LINK_NOT_VALID,
  });
const peekLimiter = linkLimiter();
const redeemLimiter = linkLimiter();

function notConfigured(res: Response): void {
  res.status(503).json({ error: "not_configured" });
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
}

/** After the reply has gone, send this outbox row straight away (R1). */
function sendAfterReply(res: Response, outboxId: number | null): void {
  if (outboxId === null) return;
  res.on("finish", () => kickRow(outboxId));
}

router.get("/keep-safe/:deviceId", async (req, res) => {
  noStore(res);
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  res.json(await keepSafeState(deviceId));
});

router.post("/keep-safe/:deviceId", async (req, res) => {
  const started = Date.now();
  noStore(res);
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  if (!fingerprintConfigured()) return notConfigured(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body["email"] === "string" ? body["email"] : "";
  const surface = typeof body["surface"] === "string" ? body["surface"] : "";
  const language = typeof body["language"] === "string" ? body["language"] : "";
  const wordingVersion = typeof body["wordingVersion"] === "string" ? body["wordingVersion"] : "";
  if (!looksLikeAddress(email)) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  if (!SURFACES.has(surface) || !LANGUAGES.has(language) || !WORDING.test(wordingVersion)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { state, outboxId } = await addKeepSafeAddress(
    { deviceId, email, surface, language, wordingVersion, ip: req.ip ?? "unknown" },
    req.log,
  );
  await padTo(started, addPadMs);
  sendAfterReply(res, outboxId);
  res.json(state);
});

router.delete("/keep-safe/:deviceId", async (req, res) => {
  noStore(res);
  const deviceId = await requireDeviceAuth(req, res);
  if (!deviceId) return;
  await removeKeepSafeAddress(deviceId);
  res.status(204).end();
});

/**
 * Ask for a restore link. Always `202 {"status":"sent_if_known"}`, padded to a
 * deadline so a known address takes no longer to answer than an unknown one,
 * and the email goes AFTER the reply.
 */
router.post("/restore/request", async (req, res) => {
  const started = Date.now();
  noStore(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const asking = await verifyDeviceSecret(req, res, String(body["deviceId"] ?? ""));
  if (!asking) return;
  const email = typeof body["email"] === "string" ? body["email"] : "";
  if (!looksLikeAddress(email)) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  if (!fingerprintConfigured()) return notConfigured(res);
  const outboxId = await requestRestore({ askingDeviceId: asking, email, ip: req.ip ?? "unknown" }, req.log);
  const waited = Date.now() - started;
  if (waited > restorePadMs) {
    // The pad only hides the difference if the slowest known path fits in it.
    req.log.warn({ waitedMs: waited, padMs: restorePadMs }, "restore request outran its deadline pad");
  }
  await new Promise((r) => setTimeout(r, Math.max(0, restorePadMs - waited)));
  sendAfterReply(res, outboxId);
  res.status(202).json(SENT_IF_KNOWN);
});

function refuseLink(req: Request, res: Response, reason: string, raw: unknown): void {
  req.log.warn(
    { reason, token: typeof raw === "string" && isTokenShaped(raw) ? tokenLogId(raw) : "malformed" },
    "restore link refused",
  );
  res.status(401).json(LINK_NOT_VALID);
}

router.post("/restore/peek", peekLimiter, async (req, res) => {
  noStore(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const caller = await verifyDeviceSecret(req, res, String(body["deviceId"] ?? ""));
  if (!caller) return;
  const raw = body["token"];
  if (!isTokenShaped(raw)) return refuseLink(req, res, "malformed", raw);
  const result = await peekRestore(raw, caller);
  if (!result.ok) return refuseLink(req, res, result.reason, raw);
  res.json({ spotters: result.spotters });
});

router.post("/restore/redeem", redeemLimiter, async (req, res) => {
  noStore(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body["token"];
  const spotterDeviceId = typeof body["spotterDeviceId"] === "string" ? body["spotterDeviceId"] : "";
  const header = req.headers["x-device-secret"];
  const secret = typeof header === "string" ? header : "";
  // The same phone's retry within 60 s (its starter id is retired by then).
  if (isTokenShaped(raw) && secret.length >= 16 && secret.length <= 256 && spotterDeviceId) {
    const replay = await replayAfterMove({
      raw,
      callerDeviceId: String(body["deviceId"] ?? ""),
      callerSecretHash: hashSecret(secret),
      spotterDeviceId,
    });
    if (replay?.ok) {
      res.json({ deviceId: replay.deviceId, username: replay.username });
      return;
    }
  }
  const caller = await verifyDeviceSecret(req, res, String(body["deviceId"] ?? ""));
  if (!caller) return;
  if (!isTokenShaped(raw)) return refuseLink(req, res, "malformed", raw);
  const result = await redeemRestore({
    raw,
    callerDeviceId: caller,
    callerSecretHash: hashSecret(secret),
    spotterDeviceId,
    abandonCurrent: body["abandonCurrent"] === true,
    deleteCurrent: body["deleteCurrent"] === true,
    ipHash: ipFingerprint(req.ip ?? "unknown"),
  });
  if (!result.ok) return refuseLink(req, res, result.reason, raw);
  req.log.info({ token: tokenLogId(raw) }, "restore: spotter moved to the phone that asked");
  res.json({ deviceId: result.deviceId, username: result.username });
});

export default router;
