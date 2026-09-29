import cors from "cors";
import type { RequestHandler } from "express";

// hosting-and-photo-storage.md §6.2 item 3: replace the app-wide bare
// cors() for the photo route with an explicit allowlist, so an arbitrary
// website's script cannot read photo bytes cross-origin. This does not stop
// an <img> tag from loading a photo from anywhere — browsers never gate
// that on CORS — so it costs nothing for normal browsing; it only denies
// the Access-Control-Allow-Origin header to script-driven cross-origin
// reads (fetch/XHR/canvas) from origins we didn't name.
//
// Allowed:
// - catspotters.com and any subdomain (the web build, admin.*, team.*,
//   api.* — apiOrigin() in the app talks to the deployment's own origin, so
//   the web build's requests are same-origin and don't even carry an
//   Origin header for same-origin fetches, but subdomains are allowed too
//   in case the web build is ever served from a different subdomain).
// - Expo/React Native development origins: the Metro bundler on localhost
//   (any port — Expo picks one), and the `exp://` scheme used by Expo Go
//   and dev clients.
//
// Native app requests (iOS/Android via fetch) and same-origin browser
// requests carry no Origin header at all. The `cors` package's origin
// callback receives `undefined` in that case; allowing it through is not a
// bypass; it is how "no Origin header" is supposed to be handled, and it's
// what keeps native photo loading working.
const ALLOWLIST_PATTERNS: RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)?catspotters\.com$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^exp:\/\/.*/,
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWLIST_PATTERNS.some((pattern) => pattern.test(origin));
}

export const photoCors: RequestHandler = cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
});
