import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { consume, declareLimit, sharedLimiter } from "../lib/limits";
import { safeError } from "../lib/logger";
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
import { isCodeShaped, isTokenShaped, tokenLogId } from "../lib/keepSafe/tokens";
import { exchangeCode } from "../lib/keepSafe/code";

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

/** The one refusal for a code, whatever the real reason (spec §4). */
export const CODE_NOT_VALID = { error: "code_not_valid" } as const;

/** Ten codes an hour from one phone, for any addresses (spec §4). */
export const TOO_MANY_TRIES = { error: "too_many_tries" } as const;

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

// SYC-664: every /restore/code answer waits for one fixed deadline, so a phone
// with live rows answers no faster or slower than one without.
let codePadMs = 800;
// The per-phone cap's real limit is what the bucket is registered with; a
// test may raise only the point at which this route refuses (the 20-at-once
// test needs only the row's own limit to stop it).
const CODE_BUCKET = "keep_safe_code";
const CODE_LIMIT = 10;
const CODE_WINDOW_MS = 60 * 60 * 1000;
declareLimit(CODE_BUCKET, CODE_LIMIT, CODE_WINDOW_MS);
let codeCap = CODE_LIMIT;

/** Tests only: the /restore/code deadline pad. */
export function __setCodePadForTest(ms: number | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  codePadMs = ms ?? 800;
}

/** Tests only: how many codes an hour one phone may send before 429. */
export function __setCodeCapForTest(n: number | null): void {
  if (process.env["NODE_ENV"] !== "test") throw new Error("test only");
  codeCap = n ?? CODE_LIMIT;
}

async function padTo(started: number, ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - started))));
}

// Plan step 6: 30 per IP per hour, each. A courtesy cap: the token itself is
// the security (one use, 15 minutes, 256 random bits, never in a server log).
// Counted in Postgres (SYC-105 PR 2.1), one bucket each; fails closed (503).
const linkLimiter = (bucket: string) =>
  sharedLimiter({
    bucket,
    windowMs: 60 * 60 * 1000,
    limit: 30,
    message: LINK_NOT_VALID,
  });
const peekLimiter = linkLimiter("keep_safe_peek");
const redeemLimiter = linkLimiter("keep_safe_redeem");
// SYC-664: a per-network cap in front of /restore/code, on top of the
// per-phone hour counted inside the handler (which needs the verified phone,
// so it can't be a middleware). Sixty an hour: a whole family on one
// connection never gets near it, and it trims what one network can guess.
// It depends only on the network, so it says nothing about any address.
const codeNetworkLimiter = sharedLimiter({
  bucket: "keep_safe_code_ip",
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: TOO_MANY_TRIES,
});

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
  res.json({
    spotters: result.spotters,
    openedOnAskingPhone: result.openedOnAskingPhone,
    alreadyHere: result.alreadyHere,
  });
});

/** The picker's opaque choice (Decision 12, review finding 9); a device id is still accepted from an older page. */
function pickOf(body: Record<string, unknown>) {
  return {
    choice: typeof body["choice"] === "string" ? body["choice"] : undefined,
    spotterDeviceId: typeof body["spotterDeviceId"] === "string" ? body["spotterDeviceId"] : undefined,
  };
}

function secretOf(req: Request): string {
  const header = req.headers["x-device-secret"];
  return typeof header === "string" ? header : "";
}

/**
 * The same phone's retry of a move that already happened (its starter id is
 * retired by then), answered BEFORE the network's redeem allowance (SYC-664
 * ship review F1): a phone finishing its own move is never told 429. Only the
 * phone whose secret the moved spotter now holds gets an answer here; anything
 * else goes on to the limiter and the ordinary checks.
 *
 * `replayOnly: true` (SYC-664 ship review N-1): the app's background finishing
 * (start-up, back online) only ever wants this answer. Without a move behind
 * it, it gets the one refusal and nothing moves: a stale keep/delete choice is
 * never carried out without the person there.
 */
