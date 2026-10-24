import { describe, expect, it } from "vitest";
import { colonyCatRows, sortForPlanner, type ColonyCatRow } from "./colonyCatRows";
import type { SterilisedMark } from "../teamCatList";

// SYC-619 Task 8 (spec §7.2, D3; redesign §9.2): a colony's cats in the
// trapping planner's order.

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10));
let n = 0;
const row = (name: string, mark: SterilisedMark | null, lastSeenAt: Date | null): ColonyCatRow => ({
  id: (n += 1),
  syr: `SYR-${n}`,
  name,
  photoUrl: null,
  mark,
  lastSeenAt,
});
const names = (rows: ColonyCatRow[]) => rows.map((r) => r.name);

describe("sortForPlanner", () => {
  it("puts the groups in order: not sterilised, not known, probably, sterilised, then no mark", () => {
    const rows = [
      row("none", null, day(9)),
      row("ster", "sterilised", day(9)),
      row("prob", "probably", day(9)),
      row("unknown", "not_known", day(9)),
      row("not", "not_sterilised", day(9)),
    ];
    expect(names(sortForPlanner(rows))).toEqual(["not", "unknown", "prob", "ster", "none"]);
  });

  it("within each group the latest seen comes first and never seen comes last", () => {
    for (const mark of ["not_sterilised", "not_known", "probably", "sterilised", null] as const) {
      const rows = [row("old", mark, day(1)), row("never", mark, null), row("new", mark, day(20)), row("mid", mark, day(5))];
      expect(names(sortForPlanner(rows)), String(mark)).toEqual(["new", "mid", "old", "never"]);
    }
  });

  it("breaks remaining ties by name, for the same day and for never seen", () => {
    const rows = [
      row("Zoe", "not_known", day(3)),
      row("anna", "not_known", day(3)),
      row("Mimi", "not_known", null),
      row("Bob", "not_known", null),
    ];
    expect(names(sortForPlanner(rows))).toEqual(["anna", "Zoe", "Bob", "Mimi"]);
  });

  it("a group's order never beats the group order: a sterilised cat seen today stays below a not-known cat never seen", () => {
    const rows = [row("today", "sterilised", day(22)), row("never", "not_known", null)];
    expect(names(sortForPlanner(rows))).toEqual(["never", "today"]);
  });

  it("returns a new array and leaves the one given alone", () => {
    const rows = [row("b", "sterilised", null), row("a", "not_sterilised", null)];
    const sorted = sortForPlanner(rows);
    expect(sorted).not.toBe(rows);
    expect(names(rows)).toEqual(["b", "a"]);
  });
});

describe("colonyCatRows", () => {
  it("joins each colony cat to its mark and last seen by id, and sorts them", () => {
    const cats = [
      { id: 1, syr: "SYR-1", name: "Ster", photoUrl: null },
      { id: 2, syr: "SYR-2", name: "Not", photoUrl: "/p.jpg" },
    ];
    const rows = colonyCatRows(cats, [
      { id: 2, mark: "not_sterilised", lastSeenAt: day(4) },
      { id: 1, mark: "sterilised", lastSeenAt: null },
      { id: 99, mark: "not_known", lastSeenAt: day(9) },
    ]);
    expect(rows).toEqual([
      { id: 2, syr: "SYR-2", name: "Not", photoUrl: "/p.jpg", mark: "not_sterilised", lastSeenAt: day(4) },
      { id: 1, syr: "SYR-1", name: "Ster", photoUrl: null, mark: "sterilised", lastSeenAt: null },
    ]);
  });

  it("a record loadTeamCats leaves out (a merged-away half) keeps its row, with no mark and no date", () => {
    const rows = colonyCatRows([{ id: 7, syr: "SYR-7", name: "Away", photoUrl: null }], []);
    expect(rows).toEqual([{ id: 7, syr: "SYR-7", name: "Away", photoUrl: null, mark: null, lastSeenAt: null }]);
  });
});
