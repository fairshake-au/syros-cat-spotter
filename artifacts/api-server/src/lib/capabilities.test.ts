import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  CATALOGUE,
  actingRole,
  can,
  canSomewhere,
  capabilitiesOf,
  holdsIslandRow,
  mayEnter,
  mayUseWorkspace,
  type Capability,
} from "./capabilities";

// can() is the only place a permission is decided (roles-and-invites.md §6;
// SYC-53 PR 0.5). The catalogue itself is compared with the spec's own table
// in capabilities.catalogue.test.ts (T24).

const staff = { scopes: [{ role: "staff", colonyId: null, reach: "island" }] };
const management = { scopes: [{ role: "management", colonyId: null, reach: "island" }] };
const guardian = { scopes: [{ role: "guardian", colonyId: 3, reach: "colony" }] };
const guardianOnTwo = {
  scopes: [
    { role: "guardian", colonyId: 3, reach: "colony" },
    { role: "guardian", colonyId: 7, reach: "colony" },
  ],
};
const vet = { scopes: [{ role: "vet", colonyId: null, reach: "island" }] };
const nobody = { scopes: [] };

const ofKind = (kind: string) =>
  CAPABILITIES.filter((c) => CATALOGUE[c].kind === kind);
const PLACED = ofKind("placed");
const ISLAND = ofKind("island");

describe("the catalogue (roles spec §6.2)", () => {
  it("has a kind and at least one role for every name, and no name twice", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    for (const c of CAPABILITIES) {
      expect(["island", "placed", "role_wide", "own_scope"]).toContain(CATALOGUE[c].kind);
      expect(CATALOGUE[c].roles.length, c).toBeGreaterThan(0);
    }
  });

  it("never gives a cat guardian an island-only capability", () => {
    for (const c of ISLAND) {
      expect(CATALOGUE[c].roles as readonly string[], c).not.toContain("guardian");
    }
  });

  it("refuses a capability name that isn't on the list, and tsc refuses it too", () => {
    // @ts-expect-error: an unknown capability name is a type error.
    expect(can(staff, "be_staff")).toBe(false);
    // @ts-expect-error: nor is anything on Object.prototype a capability.
    expect(can(staff, "toString")).toBe(false);
    // @ts-expect-error: same for canSomewhere.
    expect(canSomewhere(staff, "constructor")).toBe(false);
  });
});

describe("T15 (part): manage_people and action_deletion_request are management's", () => {
  it("a team-only member holds neither; a management member holds both", () => {
    for (const c of ["manage_people", "action_deletion_request"] as const) {
      expect(can(staff, c), c).toBe(false);
      expect(canSomewhere(staff, c), c).toBe(false);
      expect(can(management, c), c).toBe(true);
    }
  });

  it("the team holds everything else that isn't a guardian's own ask", () => {
    for (const c of CAPABILITIES) {
      const expected = !["manage_people", "action_deletion_request", "request_site_public"].includes(c);
      expect(can(staff, c), c).toBe(expected);
    }
  });

  it("management holds what the team holds, and the two management powers", () => {
    for (const c of CAPABILITIES) {
      expect(can(management, c), c).toBe(c !== "request_site_public");
    }
  });
});

