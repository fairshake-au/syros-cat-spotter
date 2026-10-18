import { describe, expect, it } from "vitest";
import { COAT_COLOURS } from "./appearance";
import { SEED_AREAS } from "./areas/namedAreas";
import { filtersToQuery, parseCatFilters } from "./teamCatFilters";
import { LAST_SEEN, LIVES, MARKS, SORTS, type CatListFilters } from "./teamCatList";

// SYC-396 PR 1.3, Task 1.3.2: filters in the web address, safely.

// What Express makes of a query string: repeated keys become arrays.
function parse(qs: string): CatListFilters {
  const u = new URLSearchParams(qs);
  const obj: Record<string, string | string[]> = {};
  for (const k of new Set(u.keys())) {
    const all = u.getAll(k);
    obj[k] = all.length > 1 ? all : all[0]!;
  }
  return parseCatFilters(obj);
}

describe("parseCatFilters and filtersToQuery", () => {
  it("round-trips every kind of filter", () => {
    const f: CatListFilters = {
      colours: ["brown", "ginger"],
      area: "kini",
      colony: 7,
      sterilised: ["probably", "not_known"],
      lives: ["street", "gone"],
      lastSeen: "1to3",
      q: "Mimi",
      sort: "name",
      page: 3,
    };
    expect(parse(filtersToQuery(f))).toEqual(f);
  });

  it("drops junk silently", () => {
    expect(
      parseCatFilters({
        colours: ["purple", "ginger", 5, {}],
        sterilised: "maybe",
        lives: ["flying"],
        lastSeen: "yesterday",
        sort: "random",
        page: "0",
        colony: "0",
      }),
    ).toEqual({ colours: ["ginger"] });
    expect(parseCatFilters(null)).toEqual({});
    expect(parseCatFilters("x")).toEqual({});
    expect(parseCatFilters({ q: ["a", "b"], area: ["kini"] })).toEqual({});
  });

  it("drops a position given as the area", () => {
    expect(parseCatFilters({ area: "37.4,24.9" })).toEqual({});
    expect(parseCatFilters({ area: "nowhere" })).toEqual({});
  });

  it("drops a colony given by name, a negative, a fraction or an enormous number", () => {
    for (const colony of ["Eleni", "-3", "2.5", "1e3", "99999999999999999999", " 4", ""]) {
      expect(parseCatFilters({ colony }), colony).toEqual({});
    }
    expect(parseCatFilters({ colony: "12" })).toEqual({ colony: 12 });
  });

  it("cuts a long name box at 100 characters and ignores a blank one", () => {
    expect(parseCatFilters({ q: "a".repeat(150) }).q).toHaveLength(100);
    expect(parseCatFilters({ q: "   " })).toEqual({});
  });

  it("leaves page 1 out of the address", () => {
    expect(filtersToQuery({ page: 1 })).toBe("");
    expect(filtersToQuery({ page: 2 })).toBe("page=2");
  });

  it("carries the search box's text as typed, capped at 100 characters (D11)", () => {
    expect(parse(filtersToQuery({ q: "37.44471,24.94176" })).q).toBe("37.44471,24.94176");
    expect(filtersToQuery({ q: "x".repeat(150) })).toBe(`q=${"x".repeat(100)}`);
  });

  it("never writes a coordinate from any field but the search box (seeded fuzz, 200 objects)", () => {
    let seed = 0x5eed1234;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const some = <T,>(xs: readonly T[]) => xs.filter(() => rnd() < 0.4);
    const lat = () => (35 + rnd() * 5).toFixed(2 + Math.floor(rnd() * 6));
    const lng = () => (23 + rnd() * 3).toFixed(2 + Math.floor(rnd() * 6));
    const junk = () => pick([`${lat()},${lng()}`, lat(), `near ${lat()} ${lng()}`, "Eleni", "a name"]);
    const areaKeys = SEED_AREAS.map((a) => a.key);
    for (let i = 0; i < 200; i++) {
      // q is left out: the search box's own text may be anything (D11).
      const f = {
        colours: some(COAT_COLOURS),
        area: rnd() < 0.5 ? pick(SEED_AREAS).key : junk(),
        colony: rnd() < 0.5 ? Math.floor(rnd() * 500) : Number(lat()),
        sterilised: some(MARKS),
        lives: some(LIVES),
        lastSeen: rnd() < 0.5 ? pick(LAST_SEEN) : junk(),
        sort: pick(SORTS),
        page: Math.floor(rnd() * 5),
      } as unknown as CatListFilters;
      const out = filtersToQuery(f);
      const params = new URLSearchParams(out);
      expect(out, JSON.stringify(f)).not.toMatch(/\d+\.\d{3,}/);
      expect(decodeURIComponent(out.replace(/\+/g, " ")), JSON.stringify(f)).not.toMatch(/\d+[.,]\d{3,}/);
      // The colony is a whole number, the area one of our keys.
      if (params.has("colony")) expect(params.get("colony"), out).toMatch(/^[1-9]\d*$/);
      if (params.has("area")) expect(areaKeys, out).toContain(params.get("area"));
      // Whatever is written reads back as the same address.
      expect(filtersToQuery(parse(out)), out).toBe(out);
    }
  });
});
