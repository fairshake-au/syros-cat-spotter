import { Router, type IRouter, type Request, type Response } from "express";
import { db, findPersonById, teamHandoffSpentTable } from "@workspace/db";
import { lt, sql } from "drizzle-orm";
import { handoffLimiter } from "../middlewares/rateLimit";
import {
  handoffPublicKeys,
  sessionKeys,
  SIGN_IN_ORIGIN,
  SIGN_IN_PAGE,
  TEAM_HOME,
  TEAM_ORIGIN,
} from "../lib/teamAuth/config";
import { checkHandoffToken } from "../lib/teamAuth/handoff";
import { clearSession, issueSession } from "../lib/teamAuth/session";
import {
  isBrowserNavigation,
  refuseNotSignedIn,
  requireOrigin,
  setTeamHeaders,
} from "../lib/teamAuth/refuse";
import { requireTeam, teamPerson } from "../middlewares/requireTeam";
import { capabilitiesOf } from "../lib/capabilities";

// The staff dashboard on team.catspotters.com (team-access spec §2.4, §2.6,
// §8.2; SYC-43 part 1 plan §5, §6). No CORS headers: app.ts skips /api/team/.
//
// Every dashboard route except the hand-off itself must use requireTeam. A
// dashboard route that doesn't is a review failure.

const router: IRouter = Router();

const nowSeconds = () => Math.floor(Date.now() / 1000);

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
    if (spent.length !== 1) return refuse("replayed", claims.jti);

    // 6. Still on the list, at the current session version. The Worker read
    // `sv` from the list moments ago and versions only ever rise, so anything
    // but equality is refused.
    const person = await findPersonById(claims.sub);
    if (!person) return refuse("not_on_list", claims.jti);
    if (claims.sv !== person.sessionVersion) {
      return refuse("stale_session_version", claims.jti);
    }

    // 7. Only then, the session.
    if (!issueSession(res, person, now)) {
      return refuse("session_not_configured", claims.jti);
    }
    req.log.info({ jti: claims.jti }, "team hand-off accepted");
    setTeamHeaders(res);
    res.redirect(303, TEAM_HOME);
  },
);

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/**
 * GET /api/team/: the one-line signed-in page, until the welfare queue
 * replaces it. Plain server-rendered HTML with no scripts.
 */
router.get("/team", requireTeam(), (_req: Request, res: Response) => {
  const person = teamPerson(res);
  setTeamHeaders(res);
  res
    .type("html")
    .send(
      "<!doctype html>" +
        '<html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        "<title>Cat Spotters dashboard</title></head><body>" +
        `<p>You're signed in as ${escapeHtml(person.name)}. The welfare queue is coming soon.</p>` +
        '<form method="post" action="/api/team/signout"><button type="submit">Sign out</button></form>' +
        "</body></html>",
    );
});

/** GET /api/team/me: who is signed in, for the future screens. */
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
    if (isBrowserNavigation(req)) {
      res.redirect(303, SIGN_IN_PAGE);
      return;
    }
    res.status(204).end();
  },
);

export default router;
