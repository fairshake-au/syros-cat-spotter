import type { NextFunction, Request, Response } from "express";

// SYC-406: Postgres refuses a NUL character (\u0000) in text, so a body with
// one in any string became a 500 on every route that stores it (and a clean
// log, because safeError drops the query). One check, after the body is
// parsed and before any route runs, turns it into a plain 400 everywhere.

/** Error types the app's error handler turns into a 400. */
export const NUL_IN_BODY = "body.contains.nul";
export const NUL_IN_URL = "url.contains.nul";

export const NUL_MESSAGE = "This request contains a character we can't accept. Please remove it and try again.";

const MAX_DEPTH = 64;

/** True if any string, or any key, anywhere in `value` contains a NUL. */
export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (value === null || typeof value !== "object") return false;
  // Too deep to check: refuse rather than let a NUL hide at the bottom.
  if (depth > MAX_DEPTH) return true;
  // The Resend webhook's raw Buffer is not a parsed body.
  if (Buffer.isBuffer(value)) return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (k.includes("\u0000") || containsNul(v, depth + 1)) return true;
  }
  return false;
}

export function refuseNul(req: Request, _res: Response, next: NextFunction): void {
  // JSON bodies only (the ticket's scope). Form posts and search queries on
  // the dashboard already answer a NUL with their own friendly messages.
  if (req.is("application/json") && containsNul(req.body)) {
    next(Object.assign(new Error("NUL character in request"), { type: NUL_IN_BODY }));
    return;
  }
  next();
}

/**
 * SYC-691: the same 400 for a NUL in the query string or the path (a path
 * parameter such as /api/profiles/%00/username reached Postgres and became a
 * 500). `req.path` keeps its percent-encoding, so a path NUL is "%00"; Express
 * decodes it into `req.params` later, per route.
 *
 * Left alone, because they already answer a NUL with their own page or
 * message (and tests that say so): the dashboard (/api/team, its search boxes
 * and id routes), the email-link pages (/api/mail, whose token check refuses
 * it with the "link not valid" page) and the donation redirects (/api/go,
 * which never read the query).
 */
const OWN_NUL_HANDLING = /^\/api\/(team|mail|go)(\/|$)/;

export function refuseNulInUrl(req: Request, _res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api/") || OWN_NUL_HANDLING.test(req.path)) return next();
  if (/%00/i.test(req.path) || containsNul(req.query)) {
    next(Object.assign(new Error("NUL character in request URL"), { type: NUL_IN_URL }));
    return;
  }
  next();
}
