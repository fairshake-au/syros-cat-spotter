import { describe, expect, it } from "vitest";
import { CELL_LAT_DEG, haversineKm } from "@workspace/geo";
import { blurPosition } from "../blur";
import { cellCentre, cellOf, cellsFrom } from "./coverageCells";

// SYC-396 PR 3.3b (plan Decision 13): the island as blurPosition's 250 m squares.

const KINI = { lat: 37.4436, lng: 24.8889 };

describe("cellsFrom", () => {
  it("makes one square of two sightings in the same square", () => {
    const a = { lat: 37.4447, lng: 24.9417 };
    const b = { lat: a.lat + CELL_LAT_DEG / 10, lng: a.lng };
    expect(cellOf(a)).toEqual(cellOf(b));
    const cells = cellsFrom([a, b], []);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ seen: true, notLookedAt: false });
  });

  it("uses blurPosition's squares: a square's centre is the blurred position of anything in it", () => {
    const p = { lat: 37.44123, lng: 24.93876 };
    const { row, col } = cellOf(p);
    const centre = cellCentre(row, col);
    const blurred = blurPosition(p.lat, p.lng);
    expect(centre.lat).toBeCloseTo(blurred.lat, 6);
    expect(centre.lng).toBeCloseTo(blurred.lng, 6);
  });

  it("marks an empty square 400 m from Kini's centre as not looked at, and none 600 m away", () => {
    const cells = cellsFrom([], [KINI]);
    const dist = (c: { row: number; col: number }) => haversineKm(cellCentre(c.row, c.col), KINI) * 1000;
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.notLookedAt).toBe(true);
      expect(dist(c)).toBeLessThanOrEqual(500);
    }
    // A square whose centre is about 400 m away is in; one about 600 m away is not.
    const home = cellOf(KINI);
    const near = cells.find((c) => Math.abs(dist(c) - 400) < 130);
    expect(near).toBeDefined();
    const far = { row: home.row, col: home.col + 3 };
    expect(dist(far)).toBeGreaterThan(550);
    expect(dist(far)).toBeLessThan(800);
    expect(cells.find((c) => c.row === far.row && c.col === far.col)).toBeUndefined();
  });

  it("never marks a square with a sighting as not looked at", () => {
    const cells = cellsFrom([KINI], [KINI]);
    const home = cells.find((c) => c.key === `${cellOf(KINI).row}:${cellOf(KINI).col}`)!;
    expect(home).toMatchObject({ seen: true, notLookedAt: false });
    expect(cells.filter((c) => c.seen)).toHaveLength(1);
  });
});
