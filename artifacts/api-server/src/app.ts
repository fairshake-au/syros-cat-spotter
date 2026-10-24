import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger, redactRequestUrl, safeError } from "./lib/logger";
import { apiCors } from "./middlewares/apiCors";
import { NUL_IN_BODY, NUL_MESSAGE, refuseNul } from "./middlewares/refuseNul";
import { isPoolTimeout } from "./lib/poolTimeout";
import { prelaunchGate } from "./middlewares/prelaunchGate";
import { RESEND_WEBHOOK_PATH } from "./lib/mail/resendWebhook";
import { opportunisticDrain } from "./lib/mail/outbox";
import { opportunisticRoundUp } from "./lib/sightingRoundUp";
import { opportunisticHeldTypingTidy } from "./lib/teamAuth/heldTyping";
import { setTeamHeaders } from "./lib/teamAuth/refuse";
import { isTeamPath, preferredLanguage, renderTeamErrorPage, wantsTeamPage } from "./lib/teamPages/errorPage";

const app: Express = express();

// Replit's production chain puts the visitor exactly 4 hops from the
// server: measured on the live deployment on 3 Oct 2026 (SYC-100,
// proxy-probe run 37091945054, client_pos_from_right=4 on all three
// probes, including one with a spoofed X-Forwarded-For). Trusting exactly
// those 4 hops makes req.ip the real visitor for per-IP rate limiting, while
// anything a client prepends to X-Forwarded-For stays untrusted. The
// measurement method (a token-gated diagnostic on /api/healthz) was removed
// under SYC-187 once it had done its job; it's preserved as a historical
// note in docs/runbooks/proxy-probe.md and can be restored from PRs #57/#60
// if Replit's proxy chain changes and this needs re-measuring.
app.set("trust proxy", 4);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Device ids in the path are swapped for a placeholder (SYC-109).
          url: redactRequestUrl(req.url),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// SYC-106: every public route answers cross-origin only to the origins in
