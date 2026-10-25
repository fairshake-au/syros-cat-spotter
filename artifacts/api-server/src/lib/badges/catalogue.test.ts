import { describe, expect, it } from "vitest";
import {
  BADGE_CATALOGUE,
  badgeProgress,
  thresholdBadges,
  type BadgeStats,
} from "./catalogue";

const ZERO: BadgeStats = {
  points: 0,
  totalSightings: 0,
  uniqueCatsDiscovered: 0,
  catsSpotted: 0,
  weeksSpotted: 0,
  areasSpotted: 0,
  areasTotal: 21,
  remoteCats: 0,
  podiums: 0,
  champions: 0,
};

describe("badge catalogue", () => {
  it("has 22 unique ids", () => {
    const ids = BADGE_CATALOGUE.map((b) => b.id);
    expect(ids).toHaveLength(22);
    expect(new Set(ids).size).toBe(22);
  });

  it("puts ten_discoveries in finding and the rest of the old seven in first_steps", () => {
    const g = (id: string) => BADGE_CATALOGUE.find((b) => b.id === id)!.group;
    expect(g("ten_discoveries")).toBe("finding");
    for (const id of ["first_sighting", "first_discovery", "five_cats", "ten_cats", "explorer", "island_legend"]) {
      expect(g(id)).toBe("first_steps");
    }
  });

  it("awards areas_all only when every current area is covered", () => {
    expect(thresholdBadges({ ...ZERO, areasSpotted: 21 })).toContain("areas_all");
    expect(thresholdBadges({ ...ZERO, areasSpotted: 20 })).not.toContain("areas_all");
  });

  it("retiring an area never removes areas_all and progress shows complete", () => {
    const stats = { ...ZERO, areasSpotted: 19, areasTotal: 21 };
    const p = badgeProgress(stats, new Set(["areas_all"])).find((b) => b.id === "areas_all")!;
    expect(p).toMatchObject({ earned: true, value: 21, goal: 21 });
  });

  it("remote_5 needs 5 distinct cats", () => {
    expect(thresholdBadges({ ...ZERO, remoteCats: 4 })).toContain("remote_1");
    expect(thresholdBadges({ ...ZERO, remoteCats: 4 })).not.toContain("remote_5");
    expect(thresholdBadges({ ...ZERO, remoteCats: 5 })).toContain("remote_5");
  });

  it("never awards event badges from totals and reports null progress", () => {
    const all = { ...ZERO, points: 9999, totalSightings: 999, uniqueCatsDiscovered: 999, catsSpotted: 999, weeksSpotted: 99, areasSpotted: 21, remoteCats: 99, podiums: 9, champions: 9 };
    const t = thresholdBadges(all);
    expect(t).not.toContain("pathfinder");
    expect(t).not.toContain("trailblazer");
    expect(t).toHaveLength(20);
    const p = badgeProgress(ZERO, new Set()).find((b) => b.id === "pathfinder")!;
    expect(p).toMatchObject({ value: null, goal: null, earned: false });
  });

  it("reports partial progress for an unearned badge", () => {
    const p = badgeProgress({ ...ZERO, weeksSpotted: 3 }, new Set()).find((b) => b.id === "weeks_4")!;
    expect(p).toMatchObject({ earned: false, value: 3, goal: 4 });
  });
});
