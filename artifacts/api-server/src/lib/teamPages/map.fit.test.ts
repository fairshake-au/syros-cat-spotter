import { describe, expect, it } from "vitest";
import { fitView, mergeSameSpot, type MapMarker } from "./map";
import { BANDS, GRID, clampView, latToTileY, lngToTileX, pointOnView, type Position } from "../mapTiles/geometry";

// SYC-602 Task 1.4 (SYC-459 items 1 and 5): the small map of a cat's sightings.

const seen = (n: number, lat = 37.4447, lng = 24.9418): MapMarker => ({
  lat,
  lng,
  n,
  look: "seen",
  label: `Sighting ${n}`,
  href: `#sg-${100 + n}`,
});

describe("one marker per spot on the small map", () => {
  it("draws one marker per spot with the range of its numbers", () => {
    const out = mergeSameSpot([seen(2), seen(3), seen(4)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("2–4");
    expect(mergeSameSpot([seen(2), seen(5), seen(7)])[0]!.text).toBe("2, 5, 7");
  });

  it("writes a mix as runs and singles: 2, 3, 4 and 7 is 2–4, 7", () => {
    expect(mergeSameSpot([seen(2), seen(3), seen(4), seen(7)])[0]!.text).toBe("2–4, 7");
  });

  it("treats positions equal to 5 decimal places as one spot, and others as different spots", () => {
    const out = mergeSameSpot([seen(1, 37.444701, 24.941801), seen(2, 37.444704, 24.941798), seen(3, 37.4448, 24.9418)]);
    expect(out.map((m) => m.text ?? m.n)).toEqual(["1–2", 3]);
  });

  it("leaves a lone marker as it was, with no text", () => {
    const out = mergeSameSpot([seen(1), seen(2, 37.45, 24.95)]);
    expect(out.map((m) => m.n)).toEqual([1, 2]);
    expect(out.every((m) => m.text === undefined)).toBe(true);
  });

  it("links a merged marker to its newest sighting and names every sighting in its label", () => {
    const m = mergeSameSpot([seen(2), seen(3), seen(4)])[0]!;
    expect(m.href).toBe("#sg-104");
    expect(m.label).toBe("Sighting 2; Sighting 3; Sighting 4");
  });
});

describe("the small map is centred on its points (SYC-459 item 5)", () => {
  const size = BANDS[0].size;
  const fits = (v: ReturnType<typeof fitView>, pts: Position[]) =>
    pts.every((p) => {
      const at = pointOnView(v, size, p);
      return at !== null && Math.min(at.left, at.top, GRID * size - at.left, GRID * size - at.top) >= 12;
    });
  const away = (v: ReturnType<typeof fitView>, c: Position) =>
    Math.hypot(v.x + GRID / 2 - lngToTileX(c.lng, v.z), v.y + GRID / 2 - latToTileY(c.lat, v.z));

  it("centres the points among the views that fit them all", () => {
    // Clusters of several widths, at several places over the island.
    for (let i = 0; i < 60; i++) {
      const a = { lat: 37.4 + (i % 10) * 0.012, lng: 24.9 + Math.floor(i / 10) * 0.01 };
      const w = 0.0004 * (1 + (i % 7));
      const pts = [a, { lat: a.lat + w * 0.7, lng: a.lng + w }];
      const c = { lat: a.lat + w * 0.35, lng: a.lng + w / 2 };
      const v = fitView(pts);
      expect(fits(v, pts)).toBe(true);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const other = clampView({ z: v.z, x: v.x + dx, y: v.y + dy });
          if (fits(other, pts)) expect(away(v, c)).toBeLessThanOrEqual(away(other, c) + 1e-9);
        }
      }
    }
  });
});
