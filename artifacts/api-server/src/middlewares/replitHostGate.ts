import type { NextFunction, Request, Response } from "express";
import { normalisePath } from "./prelaunchGate";

/**
 * SYC-229: refuse requests that arrive on the deployment's own Replit address.
 *
 * The live deployment answers on apptest.catspotters.com and
 * team.catspotters.com (one Google front end) and on
 * syros-cat-spotter-eu.replit.app, which comes in through a different one
 * (checked 14 Oct 2026). `trust proxy: 4` in app.ts was measured only through
 * the custom-domain front end (SYC-100). If the .replit.app route has fewer
 * hops, a visitor-supplied X-Forwarded-For becomes req.ip there and gets round
 * every per-address limit. Replit has no setting to switch that address off,
 * so the API closes it itself.
 *
 * - The decision reads the raw Host header, never req.hostname: with
 *   `trust proxy` set, Express takes req.hostname from X-Forwarded-Host, which
 *   a visitor can write.
 * - GET or HEAD on exactly /api/healthz always passes (Replit's start-up
 *   check, and the post-publish build check), as in prelaunchGate.
 * - ALLOW_REPLIT_HOST=1 opens the address again, for a recovery smoke run
 *   while apptest points elsewhere (docs/runbooks/neon-database.md steps 4–5).
 *   Only exactly "1" opens it.
 * - *.replit.dev is left alone: that is the development workspace's own
 *   preview address (REPLIT_DEV_DOMAIN), and the deployment never answers on it.
 *
 * The refusal is a bare 404, so the address looks like nothing is there.
 */

const REPLIT_HOST_SUFFIXES = [".replit.app", ".repl.co"];

export function isReplitHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  return REPLIT_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function replitHostGate(req: Request, res: Response, next: NextFunction): void {
  if (process.env["ALLOW_REPLIT_HOST"] === "1" || !isReplitHost(req.headers.host)) {
    next();
    return;
  }
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    normalisePath(req.path) === "/api/healthz"
  ) {
    next();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(404).end();
}
