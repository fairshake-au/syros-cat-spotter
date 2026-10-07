import { Router, type IRouter, type Request, type Response } from "express";
import { publicAppOrigin } from "../lib/keepSafe/links";
import { confirmAddress, forgetAddress, tokenIsLive } from "../lib/keepSafe/service";
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

const COPY: Record<Action, { title: string; ask: string; button: string; done: string }> = {
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
  const copy = COPY[action];
  const purpose = action === "confirm" ? "verify" : "forget";

  router.get(`/mail/${action}`, async (req: Request, res: Response) => {
    const raw = req.query["t"];
    if (!isTokenShaped(raw) || !(await tokenIsLive(raw, purpose))) {
      send(res, 410, copy.title, NOT_VALID);
      return;
    }
    send(res, 200, copy.title, copy.ask, { token: raw, button: copy.button });
  });

  router.post(`/mail/${action}`, async (req: Request, res: Response) => {
    if (req.headers.origin !== publicAppOrigin()) {
      req.log.warn({ reason: "bad_origin", action }, "mail page POST refused");
      send(res, 403, copy.title, NOT_VALID);
      return;
    }
    const raw = (req.body as Record<string, unknown> | undefined)?.["t"];
    if (!isTokenShaped(raw)) {
      send(res, 410, copy.title, NOT_VALID);
      return;
    }
    const done = action === "confirm" ? await confirmAddress(raw) : await forgetAddress(raw);
    if (!done) {
      req.log.warn({ action, token: tokenLogId(raw) }, "mail page POST refused: token not live");
      send(res, 410, copy.title, NOT_VALID);
      return;
    }
    req.log.info({ action, token: tokenLogId(raw) }, "mail page: done");
    send(res, 200, copy.title, copy.done);
  });
}

mount("confirm");
mount("forget");

export default router;
