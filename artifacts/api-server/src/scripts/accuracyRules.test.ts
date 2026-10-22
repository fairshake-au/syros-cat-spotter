import { describe, expect, it } from "vitest";
import {
  chooseModelAndK,
  chooseWithSmoke,
  hitRate,
  mostlyOne,
  rankGallery,
  rankOf,
  type Check2Rates,
} from "./accuracyRules";

const rates = (d10: number, d20: number, c10: number, c20: number): Check2Rates => ({
  dino: { top10: d10, top20: d20 },
  clip: { top10: c10, top20: c20 },
});

describe("chooseModelAndK: the model", () => {
  it("takes CLIP only when it is better by MORE than 5 points on top 20", () => {
    expect(chooseModelAndK(rates(80, 90, 80, 96), true).model).toBe("clip-b32-q8");
    expect(chooseModelAndK(rates(80, 90, 80, 95.5), true).model).toBe("clip-b32-q8");
  });
  it("keeps DINOv2 at exactly 5 points", () => {
    expect(chooseModelAndK(rates(80, 90, 80, 95), true).model).toBe("dinov2-small-q8");
    // The float-noise version of the same boundary: 0.1 + 0.2 style sums.
    expect(chooseModelAndK(rates(80, 85.1 + 0.2, 80, 90.3 + 0.0), true).model).toBe("dinov2-small-q8");
  });
  it("keeps DINOv2 when it is better or level", () => {
    expect(chooseModelAndK(rates(80, 95, 80, 90), true).model).toBe("dinov2-small-q8");
    expect(chooseModelAndK(rates(80, 90, 80, 90), true).model).toBe("dinov2-small-q8");
  });
});

describe("chooseModelAndK: K", () => {
  it("is 10 when top 10 is within 2 points of top 20 and the smoke test passes at 10", () => {
    expect(chooseModelAndK(rates(90, 91, 0, 0), true).k).toBe(10);
  });
  it("is 10 at exactly 2 points", () => {
    expect(chooseModelAndK(rates(88, 90, 0, 0), true).k).toBe(10);
    expect(chooseModelAndK(rates(88.1, 90.1, 0, 0), true).k).toBe(10);
  });
  it("is 20 just past 2 points", () => {
    expect(chooseModelAndK(rates(87.9, 90, 0, 0), true).k).toBe(20);
  });
  it("is 20 when the smoke test fails at 10, however close", () => {
    expect(chooseModelAndK(rates(90, 90, 0, 0), false).k).toBe(20);
  });
  it("uses the chosen model's own rates, not the other model's", () => {
    // CLIP wins (96 vs 90); its top 10 is 6 points short, so K is 20 even though DINOv2's gap is 0.
    expect(chooseModelAndK(rates(90, 90, 90, 96), true)).toEqual({ model: "clip-b32-q8", k: 20 });
  });
});

describe("chooseModelAndK: check 2 skipped", () => {
  it("is DINOv2 small with K = 20, whatever the smoke test said", () => {
    expect(chooseModelAndK(null, true)).toEqual({ model: "dinov2-small-q8", k: 20 });
    expect(chooseModelAndK(null, false)).toEqual({ model: "dinov2-small-q8", k: 20 });
  });
});

describe("chooseWithSmoke", () => {
  it("reads the smoke result of the model that wins", () => {
    const r = rates(90, 90, 96, 96); // CLIP wins by 6, gap 0
    expect(chooseWithSmoke(r, { dino: false, clip: true })).toEqual({ model: "clip-b32-q8", k: 10 });
    expect(chooseWithSmoke(r, { dino: true, clip: false })).toEqual({ model: "clip-b32-q8", k: 20 });
    const d = rates(90, 90, 91, 91); // DINOv2 stays
    expect(chooseWithSmoke(d, { dino: true, clip: false })).toEqual({ model: "dinov2-small-q8", k: 10 });
  });
});

describe("ranking", () => {
  const unit = (...v: number[]) => {
    const n = Math.hypot(...v);
    return Float32Array.from(v.map((x) => x / n));
  };
  const gallery = [unit(1, 0, 0), unit(0, 1, 0), unit(1, 1, 0), unit(0, 0, 1)];

  it("orders best first and finds the right cat's rank", () => {
    const q = unit(1, 0.1, 0);
    expect(rankGallery(q, gallery)).toEqual([0, 2, 1, 3]);
    expect(rankOf(q, gallery, 0)).toBe(1);
    expect(rankOf(q, gallery, 2)).toBe(2);
    expect(rankOf(q, gallery, 3)).toBe(4);
  });
  it("counts a tie against the right cat", () => {
    const twin = [unit(1, 0, 0), unit(1, 0, 0), unit(0, 1, 0)];
    expect(rankOf(unit(1, 0, 0), twin, 0)).toBe(2);
    expect(rankOf(unit(1, 0, 0), twin, 1)).toBe(2);
  });
  it("hit rates are percent of ranks inside k", () => {
    expect(hitRate([1, 5, 10, 11, 20, 21], 10)).toBeCloseTo(50);
    expect(hitRate([1, 5, 10, 11, 20, 21], 20)).toBeCloseTo((5 / 6) * 100);
    expect(hitRate([], 10)).toBeNull();
  });
  it("mostly one place means more than half", () => {
    expect(mostlyOne(["a", "a", "b"])).toBe(true);
    expect(mostlyOne(["a", "b"])).toBe(false);
    expect(mostlyOne([])).toBe(false);
  });
});
