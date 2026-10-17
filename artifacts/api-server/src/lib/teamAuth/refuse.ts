import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SIGN_IN_PAGE } from "./config";
import { renderPage } from "../teamPages/layout";
import { escapeHtml } from "../teamPages/escape";
import { LIVE_LANGUAGES, pageLanguage, tr, type Language } from "../teamPages/strings";

// The refusals for the dashboard. **Not signed in** (team-access spec §2.4):
// 401, a fixed body, nothing about which check failed. A browser page load gets the
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

/**
 * The dashboard's security header. TEAM_CSP is every page's: no script at
 * all. It must stay byte-for-byte as it is (team.headers.test.ts).
 */
export const TEAM_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * The wider header for the few pages that run our own script (SYC-396 plan
 * Decision 5; spec §14): scripts, fetches and styles from this server only,
 * and pictures made in the page (blob:). Never 'unsafe-eval', never
 * 'unsafe-inline' for scripts, never another host. Only the routes named in
 * WIDE_CSP_ROUTES (team.headers.test.ts) may ask for it, and a source test
 * (teamAuth/refuse.source.test.ts) fails any other file that does.
 */
export const TEAM_CSP_WITH_SCRIPTS =
  "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Headers for every dashboard response: never cached, never framed.
 * `scripts: true` is for a page that loads our own script; see
 * TEAM_CSP_WITH_SCRIPTS for who may pass it.
 */
export function setTeamHeaders(res: Response, opts: { scripts?: boolean } = {}): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", opts.scripts === true ? TEAM_CSP_WITH_SCRIPTS : TEAM_CSP);
  // SYC-330: not "no-referrer". Under that policy a browser sends
  // `Origin: null` on a form post, even to the same site, and requireOrigin
  // refuses it, so every dashboard button failed. "same-origin" sends the
  // real Origin (and a referrer) only to the dashboard itself, and nothing
  // to any other site.
  res.setHeader("Referrer-Policy", "same-origin");
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

// ── Signed in, but not allowed (roles-and-invites.md §6.4; SYC-53 PR 0.5) ──
//
// A 401 sends a browser back to sign in, which signs a cat guardian straight
// back in and lands her on the same refusal: a loop with no explanation. So a
// person who IS signed in (a valid session, on the list, joined, not left)
// and is refused gets a quiet 403 instead: a short page for a browser, and
// the fixed `{"error":"forbidden"}` for anything else. It reveals only that
// the page exists, which is no secret. Only a missing, expired or stale
// session, or a person who is gone or not yet joined, still gets the 401.

export const FORBIDDEN_JSON = { error: "forbidden" } as const;

/**
 * Where "Your colonies are here" points. A team member's home is the
 * dashboard. A cat guardian's home is "My colonies" (SYC-53 PR 1.3).
 */
export const TEAM_HOME_PATH = "/api/team/";
export const GUARDIAN_HOME_PATH = "/api/team/my/colonies";

/** Who is being refused, as far as the page needs to know. */
export interface RefusedPerson {
  name: string;
  /** True for someone whose roles cover the whole island (the team). */
  island: boolean;
  /** Their saved language (people.language). Falls back to English until live. */
  language?: string | null;
  /** A cat guardian with no colony yet (SYC-439): her own line and link. */
  starting?: boolean;
}

function sendForbidden(req: Request, res: Response, page: () => string): void {
  setTeamHeaders(res);
  res.status(403);
  if (isBrowserNavigation(req)) {
    res.type("html").send(page());
    return;
  }
  res.json(FORBIDDEN_JSON);
}

/** The 403 page: "That part of the dashboard is for the Syros Cats team." */
export function forbiddenPage(
  person: RefusedPerson,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(person.language, live);
  const body = person.island
    ? `<p>${escapeHtml(tr(lang, "refused.forManagement", undefined, live))}</p>` +
      `<p><a class="tap" href="${TEAM_HOME_PATH}">${escapeHtml(tr(lang, "refused.backHome", undefined, live))}</a></p>`
    : `<p>${escapeHtml(tr(lang, "refused.forTeam", undefined, live))} ` +
      `<a href="${GUARDIAN_HOME_PATH}">${escapeHtml(tr(lang, person.starting ? "refused.startHere" : "refused.yourColonies", undefined, live))}</a>.</p>`;
  return renderPage({
    title: tr(lang, person.island ? "refused.titleManagement" : "refused.title", undefined, live),
    active: null,
    nav: person.island,
    island: person.island,
    mine: true,
    personName: person.name,
    lang,
    liveLanguages: live,
    body,
  });
}

/** The page for a signed-in person who no longer holds anything (review minor 2). */
export function accessEndedPage(
  person: Pick<RefusedPerson, "name" | "language">,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(person.language, live);
  return renderPage({
    title: tr(lang, "ended.title", undefined, live),
    active: null,
    nav: false,
    island: false,
    mine: true,
    personName: person.name,
    lang,
    liveLanguages: live,
    body: `<p>${escapeHtml(tr(lang, "ended.body", undefined, live))}</p>`,
  });
}

/** Signed in, may enter, but lacks this capability here. */
export function refuseForbidden(
  req: Request,
  res: Response,
  person: RefusedPerson,
): void {
  sendForbidden(req, res, () => forbiddenPage(person));
}

/**
 * Signed in and joined, but holding nothing any more: a holiday cover the day
 * after her end date, or a role that grants nothing.
 */
export function refuseAccessEnded(
  req: Request,
  res: Response,
  person: Pick<RefusedPerson, "name" | "language">,
): void {
  sendForbidden(req, res, () => accessEndedPage(person));
}