async function samePhoneReplay(req: Request, res: Response, next: NextFunction): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body["token"];
  const pick = pickOf(body);
  const secret = secretOf(req);
  if (isTokenShaped(raw) && secret.length >= 16 && secret.length <= 256 && (pick.choice || pick.spotterDeviceId)) {
    const replay = await replayAfterMove({ raw, callerSecretHash: hashSecret(secret), pick });
    if (replay?.ok) {
      noStore(res);
      res.json({ deviceId: replay.deviceId, username: replay.username });
      return;
    }
  }
  if (body["replayOnly"] === true) {
    noStore(res);
    return refuseLink(req, res, "replay_only_no_move", raw);
  }
  next();
}

router.post("/restore/redeem", samePhoneReplay, redeemLimiter, async (req, res) => {
  noStore(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body["token"];
  const pick = pickOf(body);
  const secret = secretOf(req);
  const caller = await verifyDeviceSecret(req, res, String(body["deviceId"] ?? ""));
  if (!caller) return;
  if (!isTokenShaped(raw)) return refuseLink(req, res, "malformed", raw);
  const result = await redeemRestore({
    raw,
    callerDeviceId: caller,
    callerSecretHash: hashSecret(secret),
    pick,
    abandonCurrent: body["abandonCurrent"] === true,
    deleteCurrent: body["deleteCurrent"] === true,
    ipHash: ipFingerprint(req.ip ?? "unknown"),
  });
  if (!result.ok) return refuseLink(req, res, result.reason, raw);
  req.log.info({ token: tokenLogId(raw) }, "restore: spotter moved to the phone that pressed the button");
  res.json({ deviceId: result.deviceId, username: result.username });
});

/**
 * Swap a code for a handle (SYC-664). The device secret first (its own
 * answers, about the phone, not the address), then one from the phone's hour
 * (after auth, so nobody can spend another phone's hour with only its id),
 * then the code. Every answer from here on (200, 401, 429, 503) waits for the
 * same deadline. Neither the code nor the handle is ever logged.
 */
router.post("/restore/code", codeNetworkLimiter, async (req, res) => {
  const started = Date.now();
  noStore(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const caller = await verifyDeviceSecret(req, res, String(body["deviceId"] ?? ""));
  if (!caller) return;

  let status: number;
  let reply: object;
  try {
    if (!fingerprintConfigured()) {
      [status, reply] = [503, { error: "not_configured" }];
    } else {
      // Fails closed: if the counter throws, the catch below answers 503.
      const hour = await consume(CODE_BUCKET, caller, CODE_LIMIT, CODE_WINDOW_MS);
      if (hour.hits > codeCap) {
        req.log.warn({ hits: hour.hits }, "restore code: phone over its hourly cap");
        [status, reply] = [429, TOO_MANY_TRIES];
      } else {
        const code = body["code"];
        // Malformed codes still spent one of the hour's tries above, so the
        // shape can't be probed for free. The app strips spaces before sending.
        const result = isCodeShaped(code) ? await exchangeCode({ callerDeviceId: caller, code }) : null;
        if (result?.ok) {
          req.log.info({ token: result.tokenLogId }, "restore code accepted: handle issued");
          [status, reply] = [200, { handle: result.handle }];
        } else {
          req.log.warn(
            result ? { reason: "no_match", live: result.live, attempts: result.attempts } : { reason: "malformed" },
            "restore code refused",
          );
          [status, reply] = [401, CODE_NOT_VALID];
        }
      }
    }
  } catch (err) {
    req.log.error({ err: safeError(err) }, "restore code failed");
    res.setHeader("Retry-After", "5");
    [status, reply] = [503, { error: "Please try again in a moment." }];
  }

  const waited = Date.now() - started;
  if (waited > codePadMs) {
    req.log.warn({ waitedMs: waited, padMs: codePadMs }, "restore code outran its deadline pad");
  }
  await new Promise((r) => setTimeout(r, Math.max(0, codePadMs - waited)));
  res.status(status).json(reply);
});

export default router;
