import { describe, expect, it } from "vitest";
import type { ColonyFigures, ColonyFlag } from "./colonyFigures";
import type { Split } from "./countedCats";
import { rankTrapNext, TRAP_NEXT_LIMIT } from "./trapNext";

// SYC-603, spec §4.2: Where to trap next. Pure: figures and names go in, the
// ranked colonies come out.

function fig(id: number, split: Partial<Split>, flags: ColonyFlag[] = []): ColonyFigures {
  const s: Split = { sterilised: 0, probably: 0, not_sterilised: 0, not_known: 0, ...split };
  const street = s.sterilised + s.probably + s.not_sterilised + s.not_known;
  return {
    colonyId: id,
    street,
    split: s,
    confirmedPct: null,
    catCount: street,
    latestSightingAt: null,
    flags,
    guardianNames: [],
  };
}

const figures = (...fs: ColonyFigures[]) => new Map(fs.map((f) => [f.colonyId, f]));
const names = (entries: [number, string][]) => new Map(entries);

describe("rankTrapNext", () => {
  it("ranks by most to do", () => {
    const out = rankTrapNext(
      figures(fig(1, { not_sterilised: 2 }), fig(2, { not_sterilised: 9 }), fig(3, { not_known: 5 })),
      names([[1, "A"], [2, "B"], [3, "C"]]),
    );
    expect(out.map((c) => c.toDo)).toEqual([9, 5, 2]);
    expect(out.map((c) => c.colonyId)).toEqual([2, 3, 1]);
  });

  it("breaks ties: kittens first, then name", () => {
    const out = rankTrapNext(
      figures(fig(1, { not_sterilised: 4 }), fig(2, { not_sterilised: 4 }), fig(3, { not_sterilised: 4 }, ["kittens", "growing"])),
      names([[1, "Vari"], [2, "Kini"], [3, "Azolimnos"]]),
    );
    expect(out.map((c) => c.name)).toEqual(["Azolimnos", "Kini", "Vari"]);
    expect(out.map((c) => c.kittens)).toEqual([true, false, false]);
  });

  it("never lists a colony with nothing to do", () => {
    expect(rankTrapNext(figures(fig(1, { sterilised: 6 })), names([[1, "Done"]]))).toEqual([]);
    expect(rankTrapNext(figures(fig(2, {})), names([[2, "Empty"]]))).toEqual([]);
  });

  it("counts probably as to do", () => {
    const [c] = rankTrapNext(
      figures(fig(1, { sterilised: 1, probably: 2, not_known: 1, not_sterilised: 3 })),
      names([[1, "Kini"]]),
    );
    expect(c).toMatchObject({ colonyId: 1, name: "Kini", toDo: 6, street: 7, sterilised: 1, kittens: false });
    expect(c!.split).toEqual({ sterilised: 1, probably: 2, not_known: 1, not_sterilised: 3 });
  });

  it("stops at three and skips colonies it can't name", () => {
    const out = rankTrapNext(
      figures(
        fig(1, { not_sterilised: 1 }),
        fig(2, { not_sterilised: 2 }),
        fig(3, { not_sterilised: 3 }),
        fig(4, { not_sterilised: 4 }),
        fig(5, { not_sterilised: 50 }),
      ),
      names([[1, "A"], [2, "B"], [3, "C"], [4, "D"]]),
    );
    expect(TRAP_NEXT_LIMIT).toBe(3);
    expect(out.map((c) => c.colonyId)).toEqual([4, 3, 2]);
  });
});