describe("strict can() (Decision 4)", () => {
  it("a placed capability with no target, or a cat in no colony, answers for island rows only", () => {
    for (const c of PLACED) {
      expect(can(guardian, c), `${c} with no target`).toBe(false);
      expect(can(guardian, c, {}), `${c} with an empty target`).toBe(false);
      expect(can(guardian, c, { colonyId: null }), `${c} for a cat in no colony`).toBe(false);
    }
    for (const c of PLACED.filter((p) => p !== "request_site_public")) {
      expect(can(staff, c), c).toBe(true);
      expect(can(staff, c, { colonyId: null }), c).toBe(true);
      expect(can(staff, c, { colonyId: 99 }), c).toBe(true);
    }
  });

  it("a guardian holds a placed capability for exactly her own colonies", () => {
    for (const c of PLACED) {
      expect(can(guardian, c, { colonyId: 3 }), c).toBe(true);
      expect(can(guardian, c, { colonyId: 4 }), c).toBe(false);
      expect(can(guardianOnTwo, c, { colonyId: 7 }), c).toBe(true);
      expect(can(guardianOnTwo, c, { colonyId: 8 }), c).toBe(false);
    }
  });

  it("T3: a guardian placed on many colonies still holds nothing island-only, with or without a target", () => {
    const everywhere = {
      scopes: Array.from({ length: 40 }, (_, i) => ({ role: "guardian", colonyId: i + 1, reach: "colony" })),
    };
    for (const c of ISLAND) {
      expect(can(everywhere, c), c).toBe(false);
      expect(can(everywhere, c, { colonyId: 1 }), c).toBe(false);
      expect(canSomewhere(everywhere, c), c).toBe(false);
    }
    expect(can(everywhere, "view_welfare_queue")).toBe(false);
    expect(can(everywhere, "view_exact_location")).toBe(false);
  });

  it("a row that breaks the database's rules grants nothing: a guardian with no colony, a team row on a colony", () => {
    const islandGuardian = { scopes: [{ role: "guardian", colonyId: null, reach: "island" }] };
    const guardianNoReach = { scopes: [{ role: "guardian", colonyId: null }] };
    const placedStaff = { scopes: [{ role: "staff", colonyId: 3, reach: "colony" }] };
    const mismatched = { scopes: [{ role: "guardian", colonyId: 3, reach: "island" }] };
    for (const person of [islandGuardian, guardianNoReach, placedStaff, mismatched]) {
      for (const c of CAPABILITIES) {
        expect(can(person, c), c).toBe(false);
        expect(can(person, c, { colonyId: 3 }), c).toBe(false);
        expect(canSomewhere(person, c), c).toBe(false);
      }
      expect(mayEnter(person)).toBe(false);
    }
  });

  it("role-wide and own-scope capabilities need any row of a role that holds them", () => {
    for (const c of ["create_colony", "match_cat_anywhere"] as const) {
      expect(can(guardian, c), c).toBe(true);
      expect(can(staff, c), c).toBe(true);
      expect(can(vet, c), c).toBe(false);
      expect(can(nobody, c), c).toBe(false);
    }
  });

  it("vets (reserved) and someone with no roles hold nothing", () => {
    for (const person of [vet, nobody]) {
      for (const c of CAPABILITIES) {
        expect(can(person, c, { colonyId: 3 }), c).toBe(false);
        expect(canSomewhere(person, c), c).toBe(false);
      }
      expect(capabilitiesOf(person)).toEqual([]);
    }
  });
});

describe("canSomewhere(): for the door and menus only", () => {
  it("answers 'any colony?' for a placed capability, and stays island-only for an island one", () => {
    expect(canSomewhere(guardian, "view_exact_location")).toBe(true);
    expect(canSomewhere(guardian, "view_welfare_queue")).toBe(false);
    expect(canSomewhere(staff, "view_welfare_queue")).toBe(true);
  });

  it("is never what a route asks: no route file calls it", () => {
    const routes = join(__dirname, "../routes");
    const middlewares = join(__dirname, "../middlewares");
    for (const dir of [routes, middlewares]) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        expect(readFileSync(join(dir, name), "utf8"), name).not.toContain("canSomewhere");
      }
    }
  });
});

describe("capabilitiesOf(): what /me says, and where (finding S13)", () => {
  it("the team: everything held, island-wide", () => {
    const held = capabilitiesOf(staff);
    expect(held.every((h) => h.where === "island")).toBe(true);
    expect(held.map((h) => h.capability)).not.toContain("manage_people");
  });

  it("a guardian on two colonies: placed ones with her colony ids, create_colony anywhere, nothing island-wide", () => {
    const held = Object.fromEntries(capabilitiesOf(guardianOnTwo).map((h) => [h.capability, h.where]));
    expect(held["view_exact_location"]).toEqual([3, 7]);
    expect(held["request_site_public"]).toEqual([3, 7]);
    expect(held["create_colony"]).toBe("anywhere");
    expect(held["view_welfare_queue"]).toBeUndefined();
    expect(Object.values(held)).not.toContain("island");
  });

  it("a team member who is also a guardian holds everything island-wide", () => {
    const both = { scopes: [...guardian.scopes, ...staff.scopes] };
    expect(capabilitiesOf(both).every((h) => h.where === "island" || h.capability === "request_site_public")).toBe(true);
    expect(holdsIslandRow(both)).toBe(true);
    expect(holdsIslandRow(guardian)).toBe(false);
  });
});

