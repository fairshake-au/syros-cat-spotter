import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SIGN_IN_PAGE } from "./config";

// The one refusal for the staff dashboard (team-access spec §2.4): 401, a
// fixed body, nothing about which check failed. A browser page load gets the
// same 401 with a tiny fixed page that sends it straight back to the sign-in
// page (a 303 would lose the 401 every failure must share). The real reason
// goes into the server log, never the response.

export const NOT_SIGNED_IN_JSON = { error: "not_signed_in" } as const;

export const NOT_SIGNED_IN_PAGE =
  "<!doctype html>" +
  '<html lang="en"><head><meta charset="utf-8">' +
  `<meta http-equiv="refresh" content="0;url=${SIGN_IN_PAGE}">` +
  "<title>Please sign in</title></head><body>" +
  `<p>Please sign in again. <a href="${SIGN_IN_PAGE}">Go to the sign-in page</a>.</p>` +
  "</body></html>";

/** Headers for every dashboard response: never cached, never framed. */
export function setTeamHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export function isBrowserNavigation(req: Request): boolean {
  return req.headers["sec-fetch-mode"] === "navigate";
}

export function refuseNotSignedIn(req: Request, res: Response): void {
  setTeamHeaders(res);
  res.status(401);
  if (isBrowserNavigation(req)) {
    res.type("html").send(NOT_SIGNED_IN_PAGE);
    return;
  }
  res.json(NOT_SIGNED_IN_JSON);
}

/**
 * Every dashboard POST must come from exactly one expected Origin — a
 * missing Origin is not a free pass either (team.ts's own convention,
 * originally inline on POST /team/signout; extracted here so every
 * dashboard mutation, including observations.ts's, shares one check and one
 * refusal). SameSite=Lax treats every *.catspotters.com host as same-site,
 * so this is the only thing standing between a cross-site form post and a
 * signed-in person's cookie.
 */
export function requireOrigin(expectedOrigin: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.origin !== expectedOrigin) {
      req.log.warn({ reason: "bad_origin" }, "team request refused");
      refuseNotSignedIn(req, res);
      return;
    }
    next();
  };
}
