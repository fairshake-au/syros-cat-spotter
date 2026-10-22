import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  findInvitee,
  findPersonById,
  type Invitee,
  type PersonWithScopes,
} from "@workspace/db";
import { readInviteSession, readSession } from "../lib/teamAuth/session";
import {
  GUARDIAN_HOME_PATH,
  isBrowserNavigation,
  refuseNotSignedIn,
  setTeamHeaders,
} from "../lib/teamAuth/refuse";
import { TEAM_HOME, TEAM_ORIGIN } from "../lib/teamAuth/config";
import { can } from "../lib/capabilities";
import { renderClosedPage } from "../lib/teamPages/welcomePage";

// SYC-53 PR 1.1 (roles-and-invites.md §4.1, §10.1; plan review minor 7): the
// gate for the accept page and nothing else. It reads ONLY the invitee's
// cookie (`__Host-cs_invite`, kind `invite`), looks her up again with
// findInvitee (Invited, unexpired, by the database's clock) and compares
// the session version, on every request. requireTeam never reads that
// cookie, and findInvitee never returns placements, so an invitee's session
// reaches no capability route and her placements never reach can().
//
// What anyone else gets, so a second press "changes nothing and says so":
// - a valid TEAM session for someone who has joined (she pressed Yes, join
//   already; the accept response gave her that session): a 303 to her home.
//   Nothing is read from it but where home is.
// - an invite cookie we signed whose person is no longer Invited at that
//   session version (accepted, declined, withdrawn, expired): the fixed
//   "This invitation is no longer open. Nothing was changed." page (JSON
//   409). It says nothing about why.
// - anything else: the usual sign-in 401.

/** The invitee, set by requireInvitee. */
export function invitee(res: Response): Invitee {
  const found = res.locals["invitee"] as Invitee | undefined;
  if (!found) throw new Error("invitee() used on a route without requireInvitee");
  return found;
}

/** Where a joined person lands (team: Home; placed roles only: her page). */
export function homeFor(person: PersonWithScopes): string {
  return can(person, "view_welfare_queue") ? TEAM_HOME : `${TEAM_ORIGIN}${GUARDIAN_HOME_PATH}`;
}

type Context =
  | { kind: "invitee"; invitee: Invitee }
  | { kind: "joined"; person: PersonWithScopes }
  | { kind: "closed" }
  | { kind: "none" };

async function contextOf(req: Request): Promise<Context> {
  const now = Math.floor(Date.now() / 1000);
  const pending = readInviteSession(req, now);
  if (pending) {
    const found = await findInvitee(pending.pid);
    if (found && found.sessionVersion === pending.sv) return { kind: "invitee", invitee: found };
  }
  const team = readSession(req, now);
  if (team) {
    const person = await findPersonById(team.pid);
    if (person && person.sessionVersion === team.sv) return { kind: "joined", person };
  }
  return pending ? { kind: "closed" } : { kind: "none" };
}

/** Sends the "no longer open" answer: a page for a browser, 409 JSON otherwise. */
export function sendClosed(req: Request, res: Response): void {
  setTeamHeaders(res);
  if (isBrowserNavigation(req)) {
    res.status(200).type("html").send(renderClosedPage());
    return;
  }
  res.status(409).json({ error: "invitation_closed" });
}

export function requireInvitee(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = await contextOf(req);
      switch (ctx.kind) {
        case "invitee":
          res.locals["invitee"] = ctx.invitee;
          next();
          return;
        case "joined":
          req.log.info({ reason: "already_joined" }, "accept page: nothing to do");
          setTeamHeaders(res);
          res.redirect(303, homeFor(ctx.person));
          return;
        case "closed":
          req.log.info({ reason: "invitation_closed" }, "accept page refused");
          sendClosed(req, res);
          return;
        case "none":
          req.log.info({ reason: "no_valid_invite_session" }, "accept page refused");
          refuseNotSignedIn(req, res);
          return;
      }
    } catch (err) {
      next(err);
    }
  };
}
