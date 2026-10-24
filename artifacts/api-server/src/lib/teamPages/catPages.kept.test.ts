import { describe, expect, it } from "vitest";
import { catPageFormKeys } from "./catPages";
import type { TeamCatView } from "../teamCatView";
import type { Capability } from "../capabilities";

// SYC-516 C3 fix 2: the cat page uses a kept row only for a form it draws
// for this viewer, so a row is never used up with nothing to show it.

const view = {
  cat: { id: 5 },
  history: [
    { id: 41, correction: { kind: "life_status", now: "street" } },
    { id: 42, correction: { kind: "sterilised", now: true } },
    { id: 43, correction: { kind: "appearance" } },
    { id: 44, correction: null },
  ],
} as unknown as TeamCatView;

const holding = (...caps: Capability[]) => (c: Capability) => caps.includes(c);

describe("catPageFormKeys", () => {
  it("a viewer without rename doesn't accept a name: row; with it, does", () => {
    expect(catPageFormKeys(view, holding("set_life_status"))("name:5")).toBe(false);
    expect(catPageFormKeys(view, holding("rename_cat"))("name:5")).toBe(true);
  });

  it("a note: row only for someone who may add a team note, and only for this cat", () => {
    expect(catPageFormKeys(view, holding("rename_cat"))("note:5")).toBe(false);
    expect(catPageFormKeys(view, holding("add_team_note"))("note:5")).toBe(true);
    expect(catPageFormKeys(view, holding("add_team_note"))("note:6")).toBe(false);
  });

  it("each form only for the capability that draws it", () => {
    const life = catPageFormKeys(view, holding("set_life_status"));
    expect(["life:5", "sterilised:5", "wrong:41", "wrong:42"].map(life)).toEqual([true, false, true, false]);
    const ster = catPageFormKeys(view, holding("set_sterilisation"));
    expect(["life:5", "sterilised:5", "wrong:41", "wrong:42"].map(ster)).toEqual([false, true, false, true]);
  });

  it("never a colour/markings statement, one with no correction, or another cat's form", () => {
    const all = catPageFormKeys(view, () => true);
    expect(["wrong:43", "wrong:44", "name:6", "life:6"].map(all)).toEqual([false, false, false, false]);
  });
});
