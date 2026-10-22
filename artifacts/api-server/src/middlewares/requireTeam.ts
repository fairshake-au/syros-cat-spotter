import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findPersonById, type PersonWithScopes } from "@workspace/db";
import { navContext } from "../lib/teamPages/layout";
import { readSession } from "../lib/teamAuth/session";
import {
  isBrowserNavigation,
  isFormPost,
  refuseAccessEnded,
  refuseForbidden,
  refuseNotSignedIn,
  refuseSignedOutSave,
} from "../lib/teamAuth/refuse";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import {
  can,
  doorFor,
  holdsIslandRow,
  mayUseWorkspace,
  type Capability,
  type CapabilityTarget,
} from "../lib/capabilities";

// Runs on every dashboard request (team-access spec §8.2). It checks the
// session cookie, looks the person up in `people` again, and compares
// session_version, so removal and "sign out everywhere" take effect at the
// next request.
//
// Two kinds of refusal (roles-and-invites.md §6.4; SYC-53 PR 0.5):
// - **Not signed in** (no valid session, not on the list, not yet joined,
//   left, or a stale session version): the same 401 as the hand-off, which
//   sends a browser to the sign-in page.
// - **Signed in, but not allowed**: a quiet 403 (a page for a browser,
//   `{"error":"forbidden"}` otherwise). A person who holds nothing at all any
//   more (every placement ended) gets the 403 that says her access has ended.
//
// Every /api/team/* route except the hand-off and sign-out must use this. A
// dashboard route that doesn't is a review failure, and the route walk
// (team.walk.test.ts) fails on any route it has no row for.

/** The signed-in person, set by requireTeam. */
export function teamPerson(res: Response): PersonWithScopes {
  const person = res.locals["teamPerson"] as PersonWithScopes | undefined;
  if (!person)
    throw new Error("teamPerson() used on a route without requireTeam");
  return person;
}

/**
 * A refusal from inside a route, after requireTeam let the person in (a
 * capability checked against the record, or a second check in a lib
 * function): the 403, never the sign-in 401.
 */
export function refuseSignedIn(req: Request, res: Response): void {
  const person = teamPerson(res);
  refuseForbidden(req, res, {
    name: person.name,
    island: holdsIslandRow(person),
    language: person.language,
    starting: doorFor(person) === "starting",
  });
}

/** Where a placed check applies, read from the record for this request. */
export type TargetResolver = (
  req: Request,
) => Promise<CapabilityTarget | CapabilityTarget[]>;

export interface RequireTeamOptions {
  /**
   * Where the capability is checked. Every target returned must pass (a
   * photo tied to two cats needs both cats' colonies). Without one, a
   * placed capability answers for island rows only, which is how every route
   * that shows the whole island stays closed to a cat guardian.
   */
  target?: TargetResolver;
  /**
   * Insist on an island row even for a role-wide or own-scope capability.
   * POST /team/colonies uses it: a guardian holds `create_colony`, but until
   * PR 1.1's createColonyWithPlacement places her on what she creates, the
   * team's route would make a colony she isn't placed on.
   */
  island?: true;
  /**
   * The person's own pages ("My page", PR 1.3): any accepted person, even one
   * who holds nothing any more (a placement that ended), who can still sign
   * out and stop helping (roles-and-invites.md §6.2 note 1). Skips the
   * "may enter" check and nothing else; no capability can be named with it.
   */
  own?: true;
  /**
   * Open to a cat guardian with no colony yet (SYC-439; first-colony spec
   * §4.3), who is refused everywhere else. ONLY on GET and POST
   * /team/colonies: a source test counts every use of this name outside
   * this file and fails the build on a third.
   */
  openToStarter?: true;
}

/**
 * With a capability, the person must also hold it, decided only by can()
 * (with the record's target, if the route names one). Without one (/me, and
 * routes that check can() themselves), they must still be someone who may
 * enter at all (mayEnter).
 */
export function requireTeam(
  capability?: Capability,
  options: RequireTeamOptions = {},
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = readSession(req, Math.floor(Date.now() / 1000));
      if (!session) {
        req.log.info({ reason: "no_valid_session" }, "team request refused");
        // SYC-516 C2 (spec 3.2): a browser form post from the dashboard
        // itself whose sign-in lapsed gets the "signed out" page (and, C3,
        // keeps what was typed). Everything else: today's 401, byte for byte.
        if (
          isBrowserNavigation(req) &&
          req.method === "POST" &&
          req.headers.origin === TEAM_ORIGIN &&
          isFormPost(req)
        ) {
          await refuseSignedOutSave(req, res);
          return;
        }
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
      // The door (first-colony spec §4.1): `in` as always; `starting` (a cat
      // guardian with no colony yet) only where a route says so; `out` is
      // "access has ended". Her own pages skip the door, as before.
      const door = doorFor(person);
      if (options.own !== true && door === "out") {
        req.log.info({ reason: "no_capability" }, "team request refused");
        refuseAccessEnded(req, res, person);
        return;
      }
      if (options.own !== true && door === "starting" && options.openToStarter !== true) {
        req.log.info({ reason: "starting_only" }, "team request refused");
        refuseForbidden(req, res, {
          name: person.name,
          island: false,
          language: person.language,
          starting: true,
        });
        return;
      }
      if (capability) {
        const islandOnly = options.island === true && !holdsIslandRow(person);
        let allowed = !islandOnly;
        // can() with no target implies can() for every target, for every
        // kind (see can()'s switch; capabilities.test.ts pins it), so when
        // it already holds the lookup can be skipped: the team's requests
        // never pay for it. A future kind that reads its target with no
        // island row must break that test first.
        if (allowed && !(options.target && can(person, capability))) {
          const resolved = options.target ? await options.target(req) : [];
          const targets = Array.isArray(resolved) ? resolved : [resolved];
          allowed =
            targets.length === 0
              ? can(person, capability)
              : targets.every((t) => can(person, capability, t));
        }
        if (!allowed) {
          req.log.info(
            { reason: "missing_capability", capability },
            "team request refused",
          );
          refuseForbidden(req, res, {
            name: person.name,
            island: holdsIslandRow(person),
            language: person.language,
            starting: door === "starting",
          });
          return;
        }
      }
      res.locals["teamPerson"] = person;
      navContext.run(
        {
          people: can(person, "manage_people"),
          island: holdsIslandRow(person),
          mine: true,
          starting: door === "starting",
          workspace: mayUseWorkspace(person),
        },
        next,
      );
    } catch (err) {
      next(err);
    }
  };
}
