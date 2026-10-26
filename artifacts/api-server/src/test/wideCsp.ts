// The one place that says which dashboard answers may carry the wider
// security header (SYC-396 plan Decision 5, Task 1.3.4). Shared by
// team.headers.test.ts and the route walk (team.walk.test.ts), and by the
// source test that no other file asks for it (refuse.source.test.ts).
//
// The two strings are written out here on purpose, not imported from
// refuse.ts: a change to either one in the code must fail a test.

/** Every dashboard answer's header: no script at all. Today's, byte for byte. */
export const STRICT_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The header for a page that loads our own script. Exactly this, nothing more. */
export const WIDE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * THE EXEMPTION. The routes whose own page (a 200 HTML answer) may carry
 * WIDE_CSP. Anything else, a refusal or a JSON answer from one of these
 * included, must carry STRICT_CSP. Adding a route here is a security
 * decision: say why in the PR.
 */
export const WIDE_CSP_ROUTES: ReadonlySet<string> = new Set([
  // The Cats grid: dashboard-grid.js applies the filters as you tap.
  "GET /api/team/cats",
  // Find from a photo's form: find-photo.js locks the button once the search
  // starts, so a double tap can't spend two of the day's searches (SYC-522).
  // Only this 200; the POST's problem forms and results keep their own headers.
  "GET /api/team/cats/find",
]);

/**
 * The source files allowed to write `setTeamHeaders(…, { scripts: … })`.
 * Each holds a route in WIDE_CSP_ROUTES.
 */
export const WIDE_CSP_FILES: ReadonlySet<string> = new Set([
  "src/routes/teamCats.ts",
  // MapLibre's worker file (SYC-705 Task 2b.4): a worker's policy is its own
  // response's, so its 200 carries WIDE_CSP (connect-src 'self') to fetch map
  // data. Only maplibre-gl-worker.<hash>.mjs; every other asset has none.
  "src/routes/teamAssets.ts",
]);

/**
 * Find from a photo's results (SYC-491, option 2): the strict header plus
 * `data:` pictures, so the team's photo sits beside the matches without
 * being stored. Still no script. Exactly this, nothing more.
 */
export const PHOTO_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * The routes whose 200 HTML answer carries PHOTO_CSP. Every other answer
 * from them (a 4xx form, a refusal) carries STRICT_CSP. A security
 * decision, as WIDE_CSP_ROUTES is.
 */
export const PHOTO_CSP_ROUTES: ReadonlySet<string> = new Set([
  // Find from a photo's results: the only 200 the POST gives (SYC-396 PR 2.5).
  "POST /api/team/cats/find",
]);

/** The header an answer must carry: WIDE_CSP or PHOTO_CSP only for an exempt route's own page. */
export function expectedCsp(
  route: string | undefined,
  res: { status: number; headers: Record<string, unknown> },
): string {
  const html = /^text\/html\b/.test(String(res.headers["content-type"] ?? ""));
  const own = route !== undefined && res.status === 200 && html;
  if (own && WIDE_CSP_ROUTES.has(route)) return WIDE_CSP;
  if (own && PHOTO_CSP_ROUTES.has(route)) return PHOTO_CSP;
  return STRICT_CSP;
}
