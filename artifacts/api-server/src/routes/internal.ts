import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { findAllowedPerson, findInviteeByEmail, normaliseEmail } from "@workspace/db";
import { checkInternalToken } from "../lib/internalAuth";
import { mayEnter, mayUseWorkspace } from "../lib/capabilities";

// POST /api/internal/people/allowed (team-access spec §2.7; SYC-43 part 1
// plan §4, Decisions 1 and 2). The sign-in Worker asks "is this address on
// the list?" before it sends a sign-in link. Server-to-server only: no CORS
// headers (app.ts skips /api/internal/), and only the Worker's bearer token.
//
// The address travels in the body, never the URL, and is never logged.
//
// "On the list" means in the table, not marked as left, joined (not merely
// invited), AND holding a door (decided by can(); SYC-188, SYC-222).
//
// Two doors, two request shapes (roles spec §4.5, §6.3, §14 cases 11 and
// 13; SYC-53 plan PR 0.4):
//
// - The old shape (no `version`) is what the Worker deployed today sends.
//   That Worker gives the workspace to everyone it hears `allowed: true`
//   for, so the old shape says yes ONLY to someone who holds the workspace
//   door (mayUseWorkspace). A cat guardian gets no; she can't sign in until
//   the new Worker ships, which fails safe.
// - `version: 2` gets both doors: `{ allowed, doors: { workspace, dashboard
//   }, language, personId, name, sessionVersion }`. The Worker issues a
//   workspace session only when `doors.workspace` is true.
//
// Every "no" is one fixed body per shape, whatever the reason (unknown,
// left, not yet joined, no door), so the answer can't be used to learn who
// is on the list.

const router: IRouter = Router();

const MAX_EMAIL_LENGTH = 320;

/** The only request version besides the old shape (which has none). */
const DOORS_VERSION = 2;

/** The one "no" for each shape, sent byte for byte the same every time. */
const NO_OLD_SHAPE = Object.freeze({ allowed: false });
const NO_DOORS = Object.freeze({
  allowed: false,
  doors: Object.freeze({ workspace: false, dashboard: false }),
});

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
    // Own property only, so nothing on a prototype can turn an old-shape
    // request into a version-2 one (whose yes can mean the dashboard only).
    const version: unknown =
      req.body && Object.hasOwn(req.body, "version")
        ? req.body.version
        : undefined;
    if (
      typeof raw !== "string" ||
      raw.length > MAX_EMAIL_LENGTH ||
      (version !== undefined && version !== DOORS_VERSION)
    ) {
      req.log.info({ outcome: "invalid_request" }, "people allowed check");
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const person = await findAllowedPerson(normaliseEmail(raw));
    const doors = {
      workspace: person !== null && mayUseWorkspace(person),
      dashboard: person !== null && mayEnter(person),
    };

    if (version === undefined) {
      // The old shape: yes means the workspace, so only the workspace door.
      if (!person || !doors.workspace) {
        req.log.info(
          { outcome: "not_allowed", version: 1 },
          "people allowed check",
        );
        res.json(NO_OLD_SHAPE);
        return;
      }
      req.log.info({ outcome: "allowed", version: 1 }, "people allowed check");
      res.json({
        allowed: true,
        personId: person.id,
        name: person.name,
        sessionVersion: person.sessionVersion,
      });
      return;
    }

    if (!person) {
      // SYC-53 PR 1.1 (roles spec §4.5; plan review minor 6): someone invited
      // and not yet joined, Invited and unexpired by the database's clock,
      // gets the dashboard door only, so she can receive her sign-in link and
      // be handed to the accept page. Only in this shape: the old one says no
      // to her (above). Expired, withdrawn, not sent yet and anonymised all
      // get the one fixed "no" below.
      const invitee = await findInviteeByEmail(normaliseEmail(raw));
      if (invitee) {
        req.log.info(
          { outcome: "allowed", version: DOORS_VERSION, invitee: true },
          "people allowed check",
        );
        res.json({
          allowed: true,
          doors: { workspace: false, dashboard: true },
          language: invitee.language,
          personId: invitee.id,
          name: invitee.name,
          sessionVersion: invitee.sessionVersion,
        });
        return;
      }
    }
    if (!person || (!doors.workspace && !doors.dashboard)) {
      req.log.info(
        { outcome: "not_allowed", version: DOORS_VERSION },
        "people allowed check",
      );
      res.json(NO_DOORS);
      return;
    }
    req.log.info(
      { outcome: "allowed", version: DOORS_VERSION, doors },
      "people allowed check",
    );
    res.json({
      allowed: true,
      doors,
      language: person.language,
      personId: person.id,
      name: person.name,
      sessionVersion: person.sessionVersion,
    });
  },
);

export default router;
