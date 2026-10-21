// What a person may do on the dashboard (roles-and-invites.md §6; team-access
// spec §7.3).
//
// can() is the ONLY place a permission is decided. No screen or route ever
// asks "is this person staff?"; each asks for a capability by name. The
// catalogue below is the spec's §6.2 table as data, and capabilities.catalogue
// .test.ts parses that table out of the spec itself, so the two can't drift.
//
// **Strict (Decision 4, SYC-53 PR 0.5).** A placed capability asked with no
// colony answers "held island-wide?", never "held for any colony?". A route
// that forgets to say where it applies refuses a cat guardian rather than
// showing her the whole island. "For any colony?" is canSomewhere(), used only
// for the dashboard door and for menus.
//
// **Expiry.** A placement with an end date stops working at the next request
// after it passes, with no job run (§6.6). It is decided by the DATABASE's
// clock, when the person is read (findPersonById and findAllowedPerson drop
// ended rows in SQL), never by this process's clock. So the holders passed in
// here have already lost their ended rows; nothing in this file reads a clock.

import { ISLAND_ROLES } from "@workspace/db/schema";
import { TEAM_ROLE_NAMES, type TeamRole } from "./teamRoles";

/**
 * The four kinds (roles-and-invites.md §6.1):
 * - `island`: held only through a row covering the whole island (the team
 *   and management). Needs no target.
 * - `placed`: held for the colonies a person's rows cover. With a target, an
 *   island row or a row for exactly that colony; with no target, island rows
 *   only.
 * - `role_wide`: held by anyone with the role, wherever their rows are.
 * - `own_scope`: "creates its own scope" (`create_colony`): there is no
 *   colony yet to name, so any row of a role that holds it counts.
 */
export type CapabilityKind = "island" | "placed" | "role_wide" | "own_scope";

/** Who holds what: the roles column of §6.2, and the kind. */
interface CatalogueEntry {
  kind: CapabilityKind;
  roles: readonly ("staff" | "management" | "guardian")[];
}

// The roles whose rows cover the whole island (`ISLAND_ROLES`, the database's
// own list, which its checks enforce), and those plus the cat guardian.
const TEAM = ISLAND_ROLES;
const EVERYONE = [...ISLAND_ROLES, "guardian"] as const;

/**
 * The catalogue (roles-and-invites.md §6.2), in the spec's order. "All" and
 * "✓" in the spec are the team's and management's island rows; "Own" is a
 * guardian's colony rows.
 */
export const CATALOGUE = {
  // Seeing
  view_exact_location: { kind: "placed", roles: EVERYONE },
  view_colony_targets: { kind: "placed", roles: EVERYONE },
  view_needs_a_look: { kind: "placed", roles: EVERYONE },
  view_health_notes: { kind: "placed", roles: EVERYONE },
  view_welfare_queue: { kind: "island", roles: TEAM },
  view_colony_welfare_reports: { kind: "placed", roles: EVERYONE },
  // The workspace on admin.catspotters.com: the shared documents, the
  // document password and the lock switches (§6.3; SYC-222). Not a dashboard
  // capability: holding it never opens the dashboard door, and the dashboard
  // door never opens the workspace.
  use_workspace: { kind: "island", roles: TEAM },
  view_guardian_changes: { kind: "island", roles: TEAM },
  // Saying what you saw or know
  record_field_check: { kind: "placed", roles: EVERYONE },
  set_life_status: { kind: "placed", roles: EVERYONE },
  set_sterilisation: { kind: "placed", roles: EVERYONE },
  set_appearance: { kind: "placed", roles: EVERYONE },
  set_vaccination: { kind: "island", roles: TEAM },
  add_health_note: { kind: "placed", roles: EVERYONE },
  add_team_note: { kind: "island", roles: TEAM },
  change_report_state: { kind: "island", roles: TEAM },
  // Colonies, cats and feeding sites
  assign_cat_to_colony: { kind: "placed", roles: EVERYONE },
  create_colony: { kind: "own_scope", roles: EVERYONE },
  edit_colony: { kind: "placed", roles: EVERYONE },
  rename_colony: { kind: "island", roles: TEAM },
  add_feeding_site: { kind: "placed", roles: EVERYONE },
  edit_feeding_site: { kind: "placed", roles: EVERYONE },
  reassign_feeding_site: { kind: "island", roles: TEAM },
  set_site_public: { kind: "island", roles: TEAM },
  // The named areas (SYC-396 PR 2.4; dashboard §3.3).
  edit_named_areas: { kind: "island", roles: TEAM },
  // Find from a photo (SYC-396 PR 2.5; dashboard §5.2, §10.3). Never for a
  // guardian: matching anywhere stays reserved (match_cat_anywhere).
  find_cat_from_photo: { kind: "island", roles: TEAM },
  // The reports (SYC-396 PR 3.3a; dashboard §9.3). A cat guardian holds
  // view_reports for her own colonies, but her reports arrive on 16 Nov
  // (SYC-472): until then every report route is placed with no target, so it
  // answers for island rows only and she gets the 403. Downloads are the team's.
  view_reports: { kind: "placed", roles: EVERYONE },
  export_report: { kind: "island", roles: TEAM },
  request_site_public: { kind: "placed", roles: ["guardian"] },
  review_hand_picks: { kind: "placed", roles: EVERYONE },
  // Reserved (§6.2 note 3): no screen uses it yet.
  match_cat_anywhere: { kind: "role_wide", roles: EVERYONE },
  rename_cat: { kind: "island", roles: TEAM },
  hide_photo: { kind: "island", roles: TEAM },
  restore_photo: { kind: "island", roles: TEAM },
  remove_photo: { kind: "island", roles: TEAM },
  // Deciding, and running the list of people
  settle_confirmation: { kind: "island", roles: TEAM },
  manage_people: { kind: "island", roles: ["management"] },
  action_deletion_request: { kind: "island", roles: ["management"] },
  // Not yet in §6.2: added by the claim spec (claiming-a-cat.md §7, SYC-130),
  // and team-access §7.3 says the roles catalogue takes it in. The catalogue
  // test lists it as the one name cited from elsewhere, and checks that spec
  // still names it.
  remove_owner: { kind: "island", roles: TEAM },
} as const satisfies Record<string, CatalogueEntry>;

