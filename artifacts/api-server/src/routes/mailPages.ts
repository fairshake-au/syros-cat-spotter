import { Router, type IRouter, type Request, type Response } from "express";
import { publicAppOrigin } from "../lib/keepSafe/links";
import { confirmAddress, forgetAddress, tokenIsLive, type LinkPurpose } from "../lib/keepSafe/service";
import { kickRow } from "../lib/mail/outbox";
import { isTokenShaped, tokenLogId } from "../lib/keepSafe/tokens";

/**
 * The "Yes, that was me" and "Forget this address" pages (SYC-3 plan, Slice 1
 * step 4; Decision 5).
 *
 * They sit outside the pre-launch pass (prelaunchGate.ts lets /api/mail/*
 * through): a parent confirming an address may not be a tester. Each does one
 * thing with a one-time token and shows nothing else, so every route here
 * refuses without a live token.
 *
 * **Opening a link changes nothing.** The GET only shows a page with one
 * button, so an email scanner that follows links can't confirm or forget an
 * address. The button POSTs the token back (in the body, never the address
 * bar), from exactly the app's own origin (the `Origin` check PR #28 uses on
 * the staff sign-out, with this app's own constant).
 */

const router: IRouter = Router();

type Action = "confirm" | "forget";

/** SYC-262: Forget on an address that already keeps another spotter safe. */
const REQUEST_CANCELLED =
  "Done. We've cancelled that request, and we won't send this address any more \"Is this you?\" emails. Any spotter this address already keeps safe stays safe.";

const COPY: Record<Action, Copy> = {
  confirm: {
    title: "Keep my spots safe",
    ask: "Someone using the Cat Spotters app asked to use this address to keep their spots safe. If that was you, press the button.",
    button: "Yes, that was me",
    done: "Thank you. This address is now keeping a Cat Spotters collection safe. You can close this page.",
  },
  forget: {
    title: "Forget this address",
    ask: "Press the button and we'll forget this address. We won't send it anything else about keeping spots safe.",
    button: "Forget this address",
    done: "Done. We've forgotten this address, and we won't send it anything else about keeping spots safe. You can close this page.",
  },
};

/**
 * The same two pages for an address left on a cat report (SYC-42 Slice 3).
 * The words match the "is this you?" email (email-capture.md §4.1) and the
 * "Delete my details" line (spec §5.3(g)). Nothing names a cat or a report's
 * contents.
 */
type Copy = { title: string; ask: string; button: string; done: string };
const REPORT_COPY: Record<Action, Copy> = {
  confirm: {
    title: "Is this you?",
    ask: "Someone using the Cat Spotters app on Syros asked us to send email to this address. If that was you, press the button.",
    button: "Yes, that was me",
    done: "Thank you. We'll write to you about the cat you reported: once to say it reached Syros Cats, and once more when there's an outcome. You can close this page.",
  },
  forget: {
    title: "Forget this address",
    ask: "Press the button and we'll forget this address. We won't send it anything else.",
    button: "Forget this address",
    done: "Done. We've forgotten this address, and we won't send it anything else. You can close this page.",
  },
};
const REPORT_DELETE_COPY: Copy = {
  title: "Delete my details",
  ask: "Press the button and we'll delete your email address and take your name off your cat report. The report itself stays, so the cat keeps its history.",
  button: "Delete my details",
  done: "Done. We've deleted your email address, and your report no longer has your name on it. You can close this page.",
};

function copyFor(action: Action, link: LinkPurpose | null): Copy {
  if (link === "report_delete") return REPORT_DELETE_COPY;
  if (link === "report") return REPORT_COPY[action];
  return COPY[action];
}

const NOT_VALID = "This link has expired or has already been used. Nothing has changed.";

function setHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  // The token must never travel on in a Referer to anyone else. Not
  // `no-referrer`: under it, browsers send `Origin: null` on the button's
  // POST, and the Origin check below would refuse every real press (found in
  // the browser round trip). The page loads nothing from anywhere else
  // (CSP default-src 'none'), so `same-origin` keeps the token on this site.
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="same-origin">' +
    `<title>${esc(title)} — Cat Spotters</title>` +
    "<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#222}" +
    "button{font:inherit;font-weight:600;background:#1f6f5c;color:#fff;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}</style>" +
    `</head><body><h1>${esc(title)}</h1>${body}</body></html>`
  );
}

function send(res: Response, status: number, title: string, text: string, form?: { token: string; button: string }) {
  setHeaders(res);
  let body = `<p>${esc(text)}</p>`;
  if (form) {
    body +=
      `<form method="post"><input type="hidden" name="t" value="${esc(form.token)}">` +
      `<button type="submit">${esc(form.button)}</button></form>`;
  }
  res.status(status).type("html").send(page(title, body));
}

function mount(action: Action) {
  const purpose = action === "confirm" ? "verify" : "forget";

  router.get(`/mail/${action}`, async (req: Request, res: Response) => {
    const raw = req.query["t"];
    const link = isTokenShaped(raw) ? await tokenIsLive(raw, purpose) : null;
    if (!link) {
      send(res, 410, COPY[action].title, NOT_VALID);
      return;
    }
    const copy = copyFor(action, link);
    send(res, 200, copy.title, copy.ask, { token: raw as string, button: copy.button });
  });

  router.post(`/mail/${action}`, async (req: Request, res: Response) => {
    if (req.headers.origin !== publicAppOrigin()) {
      req.log.warn({ reason: "bad_origin", action }, "mail page POST refused");
      send(res, 403, COPY[action].title, NOT_VALID);
      return;
    }
    const raw = (req.body as Record<string, unknown> | undefined)?.["t"];
    if (!isTokenShaped(raw)) {
      send(res, 410, COPY[action].title, NOT_VALID);
      return;
    }
    if (action === "confirm") {
      const done = await confirmAddress(raw);
      if (!done) {
        req.log.warn({ action, token: tokenLogId(raw) }, "mail page POST refused: token not live");
        send(res, 410, COPY[action].title, NOT_VALID);
        return;
      }
      req.log.info({ action, purpose: done.purpose, queued: done.outboxIds.length, token: tokenLogId(raw) }, "mail page: done");
      const copy = copyFor(action, done.purpose);
      send(res, 200, copy.title, copy.done);
      // What was held for a report address goes now (after the commit).
      for (const id of done.outboxIds) kickRow(id);
      return;
    }
    const done = await forgetAddress(raw);
    if (!done) {
      req.log.warn({ action, token: tokenLogId(raw) }, "mail page POST refused: token not live");
      send(res, 410, COPY[action].title, NOT_VALID);
      return;
    }
    req.log.info({ action, outcome: done, token: tokenLogId(raw) }, "mail page: done");
    const copy =
      done === "report_deleted" ? REPORT_DELETE_COPY : done === "report_forgotten" ? REPORT_COPY.forget : COPY[action];
    send(res, 200, copy.title, done === "request_cancelled" ? REQUEST_CANCELLED : copy.done);
  });
}

mount("confirm");
mount("forget");

export default router;
