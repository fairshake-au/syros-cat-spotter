// What a person may do on the dashboard (team-access spec §7.1, §7.3).
//
// can() is the ONLY place a permission is decided. No screen or route ever
// asks "is this person staff?"; each asks for a capability by name, and when
// guardian, volunteer and vet roles arrive (§7.2), only this function changes.

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

/** Every capability this person holds, for GET /api/team/me. */
export function capabilitiesOf(person: CapabilityHolder): Capability[] {
  return CAPABILITIES.filter((c) => can(person, c));
}