export type Capability = keyof typeof CATALOGUE;

export const CAPABILITIES = Object.keys(CATALOGUE) as Capability[];

export interface CapabilityHolder {
  scopes: {
    role: string;
    colonyId: number | null;
    /** Where the row applies (§10.1); the database keeps it in step with colonyId. */
    reach?: string;
  }[];
}

/** What a check is about: the colony, read from the record, never the request. */
export interface CapabilityTarget {
  colonyId?: number | null;
}

type Scope = CapabilityHolder["scopes"][number];


/**
 * A row that covers the whole island: a team or management row with no
 * colony. A guardian row with no colony (which the database refuses) covers
 * nothing, so bad data fails closed.
 */
function isIslandRow(s: Scope): boolean {
  return (
    (ISLAND_ROLES as readonly string[]).includes(s.role) &&
    s.colonyId === null &&
    (s.reach === undefined || s.reach === "island")
  );
}

/** A placement on one colony: never a team or management row. */
function isColonyRow(s: Scope): s is Scope & { colonyId: number } {
  return (
    !(ISLAND_ROLES as readonly string[]).includes(s.role) &&
    typeof s.colonyId === "number" &&
    Number.isInteger(s.colonyId) &&
    s.colonyId > 0 &&
    (s.reach === undefined || s.reach === "colony")
  );
}

/**
 * "No colony yet" (SYC-439; roles-and-invites-first-colony.md §4.3): a cat
 * guardian who may create her first colony and nothing else. Counts only if
 * the reach SAYS `start`: a row with no reach given, or any other, does not.
 * Read in exactly two places: can() for `create_colony`, and doorFor().
 * canSomewhere(), mayEnter() and capabilitiesOf() ignore it ON PURPOSE:
 * counting it there would open every page that only checks the door.
 */
function isStartRow(s: Scope): boolean {
  return s.role === "guardian" && s.colonyId === null && s.reach === "start";
}

/** Does this person hold a "no colony yet" row? */
export function holdsStartRow(person: CapabilityHolder): boolean {
  return person.scopes.some(isStartRow);
}

function entryOf(capability: Capability): CatalogueEntry | null {
  // Refuse anything not on the list, even if a caller gets past the type.
  if (!Object.prototype.hasOwnProperty.call(CATALOGUE, capability)) return null;
  return CATALOGUE[capability];
}

function rowsHolding(person: CapabilityHolder, entry: CatalogueEntry): Scope[] {
  return person.scopes.filter((s) =>
    (entry.roles as readonly string[]).includes(s.role),
  );
}

/**
 * May this person do this, here? Strict (Decision 4): a placed capability
 * with no target, or a target with no colony (a cat in no colony), answers
 * only for island rows.
 */
export function can(
  person: CapabilityHolder,
  capability: Capability,
  target?: CapabilityTarget,
): boolean {
  const entry = entryOf(capability);
  if (!entry) return false;
  const rows = rowsHolding(person, entry);
  switch (entry.kind) {
    case "island":
      return rows.some(isIslandRow);
    case "placed": {
      if (rows.some(isIslandRow)) return true;
      const colonyId = target?.colonyId;
      if (typeof colonyId !== "number") return false;
      return rows.some((s) => isColonyRow(s) && s.colonyId === colonyId);
    }
    case "role_wide":
      return rows.some((s) => isIslandRow(s) || isColonyRow(s));
    case "own_scope":
      // A start row grants `create_colony` and nothing else (SYC-439):
      // it is the one own-scope capability, and a test pins that.
      return rows.some(
        (s) =>
          isIslandRow(s) ||
          isColonyRow(s) ||
          (capability === "create_colony" && isStartRow(s)),
      );
  }
}

