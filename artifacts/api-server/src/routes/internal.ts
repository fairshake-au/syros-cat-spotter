import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { findAllowedPerson, normaliseEmail } from "@workspace/db";
import { checkInternalToken } from "../lib/internalAuth";

// POST /api/internal/people/allowed (team-access spec §2.7; SYC-43 part 1
// plan §4, Decisions 1 and 2). The sign-in Worker asks "is this address on
// the list?" before it sends a sign-in link. Server-to-server only: no CORS
// headers (app.ts skips /api/internal/), and only the Worker's bearer token.
//
// The address travels in the body, never the URL, and is never logged.

const router: IRouter = Router();

const MAX_EMAIL_LENGTH = 320;

/**
 * Only the Worker's bearer token: 503 {"error":"not_configured"} when the
 * server has none (whatever was sent), 401 when it's wrong or missing. The
 * SYC-113 gate checks the same helper first; this route checks again itself.
 */
function requireInternalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const result = checkInternalToken(req.headers.authorization);
  if (result === "ok") {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (result === "not_configured") {
    res.status(503).json({ error: "not_configured" });
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

router.post(
  "/internal/people/allowed",
  requireInternalAuth,
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const raw: unknown = req.body?.email;
    if (typeof raw !== "string" || raw.length > MAX_EMAIL_LENGTH) {
      req.log.info({ outcome: "invalid_request" }, "people allowed check");
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const person = await findAllowedPerson(normaliseEmail(raw));
    if (!person) {
      req.log.info({ outcome: "not_allowed" }, "people allowed check");
      res.json({ allowed: false });
      return;
    }
    req.log.info({ outcome: "allowed" }, "people allowed check");
    res.json({
      allowed: true,
      personId: person.id,
      name: person.name,
      sessionVersion: person.sessionVersion,
    });
  },
);

export default router;
