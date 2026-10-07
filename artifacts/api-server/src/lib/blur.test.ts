import { describe, expect, it } from "vitest";
import { CELL_LAT_DEG, CELL_LNG_DEG, haversineKm, squareCentre } from "@workspace/geo";
import { BLUR_CELL_METRES, blurPosition, publicDistanceKm } from "./blur";

// Data spine plan PR 6; cat-record-data-spine.md §6.2, §6.4.2, §10.6.

/** Deterministic pseudo-random numbers, so a red run can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ERMOUPOLI = { lat: 37.4448, lng: 24.9425 };

function around(r: () => number, km: number) {
  return {
    lat: ERMOUPOLI.lat + ((r() * 2 - 1) * km) / 111.32,
    lng: ERMOUPOLI.lng + ((r() * 2 - 1) * km) / (111.32 * Math.cos((ERMOUPOLI.lat * Math.PI) / 180)),
  };
}

describe("blurPosition", () => {
  it("uses 250 m cells", () => {
    expect(BLUR_CELL_METRES).toBe(250);
  });

  it("is deterministic: the same point always gives the same answer", () => {
    const r = rng(1);
    for (let i = 0; i < 500; i++) {
      const p = around(r, 8);
      expect(blurPosition(p.lat, p.lng)).toEqual(blurPosition(p.lat, p.lng));
    }
  });

  it("is idempotent: a published centre maps to itself", () => {
    const r = rng(2);
    for (let i = 0; i < 1000; i++) {
      const p = around(r, 8);
      const c = blurPosition(p.lat, p.lng);
      expect(blurPosition(c.lat, c.lng)).toEqual(c);
    }
  });

  it("keeps every point in its own cell: never more than half a diagonal (~177 m) away", () => {
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const p = around(r, 8);
      const c = blurPosition(p.lat, p.lng);
      expect(Math.abs(c.lat - p.lat)).toBeLessThanOrEqual(CELL_LAT_DEG / 2 + 1e-6);
      expect(Math.abs(c.lng - p.lng)).toBeLessThanOrEqual(CELL_LNG_DEG / 2 + 1e-6);
      expect(haversineKm(p, c)).toBeLessThanOrEqual(0.1775);
    }
  });

  it("never returns the exact position", () => {
    const p = { lat: 37.441234, lng: 24.945678 };
    expect(blurPosition(p.lat, p.lng)).not.toEqual(p);
  });

  it("puts every point in one cell to the same centre", () => {
    const c = blurPosition(ERMOUPOLI.lat, ERMOUPOLI.lng);
    const r = rng(4);
    for (let i = 0; i < 500; i++) {
      const q = {
        lat: c.lat + (r() * 2 - 1) * 0.499 * CELL_LAT_DEG,
        lng: c.lng + (r() * 2 - 1) * 0.499 * CELL_LNG_DEG,
      };
      expect(blurPosition(q.lat, q.lng)).toEqual(c);
    }
  });
});

describe("the grid (§6.2)", () => {
  it("is lib/geo's public grid, so the phone and the server agree on every cell", () => {
    const r = rng(6);
    for (let i = 0; i < 500; i++) {
      const p = around(r, 8);
      const c = squareCentre(p);
      const b = blurPosition(p.lat, p.lng);
      expect(b.lat).toBeCloseTo(c.lat, 6);
      expect(b.lng).toBeCloseTo(c.lng, 6);
    }
  });
});

describe("publicDistanceKm (§6.4.2)", () => {
  it("measures to the published cell centre and rounds to 100 m", () => {
    const viewer = { lat: 37.45, lng: 24.93 };
    const cat = { lat: 37.441234, lng: 24.945678 };
    const c = blurPosition(cat.lat, cat.lng);
    const expected = Math.round(haversineKm(viewer, c) * 10) / 10;
    expect(publicDistanceKm(viewer.lat, viewer.lng, cat.lat, cat.lng)).toBe(expected);
  });

  it("doesn't change when a cat moves within its cell", () => {
    const viewer = { lat: 37.45, lng: 24.93 };
    const c = blurPosition(ERMOUPOLI.lat, ERMOUPOLI.lng);
    const r = rng(5);
    const d = publicDistanceKm(viewer.lat, viewer.lng, c.lat, c.lng);
    for (let i = 0; i < 300; i++) {
      const q = {
        lat: c.lat + (r() * 2 - 1) * 0.499 * CELL_LAT_DEG,
        lng: c.lng + (r() * 2 - 1) * 0.499 * CELL_LNG_DEG,
      };
      expect(publicDistanceKm(viewer.lat, viewer.lng, q.lat, q.lng)).toBe(d);
    }
  });
});
