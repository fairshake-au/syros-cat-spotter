import { Router, type IRouter, type Request, type Response } from "express";
import {
  acceptInvitation,
  declineInvitation,
  findPersonById,
  invitationFor,
  PeopleError,
  PERSON_NAME_MAX,
  cleanPersonName,
} from "@workspace/db";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import { clearInviteSession, issueSession } from "../lib/teamAuth/session";
import { isBrowserNavigation, refuseAccessEnded, requireOrigin, setTeamHeaders } from "../lib/teamAuth/refuse";
import { mayEnter } from "../lib/capabilities";
import { homeFor, invitee, requireInvitee, sendClosed } from "../middlewares/requireInvitee";
import {
  PROMISES_VERSION,
  renderDeclinedPage,
  renderWelcomePage,
} from "../lib/teamPages/welcomePage";

// SYC-53 PR 1.1: the accept page (roles-and-invites.md §4.1 step 4, §10.1,
// §14 case 14). Every route here is behind requireInvitee, which reads only
// the invitee's own cookie; every POST is behind requireOrigin (a missing
// Origin is refused too). Pressing a button twice changes nothing the second
// time and says so (the closed page, or a 303 home for someone who joined),
// never a 500. No email goes to the inviter when she accepts (Decision 7).

const router: IRouter = Router();

/** GET /api/team/my/welcome: who invited her, for what, the promises, the buttons. */
router.get("/team/my/welcome", requireInvitee(), async (req: Request, res: Response) => {
  setTeamHeaders(res);
  const me = invitee(res);
  const invitation = await invitationFor(me.id);
  if (!invitation) {
    sendClosed(req, res);
    return;
  }
  res.type("html").send(
    renderWelcomePage({
      name: me.name,
      language: me.language,
      inviterName: invitation.inviterName,
      roles: invitation.roles,
      colonies: invitation.colonies.map((c) => c.name),
      starting: invitation.starting,
    }),
  );
});

/** The name she typed: trimmed, cut to the field's length; empty keeps hers. */
function typedName(req: Request): string {
  const raw = typeof req.body?.name === "string" ? req.body.name : "";
  return [...cleanPersonName(raw)].slice(0, PERSON_NAME_MAX).join("");
}

/**
 * POST /api/team/my/accept: the one conditional update. On success the
 * invite cookie is cleared and a normal team session issued in the same
 * response (review minor 7), then a 303 to her home.
 */
router.post(
  "/team/my/accept",
  requireOrigin(TEAM_ORIGIN),
  requireInvitee(),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const me = invitee(res);
    let accepted: Awaited<ReturnType<typeof acceptInvitation>>;
    try {
      accepted = await acceptInvitation(me.id, typedName(req), PROMISES_VERSION);
    } catch (err) {
      if (!(err instanceof PeopleError)) throw err;
      accepted = null;
    }
    const person = accepted ? await findPersonById(me.id) : null;
    if (!accepted || !person) {
      // Withdrawn, expired or already accepted in the meantime: nothing changed.
      req.log.info({ reason: "not_accepted" }, "accept page: nothing changed");
      clearInviteSession(res);
      const joined = await findPersonById(me.id);
      if (joined) {
        res.redirect(303, homeFor(joined));
        return;
      }
      sendClosed(req, res);
      return;
    }
    clearInviteSession(res);
    // As the hand-off does (SYC-188): no session for someone who holds
    // nothing that opens the dashboard, say a placement that ended between
    // the invitation and the yes. She has joined; she gets "Your access has
    // ended", not a session.
    if (!mayEnter(person)) {
      req.log.info({ reason: "no_capability" }, "accepted, but holds nothing; no session issued");
      refuseAccessEnded(req, res, person);
      return;
    }
    if (!issueSession(res, person, Math.floor(Date.now() / 1000))) {
      // No session key: she has joined; she signs in the usual way.
      req.log.error({ reason: "session_not_configured" }, "accepted, but no session issued");
    }
    req.log.info("invitation accepted");
    res.redirect(303, homeFor(person));
  },
);

/** POST /api/team/my/decline: No, this isn't for me. */
router.post(
  "/team/my/decline",
  requireOrigin(TEAM_ORIGIN),
  requireInvitee(),
  async (req: Request, res: Response) => {
    setTeamHeaders(res);
    const me = invitee(res);
    const declined = await declineInvitation(me.id);
    clearInviteSession(res);
    if (!declined) {
      sendClosed(req, res);
      return;
    }
    req.log.info("invitation declined");
    if (isBrowserNavigation(req)) {
      res.type("html").send(renderDeclinedPage(me.language));
      return;
    }
    res.json({ status: "declined" });
  },
);

export default router;
