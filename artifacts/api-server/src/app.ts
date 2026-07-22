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
          url: req.url?.split("?")[0],
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
app.use(cors());
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
  req.log?.error({ err }, "Unhandled route error");
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

app.use(jsonErrorHandler);

export default app;
