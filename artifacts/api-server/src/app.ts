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
import { prelaunchGate } from "./middlewares/prelaunchGate";
import { opportunisticDrain } from "./lib/mail/outbox";

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
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

// SYC-42 item 1.6, layer 2: after any API response, check for due mail.
app.use("/api", opportunisticDrain);
app.use("/api", router);

// JSON 404 for any unmatched /api route: without this, requests fall through
// to Express's default HTML 404 page, which the mobile app can't distinguish
// from a real server failure.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// JSON error handler: log full details server-side, but never leak stack
// traces, SQL, or other internals to clients (Express default is an HTML
// page containing the full stack trace).
export function jsonErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    err.name === "ZodError" &&
    "issues" in err &&
    Array.isArray(err.issues)
  ) {
    res.status(400).json({ error: "Invalid request", issues: err.issues });
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
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

app.use(jsonErrorHandler);

export default app;