// apiCors's allow-list (first written for the photo route, SYC-65).
app.use((req, res, next) => {
  // SYC-43 part 1: no CORS headers at all on the staff dashboard (same-origin,
  // team-access spec §2.6) or the Worker's server-to-server routes (§2.7).
  // Lower-cased because Express matches routes case-insensitively.
  const path = req.path.toLowerCase();
  if (
    path === "/api/team" ||
    path.startsWith("/api/team/") ||
    path === "/api/internal" ||
    path.startsWith("/api/internal/")
  ) {
    // SYC-396 PR 1.3.4 (review 4): every dashboard answer is read only as
    // the type it says it is, including ones that never reach a route
    // (an unmatched path's 404, an error before the route). setTeamHeaders
    // sets it too.
    if (path === "/api/team" || path.startsWith("/api/team/")) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
    next();
    return;
  }
  apiCors(req, res, next);
});
// SYC-113 pre-launch pass (docs/superpowers/plans/syc-113-pre-launch-gates.md,
// item 2). Its place is load-bearing:
// - AFTER the CORS switch, so an allowed origin's preflight is answered by apiCors
//   before the gate (preflights never carry cookies or custom headers), and
//   the gate's 401 still carries CORS headers a caller's code can read;
// - BEFORE express.json, so a request without a pass is refused before a
//   25 MB body is parsed.
app.use(prelaunchGate);
// SYC-42 Slice 3: Resend's webhook is signed over the exact bytes it sent,
// so that one path gets the raw body (lib/mail/resendWebhook.ts).
app.use(RESEND_WEBHOOK_PATH, express.raw({ type: "*/*", limit: "256kb" }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
// SYC-406: a NUL character anywhere in the body (or query) is a 400 here,
// before any route hands it to Postgres, which would answer 500.
app.use(refuseNul);

// SYC-42 item 1.6, layer 2: after any API response, check for due mail.
app.use("/api", opportunisticDrain);
// data-spine.md PR 9: the evening sighting round-up's second trigger.
app.use("/api", opportunisticRoundUp);
// SYC-516 C3: kept typing older than 30 minutes, at most once a minute.
app.use("/api", opportunisticHeldTypingTidy);
app.use("/api", router);

// JSON 404 for any unmatched /api route: without this, requests fall through
// to Express's default HTML 404 page, which the mobile app can't distinguish
// from a real server failure.
app.use("/api", (req: Request, res: Response) => {
  // SYC-516 C1 (closes SYC-339): an unmatched dashboard path carries the
  // dashboard's headers, and a browser gets a friendly page. The page never
  // reads the session (spec decision 516-A). A data caller keeps the JSON.
  if (isTeamPath(req)) {
    setTeamHeaders(res);
    if (wantsTeamPage(req)) {
      res
        .status(404)
        .type("html")
        .send(renderTeamErrorPage("not_found", { afterSave: false, lang: preferredLanguage(req) }));
      return;
    }
  }
  res.status(404).json({ error: "Not found" });
});

/**
 * Under /api/team: the dashboard's headers on the answer, and for a browser
 * the friendly page (true = sent). A data caller falls through to its JSON.
 */
function sendTeamErrorPage(
  req: Request,
  res: Response,
  status: number,
  kind: "broken" | "bad_request",
): boolean {
  if (!isTeamPath(req)) return false;
  setTeamHeaders(res);
  if (!wantsTeamPage(req)) return false;
  res
    .status(status)
    .type("html")
    .send(renderTeamErrorPage(kind, { afterSave: req.method === "POST", lang: preferredLanguage(req) }));
  return true;
}

// JSON error handler: log full details server-side, but never leak stack
// traces, SQL, or other internals to clients (Express default is an HTML
// page containing the full stack trace).
export function jsonErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // SYC-415 spec §6.4: body-parser's own "too large" error. A 500 would make
  // the phone retry a spot that can never fit; 413 tells it to remove a photo.
  if (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    err.type === "entity.too.large"
  ) {
    // Sizes and path only, never any body content.
    const sizes = err as { limit?: unknown; length?: unknown };
    req.log?.warn(
      { limit: sizes.limit, length: sizes.length, path: req.path },
      "request body too large",
    );
    res.setHeader("Cache-Control", "no-store");
    if (sendTeamErrorPage(req, res, 413, "bad_request")) return;
    // Every route's body parser can say "too large"; only a spot gets the
    // "remove a photo" advice.
    const isSpot = req.method === "POST" && req.path === "/api/sightings";
    res.status(413).json({
      error: isSpot
        ? "This spot is too large to send. Remove a photo and try again."
        : "This request is too large.",
    });
    return;
  }
  if (typeof err === "object" && err !== null && "type" in err && err.type === NUL_IN_BODY) {
    // Never log the body: path only.
    req.log?.warn({ path: req.path }, "request body contains a NUL character");
    res.setHeader("Cache-Control", "no-store");
    if (sendTeamErrorPage(req, res, 400, "bad_request")) return;
    res.status(400).json({ error: NUL_MESSAGE });
    return;
  }
  // SYC-407: the pool could not hand out a connection within its limit
  // (lib/db POOL_CONNECTION_TIMEOUT_MS). Log it, and tell the caller to retry
  // rather than leave it hanging or answer a generic 500.
  if (isPoolTimeout(err)) {
    req.log?.error({ err: safeError(err) }, "database pool: no connection available in time");
    if (!res.headersSent) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "5");
      if (sendTeamErrorPage(req, res, 503, "broken")) return;
      res.status(503).json({ error: "We're busy right now. Please try again in a moment." });
      return;
    }
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    err.name === "ZodError" &&
    "issues" in err &&
    Array.isArray(err.issues)
  ) {
    if (sendTeamErrorPage(req, res, 400, "bad_request")) return;
    res.status(400).json({ error: "Invalid request", issues: err.issues });
    return;
  }
  // A garbled body (body-parser's own parse failure) under the dashboard is a
  // 400 page for a browser; anything else keeps the 500 it always got.
  if (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    err.type === "entity.parse.failed" &&
    sendTeamErrorPage(req, res, 400, "bad_request")
  ) {
    return;
  }
  // Name and codes only: a database error's message carries the query's
  // params, which can be a note, coordinates, a device id or photo bytes
  // (SYC-42 review S1). Applies to every route.
  req.log?.error({ err: safeError(err) }, "Unhandled route error");
  if (res.headersSent) {
    res.end();
    return;
  }
  // An error answer is never cached. The dashboard's routes set this
  // themselves, but an error before them (a path Express can't decode, such
  // as a map picture address /api/team/map-tiles/17%zz) would go without.
  res.setHeader("Cache-Control", "no-store");
  if (sendTeamErrorPage(req, res, 500, "broken")) return;
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

app.use(jsonErrorHandler);

export default app;
