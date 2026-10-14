import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, capabilitiesOf, mayEnter } from "./capabilities";

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
  it("names exactly the thirteen capabilities of §7.3 and the roles catalogue (remove_owner: SYC-130, D6)", () => {
    expect([...CAPABILITIES]).toEqual([
      "view_exact_location",
      "hide_photo",
      "restore_photo",
      "rename_cat",
      "rename_colony",
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

  it("gives staff all thirteen", () => {
    for (const c of CAPABILITIES) expect(can(staff, c)).toBe(true);
    expect(capabilitiesOf(staff)).toHaveLength(13);
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
