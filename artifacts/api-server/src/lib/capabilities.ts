// What a person may do on the dashboard (team-access spec §7.1, §7.3).
//
// can() is the ONLY place a permission is decided. No screen or route ever
// asks "is this person staff?"; each asks for a capability by name, and when
// guardian, volunteer and vet roles arrive (§7.2), only this function changes.

import { TEAM_ROLE_NAMES, type TeamRole } from "./teamRoles";

export const CAPABILITIES = [
  "view_exact_location",
  "hide_photo",
  "restore_photo",
  "rename_cat",
  "rename_colony",
  "set_life_status",
  "set_sterilisation",
  "set_site_public",
  "change_report_state",
  "add_team_note",
  "manage_people",
  "action_deletion_request",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityHolder {
  scopes: { role: string; colonyId: number | null }[];
}

/** What a check is about, for roles that will be scoped to a colony (§7.2). */
export interface CapabilityTarget {
  colonyId?: number | null;
}

export function can(
  person: CapabilityHolder,
  capability: Capability,
  _target?: CapabilityTarget,
): boolean {
  // Refuse anything not on the list, even if a caller gets past the type.
  if (!(CAPABILITIES as readonly string[]).includes(capability)) return false;
  // §7.1: in this part, staff may do everything; guardian, volunteer and vet
  // are stored but grant nothing yet.
  return person.scopes.some((s) => s.role === "staff");
}

/**
 * Which `roleAtTime` a statement is written with (roles spec §10.4; SYC-53
 * plan, PR 0.2): the role under which the capability was granted for that
 * target, decided by the server from the person and the action and never
 * read from the request. A person who is staff and also a cat guardian,
 * using a team capability, writes `staff`; using a guardian-only capability
 * on her colony, she will write `guardian` (PR 2.2).
 *
 * Each of the person's scopes is asked on its own whether it grants the
 * capability, through can(), so this can never name a role can() wouldn't
 * honour. When several grant it, the team's roles are tried first, in the
 * one list's order (staff, management, vet), then the rest. Today can()
 * grants only `staff`, so this returns `staff` for every team member and
 * nothing written changes.
 *
 * Throws if no scope grants the capability: every caller has already
 * checked can() and refused, so reaching here without a grant is a bug, and
 * writing a statement under a role nobody holds would be worse than failing.
 */
export function actingRole(
  person: CapabilityHolder,
  capability: Capability,
  target?: CapabilityTarget,
): string {
  const order = (role: string): number => {
    const i = TEAM_ROLE_NAMES.indexOf(role as TeamRole);
    return i === -1 ? TEAM_ROLE_NAMES.length : i;
  };
  const scopes = [...person.scopes].sort((a, b) => order(a.role) - order(b.role));
  for (const scope of scopes) {
    if (can({ scopes: [scope] }, capability, target)) return scope.role;
  }
  throw new Error(`actingRole: no scope grants ${capability}`);
}

/** Every capability this person holds, for GET /api/team/me. */
export function capabilitiesOf(person: CapabilityHolder): Capability[] {
  return CAPABILITIES.filter((c) => can(person, c));
}

/**
 * May this person in at all: the workspace sign-in, the hand-off, and the
 * signed-in pages that need no particular capability (SYC-188). Being in the
 * people table is not enough; they must hold at least one capability, so it
 * is decided by can() like everything else. Today that means staff (§7.1).
 * When guardians, volunteers and vets are given capabilities (§7.2), they
 * are let in by the same rule without this changing.
 */
export function mayEnter(person: CapabilityHolder): boolean {
  return CAPABILITIES.some((c) => can(person, c));
}
