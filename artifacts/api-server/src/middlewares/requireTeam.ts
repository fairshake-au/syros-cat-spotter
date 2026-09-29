import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findPersonById, type PersonWithScopes } from "@workspace/db";
import { readSession } from "../lib/teamAuth/session";
import { refuseNotSignedIn } from "../lib/teamAuth/refuse";

// Runs on every dashboard request (team-access spec §8.2). It checks the
// session cookie, looks the person up in `people` again, and compares
// session_version, so removal and "sign out everywhere" take effect at the
// next request. Any failure gets the same 401 as the hand-off.
//
// Every /api/team/* route except the hand-off must use this. A dashboard
// route that doesn't is a review failure.

/** The signed-in person, set by requireTeam. */
export function teamPerson(res: Response): PersonWithScopes {
  const person = res.locals["teamPerson"] as PersonWithScopes | undefined;
  if (!person)
    throw new Error("teamPerson() used on a route without requireTeam");
  return person;
}

export function requireTeam(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = readSession(req, Math.floor(Date.now() / 1000));
      if (!session) {
        req.log.info({ reason: "no_valid_session" }, "team request refused");
        refuseNotSignedIn(req, res);
        return;
      }
      const person = await findPersonById(session.pid);
      if (!person) {
        req.log.info({ reason: "not_on_list" }, "team request refused");
        refuseNotSignedIn(req, res);
        return;
      }
      if (person.sessionVersion !== session.sv) {
        req.log.info(
          { reason: "stale_session_version" },
          "team request refused",
        );
        refuseNotSignedIn(req, res);
        return;
      }
      res.locals["teamPerson"] = person;
      next();
    } catch (err) {
      next(err);
    }
  };
}
