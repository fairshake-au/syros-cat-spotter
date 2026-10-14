import { describe, expect, it } from "vitest";
import { CAPABILITIES, actingRole, can, capabilitiesOf, mayEnter } from "./capabilities";

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
  it("names exactly the sixteen capabilities (§7.3, plus SYC-209's three and SYC-130's remove_owner, D6)", () => {
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
    ]);
  });

  it("gives staff all sixteen", () => {
    for (const c of CAPABILITIES) expect(can(staff, c)).toBe(true);
    expect(capabilitiesOf(staff)).toHaveLength(16);
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