describe("mayEnter(), the dashboard door", () => {
  it("lets in the team, management, and a guardian placed on a colony", () => {
    for (const person of [staff, management, guardian, guardianOnTwo]) {
      expect(mayEnter(person)).toBe(true);
    }
  });

  it("keeps out a vet and someone with no roles (an ended placement is dropped before this is asked)", () => {
    for (const person of [vet, nobody]) expect(mayEnter(person)).toBe(false);
  });

  it("use_workspace alone doesn't open it", () => {
    const source = readFileSync(new URL("./capabilities.ts", import.meta.url), "utf8");
    const start = source.indexOf("export function mayEnter(");
    expect(source.slice(start, source.indexOf("\n}\n", start))).toContain('c !== "use_workspace"');
  });
});

describe("T27: the workspace door is the team's and management's only", () => {
  it("is open to the team and management, and shut to a guardian who holds the dashboard door", () => {
    expect(mayUseWorkspace(staff)).toBe(true);
    expect(mayUseWorkspace(management)).toBe(true);
    for (const person of [guardian, guardianOnTwo, vet, nobody]) {
      expect(mayUseWorkspace(person)).toBe(false);
    }
    // The case that matters: in at the dashboard, still out of the workspace.
    expect(mayEnter(guardian)).toBe(true);
    expect(mayUseWorkspace(guardian)).toBe(false);
  });

  it("is decided by use_workspace through can(), never by mayEnter", () => {
    const source = readFileSync(new URL("./capabilities.ts", import.meta.url), "utf8");
    const start = source.indexOf("export function mayUseWorkspace(");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    // The whole body is the one statement (PR 0.4's pin): nothing else
    // (mayEnter, "holds any capability", an extra `||`) may decide it.
    expect(body.slice(body.indexOf("{") + 1).trim()).toBe('return can(person, "use_workspace");');
  });
});

describe("actingRole() (roles spec §10.4, test 23; SYC-316)", () => {
  it("returns staff for every team member, for every capability the team holds", () => {
    for (const c of CAPABILITIES.filter((x) => can(staff, x))) {
      expect(actingRole(staff, c)).toBe("staff");
      expect(actingRole(staff, c, { colonyId: 3 })).toBe("staff");
    }
  });

  it("a team member who is also a guardian writes the team's role, whatever order her rows are in", () => {
    for (const both of [
      { scopes: [...guardian.scopes, ...staff.scopes] },
      { scopes: [...staff.scopes, ...guardian.scopes] },
    ]) {
      for (const c of CAPABILITIES.filter((x) => can(staff, x))) {
        expect(actingRole(both, c, { colonyId: 3 })).toBe("staff");
      }
    }
  });

  it("matches a guardian's grant only with her colony as the target", () => {
    expect(actingRole(guardian, "set_sterilisation", { colonyId: 3 })).toBe("guardian");
    expect(() => actingRole(guardian, "set_sterilisation")).toThrow(/no scope grants/);
    expect(() => actingRole(guardian, "set_sterilisation", { colonyId: 4 })).toThrow(/no scope grants/);
    expect(() => actingRole(guardian, "rename_cat", { colonyId: 3 })).toThrow(/no scope grants/);
  });

  it("management alone writes management", () => {
    expect(actingRole(management, "set_life_status", { colonyId: 3 })).toBe("management");
  });

  it("SYC-316: every caller in the api-server passes a target", () => {
    const src = join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith("capabilities.ts")) files.push(p);
      }
    };
    walk(src);
    let calls = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/actingRole\(([^()]*(?:\([^()]*(?:\([^()]*\))?[^()]*\))?[^()]*)\)/g)) {
        calls++;
        const args = m[1]!.split(",").filter((a) => a.trim() !== "");
        expect(args.length, `${f}: actingRole(${m[1]}) names no target`).toBeGreaterThanOrEqual(3);
        // ...and the target is read from the record (catTarget), or a
        // `target` the caller already read that way.
        expect(m[1], `${f}: actingRole(${m[1]})`).toMatch(/catTarget\(|\btarget\b/);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(7);
  });
});

// Typed so a renamed capability is a compile error here, not a silent pass.
const _named: Capability[] = ["view_welfare_queue", "use_workspace", "remove_owner", "remove_photo"];
void _named;
