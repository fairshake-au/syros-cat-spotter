import { Router, type IRouter } from "express";
import { findAllowedPerson, normaliseEmail } from "@workspace/db";
import { requireInternalAuth } from "../lib/internalAuth";

// POST /api/internal/people/allowed (team-access spec §2.7; SYC-43 part 1
// plan §4, Decisions 1 and 2). The sign-in Worker asks "is this address on
// the list?" before it sends a sign-in link. Server-to-server only: no CORS
// headers (app.ts skips /api/internal/), and only the Worker's bearer token.
//
// The address travels in the body, never the URL, and is never logged.

const router: IRouter = Router();

const MAX_EMAIL_LENGTH = 320;

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
