import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { photoCors } from "./middlewares/photoCors";
import { prelaunchGate } from "./middlewares/prelaunchGate";

const app: Express = express();

// Exactly one proxy (Replit's) sits in front of the server; trust it so
// req.ip reflects the real client for per-IP rate limiting, without letting
// clients spoof arbitrary X-Forwarded-For chains.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // The URL contains a private device id on profile routes. Strip
          // query strings (including availability names) and path identifiers.
          url: req.url?.split("?")[0].replace(
            /\/profiles\/(?!username-availability(?:\/|$)|username-suggestions(?:\/|$))[^/]+/,
            "/profiles/:deviceId",
          ),
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
// hosting-and-photo-storage.md §6.2 item 3: the photo route gets an
// explicit origin allowlist instead of the bare, wide-open cors() every
// other route still uses. Scoped narrowly (not a blanket app-wide change)
// so nothing else's CORS behaviour shifts in this PR.
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
  if (req.path.startsWith("/api/photos/")) {
    photoCors(req, res, next);
    return;
  }
  cors()(req, res, next);
});
// SYC-113 pre-launch pass (docs/superpowers/plans/syc-113-pre-launch-gates.md,
// item 2). Its place is load-bearing:
// - AFTER the CORS switch, so a browser's preflight is answered by cors()
//   before the gate (preflights never carry cookies or custom headers), and
//   the gate's 401 still carries CORS headers a caller's code can read;
// - BEFORE express.json, so a request without a pass is refused before a
//   25 MB body is parsed.
app.use(prelaunchGate);
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

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
  req.log?.error({ err }, "Unhandled route error");
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

app.use(jsonErrorHandler);

export default app;
