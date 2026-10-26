import { describe, expect, it } from "vitest";
import { competitionRanks } from "./ranking";

describe("competitionRanks", () => {
  it("gives 1,1,3 for 120,120,95", () => {
    const ranked = competitionRanks(
      [{ p: 120 }, { p: 120 }, { p: 95 }],
      (r) => r.p,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("keeps the rows and gives an empty list back", () => {
    expect(competitionRanks([], (r: { p: number }) => r.p)).toEqual([]);
    expect(competitionRanks([{ p: 5, n: "a" }], (r) => r.p)).toEqual([
      { p: 5, n: "a", rank: 1 },
    ]);
  });

  it("skips places after a shared one, and a later run restarts at its own position", () => {
    const ranked = competitionRanks(
      [{ p: 9 }, { p: 9 }, { p: 9 }, { p: 4 }, { p: 4 }, { p: 1 }],
      (r) => r.p,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4, 4, 6]);
  });
});
