import { describe, expect, it } from "vitest";
import { inIsland, ISLAND_BOX, ISLAND_CENTRE } from "./island";

const ERMOUPOLI = { lat: 37.4447, lng: 24.9417 };

describe("the island box", () => {
  it("knows where the island is", () => {
    expect(inIsland(ERMOUPOLI)).toBe(true);
    expect(inIsland({ lat: ISLAND_BOX.maxLat + 0.001, lng: 24.94 })).toBe(false);
    expect(inIsland({ lat: 37.44, lng: ISLAND_BOX.minLng - 0.001 })).toBe(false);
    expect(inIsland({ lat: 37.9, lng: 23.7 })).toBe(false); // Athens
    expect(inIsland({ lat: Number.NaN, lng: 24.94 })).toBe(false);
  });

  it("includes its edges", () => {
    expect(inIsland({ lat: ISLAND_BOX.minLat, lng: ISLAND_BOX.minLng })).toBe(true);
    expect(inIsland({ lat: ISLAND_BOX.maxLat, lng: ISLAND_BOX.maxLng })).toBe(true);
  });

  it("has its centre inside the box", () => {
    expect(inIsland(ISLAND_CENTRE)).toBe(true);
    expect(ISLAND_CENTRE).toEqual({ lat: 37.445, lng: 24.93 });
  });
});
