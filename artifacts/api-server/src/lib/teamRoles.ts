/**
 * The one list of the team's roles (roles-and-invites.md §10.4; SYC-53 plan,
 * PR 0.2; SYC-252).
 *
 * Before this file there were three copies: `AUTHORITATIVE_ROLES` in
 * resolve.ts, `TEAM_ROLES` in teamCorrections.ts (read by likelyReview.ts),
 * and a hand-written `"staff"` in each correction. They could drift apart,
 * and a drift silently de-authorises someone. Every reader now imports this
 * list, and `teamRoles.test.ts` fails if a team-role list is written
 * anywhere else in the api-server.
 *
 * - `staff`: the Syros Cats team.
 * - `management`: the small group who decide who gets in. They rank with the
 *   team, not above it (Decision G). Was the never-written `admin`.
 * - `vet`: reserved until vets can sign in (SYC-24). Not reachable in
 *   `writeObservation` yet.
 *
 * `guardian` is deliberately NOT here (review finding M1): a cat guardian's
 * authority comes only from her `colony:<id>` scope, through
 * `authorityLevel` in resolve.ts, never from belonging to the team.
 */
export const TEAM_ROLE_NAMES = ["staff", "management", "vet"] as const;

export type TeamRole = (typeof TEAM_ROLE_NAMES)[number];

export const TEAM_ROLES: ReadonlySet<string> = new Set(TEAM_ROLE_NAMES);

export function isTeamRole(role: string): role is TeamRole {
  return TEAM_ROLES.has(role);
}
