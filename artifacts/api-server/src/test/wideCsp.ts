// The one place that says which dashboard answers may carry the wider
// security header (SYC-396 plan Decision 5, Task 1.3.4). Shared by
// team.headers.test.ts and the route walk (team.walk.test.ts), and by the
// source test that no other file asks for it (refuse.source.test.ts).
//
// The two strings are written out here on purpose, not imported from
// refuse.ts: a change to either one in the code must fail a test.

/** Every dashboard answer's header: no script at all. Today's, byte for byte. */
export const STRICT_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The header for a page that loads our own script. Exactly this, nothing more. */
export const WIDE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * THE EXEMPTION. The routes whose own page (a 200 HTML answer) may carry
 * WIDE_CSP. Anything else, a refusal or a JSON answer from one of these
 * included, must carry STRICT_CSP. Adding a route here is a security
 * decision: say why in the PR.
 */
export const WIDE_CSP_ROUTES: ReadonlySet<string> = new Set([
  // The Cats grid: dashboard-grid.js applies the filters as you tap.
  "GET /api/team/cats",
]);

/**
 * The source files allowed to write `setTeamHeaders(…, { scripts: … })`.
 * Each holds a route in WIDE_CSP_ROUTES.
 */
export const WIDE_CSP_FILES: ReadonlySet<string> = new Set(["src/routes/teamCats.ts"]);

/** The header an answer must carry: WIDE_CSP only for an exempt route's own page. */
export function expectedCsp(
  route: string | undefined,
  res: { status: number; headers: Record<string, unknown> },
): string {
  const html = /^text\/html\b/.test(String(res.headers["content-type"] ?? ""));
  return route !== undefined && WIDE_CSP_ROUTES.has(route) && res.status === 200 && html
    ? WIDE_CSP
    : STRICT_CSP;
}
