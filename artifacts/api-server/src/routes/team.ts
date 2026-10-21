import { Router, type IRouter, type Request, type Response } from "express";
import { db, findInvitee, findPersonById, teamHandoffSpentTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";
import { handoffLimiter } from "../middlewares/rateLimit";
import {
  handoffPublicKeys,
  sessionKeys,
  SIGN_IN_ORIGIN,
  SIGN_OUT_PAGE,
  TEAM_HOME,
  TEAM_ORIGIN,
} from "../lib/teamAuth/config";
import { checkHandoffToken } from "../lib/teamAuth/handoff";
import {
  clearInviteSession,
  clearSession,
  issueInviteSession,
  issueSession,
  readInviteSession,
  readSession,
} from "../lib/teamAuth/session";
import {
  GUARDIAN_HOME_PATH,
  isBrowserNavigation,
  refuseNotSignedIn,
  requireOrigin,
  setTeamHeaders,
} from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { can, capabilitiesOf, maySignIn } from "../lib/capabilities";
import { renderQueuePage } from "../lib/teamPages/queuePage";
import { listWelfareQueue } from "../lib/welfareQueue";
import { isIslandWide } from "../lib/guardianView";

// The staff dashboard on team.catspotters.com (team-access spec §2.4, §2.6,
// §8.2; SYC-43 part 1 plan §5, §6). No CORS headers: app.ts skips /api/team/.
//
// Every dashboard route except the hand-off itself must use requireTeam. A
// dashboard route that doesn't is a review failure.

const router: IRouter = Router();

/** Where an invitee lands after the hand-off: the accept page (PR 1.1). */
export const WELCOME_PATH = "/api/team/my/welcome";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Where a replayed pass's person already is (SYC-353): her home, if this
 * request carries a valid team session for exactly `sub` at her current
 * session version and she may enter; the accept page, if it carries a valid
 * invitee session for exactly `sub` and she is still Invited at that
 * version. Otherwise null.
 */
async function alreadySignedInAs(req: Request, sub: string, now: number): Promise<string | null> {
  const team = readSession(req, now);
  if (team && team.pid === sub) {
    const person = await findPersonById(team.pid);
    if (person && person.sessionVersion === team.sv && maySignIn(person)) {
      return can(person, "view_welfare_queue") ? TEAM_HOME : `${TEAM_ORIGIN}${GUARDIAN_HOME_PATH}`;
    }
  }
  const pending = readInviteSession(req, now);
  if (pending && pending.pid === sub) {
    const invitee = await findInvitee(pending.pid);
    if (invitee && invitee.sessionVersion === pending.sv) return `${TEAM_ORIGIN}${WELCOME_PATH}`;
  }
  return null;
}

/**
 * POST /api/team/handoff: the sign-in Worker's "Cat Spotters dashboard"
 * button POSTs the one-minute pass here (a POST keeps it out of the address
 * bar, history, logs and Referer). Checks, in the spec's order (§2.4), each
 * one mandatory. No fallback, no development bypass, no identity header.
 */
router.post(
  "/team/handoff",
  handoffLimiter,
  async (req: Request, res: Response) => {
    const now = nowSeconds();
    const refuse = (reason: string, jti?: string) => {
      req.log.warn({ reason, jti }, "team hand-off refused");
      refuseNotSignedIn(req, res);
    };

    // 0. Only from the sign-in page. A missing Origin is not a free pass:
    // SameSite=Lax treats every *.catspotters.com host as same-site.
    if (req.headers.origin !== SIGN_IN_ORIGIN) return refuse("bad_origin");

    // 1–4. Shape, signature (algorithm fixed in code), iss/aud, time.
    const check = checkHandoffToken(req.body?.token, handoffPublicKeys(), now);
    if (!check.ok) return refuse(check.reason);
    const { claims } = check;

    // Without a session key there is nothing to issue; refuse before spending
    // the pass, so it isn't wasted by a configuration mistake.
    if (!sessionKeys()) return refuse("session_not_configured", claims.jti);

    // 5. Single use, across every server: one INSERT only one server can win.
    await db
      .delete(teamHandoffSpentTable)
      .where(
        lt(teamHandoffSpentTable.spentAt, sql`now() - interval '10 minutes'`),
      );
    const spent = await db
      .insert(teamHandoffSpentTable)
      .values({ jti: claims.jti })
      .onConflictDoNothing()
      .returning({ jti: teamHandoffSpentTable.jti });
    if (spent.length !== 1) {
      // SYC-353: since SYC-88 a re-tap within the minute sends the SAME pass,
      // which is refused as a replay even though this browser already holds
      // a good session from the first tap. Only here, after every earlier
      // check has passed: if the request's own session is for exactly this
      // pass's person (pid === sub) at her current session version, send her
      // where a fresh hand-off would. No new cookie, and the pass stays spent.
      const home = await alreadySignedInAs(req, claims.sub, now);
      if (home) {
        req.log.info({ reason: "replayed_already_signed_in", jti: claims.jti }, "team hand-off replayed by a signed-in browser");
        setTeamHeaders(res);
        res.redirect(303, home);
        return;
      }
      return refuse("replayed", claims.jti);
    }

    // 6. Still on the list, at the current session version. The Worker read
    // `sv` from the list moments ago and versions only ever rise, so anything
    // but equality is refused.
    const person = await findPersonById(claims.sub);
    if (!person) {
      // SYC-53 PR 1.1 (roles spec §4.1 step 3, §4.5): someone invited and not
      // yet joined gets an invitee session, its own cookie and kind, which
      // reaches the accept page and nothing else. findInvitee means Invited
      // and unexpired, by the database's clock, and returns no placements.
      const pending = await findInvitee(claims.sub);
      if (!pending) return refuse("not_on_list", claims.jti);
      if (claims.sv !== pending.sessionVersion) {
        return refuse("stale_session_version", claims.jti);
      }
      if (!issueInviteSession(res, pending, now)) {
        return refuse("session_not_configured", claims.jti);
      }
      req.log.info({ jti: claims.jti }, "team hand-off accepted for an invitee");
      setTeamHeaders(res);
      res.redirect(303, `${TEAM_ORIGIN}${WELCOME_PATH}`);
      return;
    }
    // A role that grants nothing gets no session either (SYC-188). A cat
    // guardian with no colony yet does (SYC-439): she reaches only her own
    // pages and the Colonies list and create form (doorFor).
    if (!maySignIn(person)) return refuse("no_capability", claims.jti);
    if (claims.sv !== person.sessionVersion) {
      return refuse("stale_session_version", claims.jti);
    }

    // 7. Only then, the session.
    if (!issueSession(res, person, now)) {
      return refuse("session_not_configured", claims.jti);
    }
    req.log.info({ jti: claims.jti }, "team hand-off accepted");
    setTeamHeaders(res);
    // The team lands on Home (SYC-396 PR 2.1). Someone with no island row (a
    // cat guardian) lands on her own page instead, never on Home's 403
    // (roles spec §6.3: "straight to the dashboard"). PR 1.3 makes that page
    // "My colonies".
    res.redirect(
      303,
      can(person, "view_welfare_queue") ? TEAM_HOME : `${TEAM_ORIGIN}${GUARDIAN_HOME_PATH}`,
    );
  },
);

/**
 * GET /api/team/: the welfare queue (SYC-43 part 2, PR 1). Plain
 * server-rendered HTML with no scripts. `view_welfare_queue`, island-only
 * (roles spec §6.2 note 4): it holds every report on the island, "Report an
 * issue" reports, reporters' photos and the team's notes, none of which
 * reaches a cat guardian.
 */
router.get(
  "/team",
  requireTeam("view_welfare_queue"),
  async (req: Request, res: Response) => {
    const person = teamPerson(res);
    setTeamHeaders(res); // before any await, so an error answer carries them too
    const queue = await listWelfareQueue();
    // ?changed=<publicId>: the state route's 303 after someone else moved
    // that report first. Only a string is used, and only to pick a card.
    const changed =
      typeof req.query["changed"] === "string"
        ? req.query["changed"]
        : undefined;
    // ?tied=<ok|changed|same>&r=<publicId>: the tie route's 303. Both are
    // only used to pick a card and a fixed sentence, never echoed.
    const tied =
      typeof req.query["tied"] === "string" && typeof req.query["r"] === "string"
        ? { key: req.query["tied"], id: req.query["r"] }
        : undefined;
    // ?noted=<publicId>: the note route's 303. Only picks a card.
    const noted =
      typeof req.query["noted"] === "string" ? req.query["noted"] : undefined;
    res
      .type("html")
      // Open map on each position only for an island-wide viewer (D9, SYC-395).
      .send(renderQueuePage(
          queue,
          person.name,
          new Date(),
          changed,
          tied,
          isIslandWide(person),
          noted,
          can(person, "change_report_state"),
        ));
  },
);

/**
 * GET /api/team/me: who is signed in, and what they hold and WHERE (finding
 * S13): `"island"`, the colony ids of a cat guardian's placements, or
 * `"anywhere"` for a power with no colony to name (creating a colony).
 */
router.get("/team/me", requireTeam(), (_req: Request, res: Response) => {
  const person = teamPerson(res);
  setTeamHeaders(res);
  res.json({
    name: person.name,
    email: person.email,
    capabilities: capabilitiesOf(person),
  });
});

/**
 * POST /api/team/signout: clears the cookie on this device (§2.1). Like every
 * dashboard POST, it must come from the dashboard's own origin; a missing
 * Origin is refused too (requireOrigin).
 */
router.post(
  "/team/signout",
  requireOrigin(TEAM_ORIGIN),
  (req: Request, res: Response) => {
    setTeamHeaders(res);
    clearSession(res);
    // An invitee's session too (SYC-53 PR 1.1): sign-out ends both kinds.
    clearInviteSession(res);
    // A browser goes on through the sign-in site's own sign-out, which ends
    // that session too and leaves it on the sign-in page.
    if (isBrowserNavigation(req)) {
      res.redirect(303, SIGN_OUT_PAGE);
      return;
    }
    res.status(204).end();
  },
);

export default router;
