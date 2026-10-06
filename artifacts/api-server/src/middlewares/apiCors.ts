import cors from "cors";
import type { RequestHandler } from "express";

// One origin allow-list for every API route that answers cross-origin at all
// (SYC-106; first written for the photo route under
// hosting-and-photo-storage.md §6.2 item 3 / SYC-65). It replaces the bare,
// any-origin cors() the rest of the API used, so an arbitrary website's
// script cannot read API responses cross-origin. An <img> tag can still load
// a photo from anywhere — browsers never gate that on CORS — so this only
// withholds the Access-Control-Allow-Origin header from script-driven
// cross-origin reads (fetch/XHR/canvas) by origins we didn't name.
//
// /api/team/* and /api/internal/* get no CORS headers at all (app.ts).
//
// Allowed:
// - catspotters.com and any one-level subdomain (the website, apptest.*, team.*,
//   admin.*, api.*). The web build calls its own origin (apiOrigin() in the
//   app), so its requests are same-origin and need none of this; subdomains
//   are allowed in case the site is ever served from a different one.
// - The Replit domains this server is running on, read from Replit's own
//   environment at startup rather than a wildcard over *.replit.dev or
//   *.replit.app, which would admit every other Replit user's app.
// - Expo/React Native development: the Metro bundler on localhost or
//   127.0.0.1 (any port — Expo picks one), and the `exp://` scheme used by
//   Expo Go and dev clients.
//
// Native app requests (iOS/Android via fetch) and same-origin GETs carry no
// Origin header at all. The `cors` package's origin callback receives
// `undefined` then; letting it through is not a bypass, it is how "no Origin
// header" is supposed to be handled, and it keeps the native app working.
//
// No `credentials: true`: nothing cross-origin needs a cookie today (the
// dashboard and the pre-launch pass are both same-origin).
const ALLOWLIST_PATTERNS: RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)?catspotters\.com$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^exp:\/\/.*/,
];

/**
 * `https://<domain>` for each domain Replit says this Repl or deployment is
 * served on: REPLIT_DOMAINS (comma-separated), plus the workspace's dev
 * preview domains. Exported for the test.
 */
export function replitOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const domains = [
    ...(env["REPLIT_DOMAINS"] ?? "").split(","),
    env["REPLIT_DEV_DOMAIN"] ?? "",
    env["REPLIT_EXPO_DEV_DOMAIN"] ?? "",
  ]
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, ""))
    .filter((d) => d !== "");
  return new Set(domains.map((d) => `https://${d}`));
}

const REPLIT_ORIGINS = replitOrigins();

export function isAllowedOrigin(origin: string): boolean {
  return (
    REPLIT_ORIGINS.has(origin.toLowerCase()) ||
    ALLOWLIST_PATTERNS.some((pattern) => pattern.test(origin))
  );
}

export const apiCors: RequestHandler = cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
});