/**
 * Does this person hold this capability anywhere (an island row or any one
 * colony)? **Only for the dashboard door and for menus** (§6.4): never to
 * guard a route, which must ask can() with the record's target.
 */
export function canSomewhere(
  person: CapabilityHolder,
  capability: Capability,
): boolean {
  const entry = entryOf(capability);
  if (!entry) return false;
  const rows = rowsHolding(person, entry);
  if (entry.kind === "island") return rows.some(isIslandRow);
  return rows.some((s) => isIslandRow(s) || isColonyRow(s));
}

/**
 * Which `roleAtTime` a statement is written with (roles spec §10.4; SYC-53
 * plan, PR 0.2): the role under which the capability was granted for that
 * target, decided by the server from the person and the action and never
 * read from the request. A person who is staff and also a cat guardian,
 * using a team capability, writes `staff`; using a guardian-only capability
 * on her colony, she will write `guardian` (PR 2.2).
 *
 * Every caller passes the target it checked (the cat's colony, read from the
 * record; SYC-316), so a guardian's grant on that colony can be matched.
 *
 * Each of the person's scopes is asked on its own whether it grants the
 * capability, through can(), so this can never name a role can() wouldn't
 * honour. When several grant it, the team's roles are tried first, in the
 * one list's order (staff, management, vet), then the rest.
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

/**
 * Where a capability applies for one person (finding S13): `"island"`
 * through an island row; the colony ids of her placements for a placed one;
 * `"anywhere"` for a role-wide or own-scope capability held only through
 * placements (she may create a colony anywhere, but holds nothing island-wide).
 */
export type CapabilityWhere = "island" | "anywhere" | number[];

/** Every capability this person holds, and where, for GET /api/team/me. */
export function capabilitiesOf(
  person: CapabilityHolder,
): { capability: Capability; where: CapabilityWhere }[] {
  const out: { capability: Capability; where: CapabilityWhere }[] = [];
  for (const capability of CAPABILITIES) {
    if (!canSomewhere(person, capability)) continue;
    const entry = CATALOGUE[capability];
    const rows = rowsHolding(person, entry);
    if (rows.some(isIslandRow)) {
      out.push({ capability, where: "island" });
    } else if (entry.kind === "placed") {
      const colonies = [
        ...new Set(rows.filter(isColonyRow).map((s) => s.colonyId)),
      ].sort((a, b) => a - b);
      out.push({ capability, where: colonies });
    } else {
      out.push({ capability, where: "anywhere" });
    }
  }
  return out;
}

/** Does any of this person's rows cover the whole island (the team)? */
export function holdsIslandRow(person: CapabilityHolder): boolean {
  return person.scopes.some(isIslandRow);
}

/**
 * The dashboard door (roles spec §6.3): the hand-off, and the signed-in
 * pages that need no particular capability. Being in the people table is not
 * enough; they must hold at least one dashboard capability somewhere
 * (canSomewhere: a guardian on one colony is let in, and then refused, by
 * can(), everything not about her colonies). `use_workspace` doesn't count:
 * it is the other door.
 */
export function mayEnter(person: CapabilityHolder): boolean {
  return CAPABILITIES.some(
    (c) => c !== "use_workspace" && canSomewhere(person, c),
  );
}

/**
 * The three answers at the dashboard door (SYC-439; first-colony spec
 * §4.1), used by EVERY place that lets someone in: the hand-off, its
 * "already signed in" replay, the accept page, the sign-in Worker's
 * dashboard question and every dashboard request.
 * - `in`: mayEnter(), exactly as before.
 * - `starting`: holds nothing else, and a "no colony yet" row. She gets a
 *   session, then only the routes marked `starting` (and her own pages).
 * - `out`: everyone else, an ended placement and a vet included ("access
 *   has ended").
 */
export type Door = "in" | "starting" | "out";

export function doorFor(person: CapabilityHolder): Door {
  if (mayEnter(person)) return "in";
  if (holdsStartRow(person)) return "starting";
  return "out";
}

/** May this person be given a dashboard session at all? */
export function maySignIn(person: CapabilityHolder): boolean {
  return doorFor(person) !== "out";
}

/**
 * The workspace door (roles spec §6.3, §4.5; SYC-222): may the sign-in
 * Worker give this person a workspace session? Asked of can() by name, never
 * "holds any capability" and never mayEnter(): a cat guardian can hold the
 * dashboard door and must still be refused the workspace.
 */
export function mayUseWorkspace(person: CapabilityHolder): boolean {
  return can(person, "use_workspace");
}
