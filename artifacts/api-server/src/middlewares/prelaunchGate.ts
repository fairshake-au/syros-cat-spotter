import type { NextFunction, Request, Response } from "express";
import {
  COAT_SWEEP_PATH,
  FINGERPRINT_NIGHTLY_PATH,
  MAIL_DRAIN_PATH,
  NEWS_LAST_RUN_PATH,
  NEWS_NIGHTLY_PATH,
  checkFingerprintJobToken,
  checkMailDrainToken,
  checkNewsJobToken,
} from "../lib/internalAuth";
import { RESEND_WEBHOOK_PATH } from "../lib/mail/resendWebhook";
import {
  gateEnabled,
  matchInternalToken,
  matchTesterKey,
  sessionKeys,
  testerKeys,
  verifySession,
} from "../lib/prelaunch";

/**
 * SYC-113: the API's pre-launch pass.
 * Plan: docs/superpowers/plans/syc-113-pre-launch-gates.md, item 2.
 *
 * Mounted in app.ts after pino-http and the CORS switch (so preflights are
 * answered and refusals stay readable) and BEFORE express.json (so a request
 * without a pass is refused before a 25 MB body is parsed).
 *
 * In order:
 * 1. Gate off → next().
 * 2. GET or HEAD on exactly /api/healthz → next() (Replit's start-up check).
 *    GET or HEAD on exactly /api/go/feed → next() (SYC-36, match-wait plan
 *    Decision 3, Samuel, 15 Oct 2026): "Help feed a cat" opens the phone's
 *    own browser, which carries no pass. The route only ever forwards to the
 *    one https donation page in the switches, so opening it reveals nothing.
 *    GET or HEAD on exactly /api/go/give → next() (SYC-120, help-and-info
 *    spec §3.7): the Help & info page's "Give" link, the same kind of route
 *    for the same reason, and it counts nothing.
 *    Matched on the raw path exactly, so no other spelling gets through.
 * 3. Exactly POST /api/internal/mail/drain, or exactly POST
 *    /api/internal/coat/sweep (SYC-161, Decision D1) → only `Authorization:
 *    Bearer <MAIL_DRAIN_TOKEN>` (SYC-42: the scheduled drain's own narrow
 *    token).
 *    Exactly POST /api/internal/news/nightly, or exactly GET or HEAD
 *    /api/internal/news/last-run (SYC-45 Slice 1) → only `Authorization:
 *    Bearer <NEWS_JOB_TOKEN>`, the nightly news check's own token.
 *    Exactly POST /api/internal/fingerprints/nightly (SYC-527 piece 3) → only
 *    `Authorization: Bearer <FINGERPRINT_JOB_TOKEN>`, the looks-like batch's
 *    own token.
 *    Any other /api/internal/* → only `Authorization: Bearer
 *    <INTERNAL_PEOPLE_TOKEN>`. Neither token opens the other's paths.
 *    Exactly POST /api/internal/resend/webhook → next(): Resend can't send
 *    a token, and the route refuses anything without Resend's signature
 *    (SYC-42 Slice 3). No token opens it, and it opens nothing else.
 * 4. /api/team/* → next() (Decision 1, Samuel, 29 Sep 2026: its own staff
 *    sign-in is the stronger door). /api/mail/* → next() (SYC-3 Decision 5:
 *    the keep-safe confirm and forget pages, each protected by its own
 *    one-time token; a parent confirming an address may not be a tester).
 * 5. Anything else → a valid website cookie OR a matching X-Prelaunch-Key.
 * 6. No pass → 401 prelaunch_pass_required.
 *
 * The key is only ever read from a header, never the query string.
 */

const REFUSAL = {
  error: "prelaunch_pass_required",
  message: "Cat Spotters isn't open yet.",
} as const;

function refuse(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(401).json(REFUSAL);
}

/**
 * The path as Express will route it, for classifying only.
 *
 * Express matches routes case-insensitively, so `/API/internal` reaches the
 * internal routes: the gate must not compare case-sensitively (plan, item 2
 * step 3, review note S4). The path is percent-decoded, lower-cased and has
 * repeated slashes collapsed, so `/API/Internal/…`, `/api/%69nternal/…` and
 * `/api//internal/…` are all treated as internal. Returns null when the
 * percent-encoding is malformed.
 */
export function normalisePath(rawPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, "/");
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function prelaunchGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!gateEnabled()) {
    next();
    return;
  }

  const rawPath = (req.originalUrl || req.url || "/").split("?")[0] ?? "/";

  // Exactly this path and these methods. Nothing else is open.
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (rawPath === "/api/healthz" ||
      rawPath === "/api/go/feed" ||
      rawPath === "/api/go/give")
  ) {
    next();
    return;
  }

  const path = normalisePath(rawPath);
  if (path === null) {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ error: "Bad request" });
    return;
  }

  if ((path === MAIL_DRAIN_PATH || path === COAT_SWEEP_PATH) && req.method === "POST") {
    // Not configured → the same refusal as a wrong token (fails closed; the
    // route itself says not_configured when the gate is off).
    if (checkMailDrainToken(req.headers.authorization) === "ok") {
      next();
      return;
    }
    refuse(res);
    return;
  }

  if (
    (path === NEWS_NIGHTLY_PATH && req.method === "POST") ||
    (path === NEWS_LAST_RUN_PATH && (req.method === "GET" || req.method === "HEAD"))
  ) {
    // SYC-45 Slice 1: the nightly news check's own token, and only it.
    if (checkNewsJobToken(req.headers.authorization) === "ok") {
      next();
      return;
    }
    refuse(res);
    return;
  }

  if (path === FINGERPRINT_NIGHTLY_PATH && req.method === "POST") {
    // SYC-527 piece 3: the looks-like batch's own token, and only it.
    if (checkFingerprintJobToken(req.headers.authorization) === "ok") {
      next();
      return;
    }
    refuse(res);
    return;
  }

  if (path === RESEND_WEBHOOK_PATH && req.method === "POST") {
    next();
    return;
  }

  if (isUnder(path, "/api/internal")) {
    const result = matchInternalToken(req.headers.authorization);
    if (result === "not_configured") {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: "not_configured" });
      return;
    }
    if (result === "ok") {
      next();
      return;
    }
    refuse(res);
    return;
  }

  if (isUnder(path, "/api/team") || isUnder(path, "/api/mail")) {
    next();
    return;
  }

  const keys = sessionKeys();
  const testers = testerKeys();
  if (!keys.length || !testers.length) {
    // Gate on but a secret it needs is missing: fail closed.
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({ error: "prelaunch_not_configured" });
    return;
  }

  const header = req.headers["x-prelaunch-key"];
  const suppliedKey = typeof header === "string" ? header : undefined;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    verifySession(keys, req.headers.cookie, nowSeconds) ||
    matchTesterKey(testers, suppliedKey)
  ) {
    next();
    return;
  }

  refuse(res);
}
