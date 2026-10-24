import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { setPhotoVisibility, type VisibilityAction } from "../lib/photoVisibility";
import { TEAM_ORIGIN } from "../lib/teamAuth/config";
import { requireOrigin, setTeamHeaders } from "../lib/teamAuth/refuse";
import { refuseSignedIn, requireTeam, teamPerson } from "../middlewares/requireTeam";
import { renderPage } from "../lib/teamPages/layout";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { toPublicDay } from "../lib/catHelpers";

// Hiding and restoring a photo (SYC-43 part 2 plan, PR 6; spec §3.3: one tap,
// reversible, no "are you sure?"). Two form routes behind the team cat page's
// gallery. Each checks Origin first, then the session and its capability
// (hide_photo or restore_photo), then writes one event through
// lib/photoVisibility.ts, which checks the capability again. Nothing is
// updated or deleted: a restore is another event.
//
// A browser form post gets a 303 back to the cat page, landing on the photo
// with the message beside it; anything else gets JSON.

const router: IRouter = Router();

const PHOTO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CAT_ID_RE = /^\d{1,9}$/;

const isFormPost = (req: Request) => Boolean(req.is("application/x-www-form-urlencoded"));

const Body = z.object({
  /** The cat page to go back to. Only used to build the redirect. */
  cat: z.string().regex(CAT_ID_RE).optional(),
  reason: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(500).optional(),
  ),
});

/** Back to the cat page, on the photo, with `done` shown beside it. */
const backTo = (cat: string | undefined, publicId: string, done: string) =>
  cat
    ? `/api/team/cats/${cat}?done=${done}&p=${encodeURIComponent(publicId)}#p-${encodeURIComponent(publicId)}`
    : "/api/team/cats";

function route(action: VisibilityAction) {
  const capability = action === "hide" ? "hide_photo" : "restore_photo";
  router.post(
    `/team/photos/:publicId/${action}`,
    requireOrigin(TEAM_ORIGIN),
    requireTeam(capability),
    async (req: Request, res: Response) => {
      setTeamHeaders(res);
      const publicId = String(req.params["publicId"]);
      const parsed = Body.safeParse(req.body ?? {});
      if (!PHOTO_ID_RE.test(publicId) || !parsed.success) {
        if (!isFormPost(req)) return void res.status(400).json({ error: "Invalid request" });
        return void res
          .status(400)
          .type("html")
          .send(
            renderPage({
              title: "That didn't save",
              active: "cats",
              personName: teamPerson(res).name,
              body:
                "<p>Something in the form wasn't right. Nothing was changed.</p>" +
                '<p><a class="tap" href="/api/team/cats">Find a cat</a></p>',
            }),
          );
      }
      const { cat, reason } = parsed.data;
      const outcome = await setPhotoVisibility(teamPerson(res), { publicId, action, reason });
      switch (outcome.kind) {
        case "not_authorised":
          req.log.info({ reason: "missing_capability" }, "photo visibility refused");
          return refuseSignedIn(req, res);
        case "not_found":
          if (!isFormPost(req)) return void res.status(404).json({ error: "Not found" });
          return void res
            .status(404)
            .type("html")
            .send(
              renderPage({
                title: "No such photo",
                active: "cats",
                personName: teamPerson(res).name,
                body:
                  "<p>That photo doesn't exist. Nothing was changed.</p>" +
                  `<p><a class="tap" href="${esc(backTo(cat, publicId, "none"))}">Back</a></p>`,
              }),
            );
        case "already":
          // A second tab, or a second person a moment earlier: the photo is
          // already as asked. Nothing is written.
          if (!isFormPost(req)) {
            return void res.status(409).json({
              error: action === "hide" ? "Already hidden" : "Already public",
              code: action === "hide" ? "ALREADY_HIDDEN" : "ALREADY_PUBLIC",
            });
          }
          return void res.redirect(
            303,
            backTo(cat, publicId, action === "hide" ? "already_hidden" : "already_public"),
          );
        case "removed":
          // SYC-462 spec §6 item 2: removed for good; nothing is written.
          if (!isFormPost(req)) {
            return void res.status(409).json({ error: "Removed for good", code: "REMOVED" });
          }
          return void res
            .status(409)
            .type("html")
            .send(
              renderPage({
                title: "Removed for good",
                active: "cats",
                personName: teamPerson(res).name,
                body:
                  `<p>This photo was removed for good on ${esc(toPublicDay(outcome.removedAt))}. It can't be restored.</p>` +
                  `<p><a class="tap" href="${esc(backTo(cat, publicId, "none"))}">Back</a></p>`,
              }),
            );
        case "changed":
          if (!isFormPost(req)) {
            return void res.status(201).json({ id: outcome.event.id, hidden: action === "hide" });
          }
          return void res.redirect(303, backTo(cat, publicId, action === "hide" ? "hidden" : "restored"));
        default: {
          // A new outcome fails the type check here, rather than leaving the request hanging (SYC-462 review 1, finding 8).
          const unhandled: never = outcome;
          throw new Error(`unhandled photo visibility outcome: ${JSON.stringify(unhandled)}`);
        }
      }
    },
  );
}

/** POST /api/team/photos/:publicId/hide: hide a photo from the public. */
route("hide");
/** POST /api/team/photos/:publicId/restore: show it to the public again. */
route("restore");

export default router;
