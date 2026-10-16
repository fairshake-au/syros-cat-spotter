import { describe, expect, it, vi } from "vitest";

// Pins the "<=" in the 2 km rule: a floating-point offset can't land on exactly
// 2 km, so the distance itself is stubbed.
const km = vi.hoisted(() => ({ value: 0 }));
vi.mock("../catHelpers", () => ({ haversineKm: () => km.value }));

import { areaFor, NAMED_AREAS, OFF_SYROS } from "./namedAreas";

describe("the 2 km rule at the boundary", () => {
  it("exactly 2.000 km from the nearest centre is still in the area", () => {
    km.value = 2;
    expect(areaFor(0, 0)).toBe(NAMED_AREAS[0]);
  });
  it("just over 2 km is Off Syros", () => {
    km.value = 2.000001;
    expect(areaFor(0, 0)).toBe(OFF_SYROS);
  });
});
