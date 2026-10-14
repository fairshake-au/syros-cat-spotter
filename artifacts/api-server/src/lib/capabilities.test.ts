import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  actingRole,
  can,
  capabilitiesOf,
  mayEnter,
  mayUseWorkspace,
} from "./capabilities";

// can() is the only place a permission is decided (SYC-43 part 1 plan §7,
// test 19; spec §7.1, §7.3).

const staff = { scopes: [{ role: "staff", colonyId: null }] };
const guardian = { scopes: [{ role: "guardian", colonyId: 3 }] };
const volunteerAndVet = {
  scopes: [
    { role: "volunteer", colonyId: null },
    { role: "vet", colonyId: null },
  ],
};
const nobody = { scopes: [] };

describe("can()", () => {
  it("names exactly the seventeen capabilities (§7.3, plus SYC-209's three, SYC-130's remove_owner, D6, and use_workspace, roles spec §6.3)", () => {
    expect([...CAPABILITIES]).toEqual([
      "view_exact_location",
      "hide_photo",
      "restore_photo",
      "rename_cat",
      "rename_colony",
      "create_colony",
      "edit_colony",
      "assign_cat_to_colony",
      "set_life_status",
      "remove_owner",
      "set_sterilisation",
      "set_site_public",
      "change_report_state",
      "add_team_note",
      "manage_people",
      "action_deletion_request",
      "use_workspace",
    ]);
  });

  it("gives staff all seventeen", () => {
    for (const c of CAPABILITIES) expect(can(staff, c)).toBe(true);
    expect(capabilitiesOf(staff)).toHaveLength(17);
  });

  it("gives guardian, volunteer, vet and no role none", () => {
    for (const person of [guardian, volunteerAndVet, nobody]) {
      for (const c of CAPABILITIES) {
        expect(can(person, c, { colonyId: 3 })).toBe(false);
      }
      expect(capabilitiesOf(person)).toEqual([]);
    }
  });

  it("refuses a capability name that isn't on the list, and tsc refuses it too", () => {
    // @ts-expect-error: an unknown capability name is a type error.
    expect(can(staff, "be_staff")).toBe(false);
  });
});

describe("mayEnter() (SYC-188)", () => {
  it("lets staff in, including staff who also hold another role", () => {
    expect(mayEnter(staff)).toBe(true);
    expect(mayEnter({ scopes: [...guardian.scopes, ...staff.scopes] })).toBe(
      true,
    );
  });

  it("keeps out guardian, volunteer, vet and no role, while those grant nothing", () => {
    for (const person of [guardian, volunteerAndVet, nobody]) {
      expect(mayEnter(person)).toBe(false);
    }
  });
});

describe("mayUseWorkspace(), the workspace door (SYC-53 PR 0.4; roles spec §6.3, T27 part)", () => {
  const management = { scopes: [{ role: "management", colonyId: null }] };

  it("is true for staff, exactly the people who get the workspace today", () => {
    expect(mayUseWorkspace(staff)).toBe(true);
    expect(
      mayUseWorkspace({ scopes: [...guardian.scopes, ...staff.scopes] }),
    ).toBe(true);
  });

  it("is false for a cat guardian, a vet, management alone (can() is still staff-only) and no role", () => {
    for (const person of [guardian, volunteerAndVet, management, nobody]) {
      expect(mayUseWorkspace(person)).toBe(false);
    }
  });

  it("matches can(person, 'use_workspace') for every kind of person", () => {
    for (const person of [staff, guardian, volunteerAndVet, management, nobody]) {
      expect(mayUseWorkspace(person)).toBe(can(person, "use_workspace"));
    }
  });

  // While can() is staff-only, mayEnter and mayUseWorkspace agree for every
  // possible person, so no behaviour test can tell them apart until PR 0.5.
  // This pins how each door is decided, so swapping one for the other (the
  // plan's T27 probe) fails now rather than when a guardian first holds a
  // dashboard capability. internal.doors.future.test.ts covers the route.
  it("each door is decided by its own rule: the workspace by use_workspace, never by mayEnter; the dashboard never counts use_workspace", () => {
    const source = readFileSync(new URL("./capabilities.ts", import.meta.url), "utf8");
    const body = (name: string) => {
      const start = source.indexOf(`export function ${name}(`);
      expect(start, `${name} not found`).toBeGreaterThan(-1);
      const end = source.indexOf("\n}\n", start);
      return source.slice(start, end);
    };
    const workspace = body("mayUseWorkspace");
    expect(workspace).toContain('can(person, "use_workspace")');
    expect(workspace).not.toMatch(/mayEnter|CAPABILITIES|some\(/);
    expect(body("mayEnter")).toContain('c !== "use_workspace"');
  });
});

describe("actingRole() (SYC-53 PR 0.2; roles spec §10.4, test 23)", () => {
  it("returns staff for every team member today, for every capability", () => {
    for (const c of CAPABILITIES) {
      expect(actingRole(staff, c)).toBe("staff");
      expect(actingRole(staff, c, { colonyId: 3 })).toBe("staff");
    }
  });

  it("a staff member who is also a guardian writes staff for a team capability, whatever order her scopes are in", () => {
    for (const both of [
      { scopes: [...guardian.scopes, ...staff.scopes] },
      { scopes: [...staff.scopes, ...guardian.scopes] },
    ]) {
      for (const c of CAPABILITIES) expect(actingRole(both, c, { colonyId: 3 })).toBe("staff");
    }
  });

  it("never names a role can() doesn't grant: a person whose scopes grant nothing is refused", () => {
    for (const person of [guardian, volunteerAndVet, nobody]) {
      for (const c of CAPABILITIES) {
        expect(() => actingRole(person, c, { colonyId: 3 })).toThrow(/no scope grants/);
      }
    }
  });
});
