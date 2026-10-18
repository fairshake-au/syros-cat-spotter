import { describe, expect, it } from "vitest";
import type { TeamCat } from "../teamCatList";
import type { CatSnapshot } from "../resolve";
import { MARKS } from "../teamCatList";
import { headline, isActive, isStreet, NOT_SEEN_LATELY_DAYS, notSeenLately, splitOf, toDo } from "./countedCats";

// SYC-396 PR 2.0, Task 2.0.2: who is counted (spec §9.5), over hand-built cats.

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
let next = 1;

function fake(over: Partial<TeamCat> = {}): TeamCat {
  const id = next++;
  return {
    id,
    name: `cat-${id}`,
    syr: `SYR-${String(id).padStart(4, "0")}`,
    photoPublicId: null,
    coat: [],
    pattern: null,
    colonyId: null,
    mark: "not_known",
    lives: "street",
    lastSeenAt: null,
    lastSeen: null,
    placedAt: { lat: 37.4447, lng: 24.9417 },
    place: "Ermoupoli",
    notSeenSince: null,
    createdAt: daysAgo(100),
    snapshot: {} as CatSnapshot,
    areaKey: "ermoupoli",
    ...over,
  };
}

// The Arizona test report's kind: on the street, but Off Syros.
const arizona = () => fake({ areaKey: "off", place: "Off Syros", mark: "not_sterilised", lastSeenAt: daysAgo(100) });

describe("isStreet and isActive", () => {
  it("a street cat on Syros is street and active", () => {
    const c = fake();
    expect(isStreet(c)).toBe(true);
    expect(isActive(c)).toBe(true);
  });
  it("homed and in care are active, not street; gone is neither", () => {
    expect(isStreet(fake({ lives: "homed" }))).toBe(false);
    expect(isActive(fake({ lives: "in_care" }))).toBe(true);
    expect(isStreet(fake({ lives: "gone" }))).toBe(false);
    expect(isActive(fake({ lives: "gone" }))).toBe(false);
  });
  it("Off Syros is never a street cat", () => {
    expect(isStreet(arizona())).toBe(false);
  });
});

describe("headline", () => {
  it("counts street cats in street and split; homed and in care separately; gone nowhere", () => {
    const cats = [
      fake({ mark: "sterilised" }),
      fake({ mark: "sterilised" }),
      fake({ mark: "probably" }),
      fake({ mark: "not_sterilised" }),
      fake({ mark: "not_known" }),
      fake({ lives: "homed", mark: "sterilised" }),
      fake({ lives: "in_care", mark: "not_known" }),
      fake({ lives: "in_care", mark: "sterilised" }),
      fake({ lives: "gone", mark: "not_sterilised" }),
    ];
    const h = headline(cats, NOW);
    expect(h.street).toBe(5);
    expect(h.split).toEqual({ sterilised: 2, probably: 1, not_sterilised: 1, not_known: 1 });
    expect(h.homed).toBe(1);
    expect(h.inCare).toBe(2);
    expect(h.at).toBe(NOW);
  });

  it("an empty island is all zeros", () => {
    expect(headline([], NOW)).toEqual({
      street: 0,
      split: { sterilised: 0, probably: 0, not_sterilised: 0, not_known: 0 },
      homed: 0,
      inCare: 0,
      at: NOW,
    });
  });
});

describe("splitOf", () => {
  it("sums to the street count, over 200 random cats", () => {
    // A small fixed-seed generator, so a failure can be replayed.
    let seed = 396;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const cats = Array.from({ length: 200 }, () =>
      fake({
        mark: pick(MARKS),
        lives: pick(["street", "homed", "in_care", "gone"] as const),
        areaKey: rand() < 0.1 ? "off" : "kini",
      }),
    );
    const split = splitOf(cats);
    const sum = Object.values(split).reduce((a, b) => a + b, 0);
    expect(sum).toBe(headline(cats, NOW).street);
    expect(sum).toBe(cats.filter(isStreet).length);
    expect(sum).toBeGreaterThan(0);
  });
});

describe("notSeenLately", () => {
  it("is street cats last seen 6 weeks or more ago, never the never-seen or the homed", () => {
    const in43 = fake({ lastSeenAt: daysAgo(43) });
    const at42 = fake({ lastSeenAt: daysAgo(NOT_SEEN_LATELY_DAYS) });
    const out41 = fake({ lastSeenAt: daysAgo(41) });
    const never = fake({ lastSeenAt: null });
    const homed = fake({ lives: "homed", lastSeenAt: daysAgo(100) });
    const gone = fake({ lives: "gone", lastSeenAt: daysAgo(100) });
    const got = notSeenLately([in43, at42, out41, never, homed, gone], NOW);
    expect(got.map((c) => c.id).sort()).toEqual([in43.id, at42.id].sort());
  });
});

describe("Off Syros is never counted (spec §3.3)", () => {
  it("is in no figure, and the figures reconcile", () => {
    const az = arizona();
    const azHomed = fake({ lives: "homed", areaKey: "off" });
    const azInCare = fake({ lives: "in_care", areaKey: "off" });
    const here = [
      fake({ mark: "sterilised", areaKey: "kini" }),
      fake({ mark: "not_sterilised", areaKey: "ermoupoli", lastSeenAt: daysAgo(60) }),
      fake({ lives: "homed" }),
    ];
    const cats = [...here, az, azHomed, azInCare];
    const h = headline(cats, NOW);
    expect(h).toEqual({ ...headline(here, NOW), at: NOW });
    expect(h.street).toBe(2);
    expect(h.homed).toBe(1);
    expect(h.inCare).toBe(0);
    expect(splitOf(cats)).toEqual(splitOf(here));
    expect(notSeenLately(cats, NOW).map((c) => c.id)).not.toContain(az.id);
    expect(toDo(cats).map((c) => c.id)).not.toContain(az.id);
    // Area totals add up to the headline.
    const byArea = new Map<string, number>();
    for (const c of cats.filter(isStreet)) byArea.set(c.areaKey, (byArea.get(c.areaKey) ?? 0) + 1);
    expect([...byArea.values()].reduce((a, b) => a + b, 0)).toBe(h.street);
    expect(byArea.has("off")).toBe(false);
  });
});

describe("toDo", () => {
  it("is not sterilised, then not known, then probably; newest seen first, never-seen last", () => {
    const ns1 = fake({ mark: "not_sterilised", lastSeenAt: daysAgo(10) });
    const ns2 = fake({ mark: "not_sterilised", lastSeenAt: daysAgo(2) });
    const ns3 = fake({ mark: "not_sterilised", lastSeenAt: null });
    const nk1 = fake({ mark: "not_known", lastSeenAt: null });
    const nk2 = fake({ mark: "not_known", lastSeenAt: daysAgo(30) });
    const pr1 = fake({ mark: "probably", lastSeenAt: daysAgo(1) });
    const done = fake({ mark: "sterilised", lastSeenAt: daysAgo(1) });
    const homed = fake({ lives: "homed", mark: "not_sterilised" });
    const gone = fake({ lives: "gone", mark: "not_sterilised" });
    const got = toDo([pr1, nk1, done, ns1, homed, ns3, nk2, gone, ns2]);
    expect(got.map((c) => c.id)).toEqual([ns2.id, ns1.id, ns3.id, nk2.id, nk1.id, pr1.id]);
  });

  it("never lists a sterilised cat", () => {
    expect(toDo([fake({ mark: "sterilised" })])).toEqual([]);
  });
});
