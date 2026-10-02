import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, capabilitiesOf } from "./capabilities";

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
  it("names exactly the twelve capabilities of §7.3", () => {
    expect([...CAPABILITIES]).toEqual([
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
    ]);
  });

  it("gives staff all twelve", () => {
    for (const c of CAPABILITIES) expect(can(staff, c)).toBe(true);
    expect(capabilitiesOf(staff)).toHaveLength(12);
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
