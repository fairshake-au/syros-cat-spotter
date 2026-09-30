import { describe, expect, it } from "vitest";
import {
  MATCH_RADIUS_KM,
  MAX_CANDIDATES,
  selectCandidateCats,
} from "./candidateSelection";
import { haversineKm } from "./catHelpers";

// SYC-39 (DECISIONS.md, 30 Sep 2026): a photo is only compared with cats
// whose stored (first-spotted) position is within 500 m, by exact distance.

const ORIGIN = { lat: 37.44, lng: 24.94 };
// haversineKm uses R = 6371 km, so one metre due north is this many degrees.
const DEG_PER_METRE = 180 / (Math.PI * 6371 * 1000);

let nextId = 1;
function catAt(metresNorth: number, metresEast = 0) {
  const lat = ORIGIN.lat + metresNorth * DEG_PER_METRE;
  const lng =
    ORIGIN.lng +
    (metresEast * DEG_PER_METRE) / Math.cos((ORIGIN.lat * Math.PI) / 180);
  return { id: nextId++, lat, lng };
}

function distM(c: { lat: number; lng: number }) {
  return haversineKm(ORIGIN.lat, ORIGIN.lng, c.lat, c.lng) * 1000;
}

describe("selectCandidateCats (SYC-39)", () => {
  it("uses a 500 m radius and at most ten candidates", () => {
    expect(MATCH_RADIUS_KM).toBe(0.5);
    expect(MAX_CANDIDATES).toBe(10);
  });

  it("includes a cat 499 m away and excludes one 501 m away", () => {
    const near = catAt(499);
    const far = catAt(501);
    // Guard the fixture itself, so the test can't pass on bad geometry.
    expect(distM(near)).toBeGreaterThan(498.9);
    expect(distM(near)).toBeLessThan(499.1);
    expect(distM(far)).toBeGreaterThan(500.9);

    const picked = selectCandidateCats([far, near], ORIGIN.lat, ORIGIN.lng);
    expect(picked.map((c) => c.id)).toEqual([near.id]);
  });

  it("applies the cap in every direction, not just north", () => {
    const eastNear = catAt(0, 499);
    const eastFar = catAt(0, 501);
    const southWestFar = catAt(-360, -360); // ~509 m
    expect(distM(southWestFar)).toBeGreaterThan(500);

    const picked = selectCandidateCats(
      [eastFar, southWestFar, eastNear],
      ORIGIN.lat,
      ORIGIN.lng,
    );
    expect(picked.map((c) => c.id)).toEqual([eastNear.id]);
  });

  it("returns an empty list when no cat is within 500 m", () => {
    const cats = [catAt(501), catAt(2_000), catAt(-15_000, 3_000)];
    expect(selectCandidateCats(cats, ORIGIN.lat, ORIGIN.lng)).toEqual([]);
  });

  it("returns an empty list when there are no cats at all", () => {
    expect(selectCandidateCats([], ORIGIN.lat, ORIGIN.lng)).toEqual([]);
  });

  it("keeps nearest-first ordering", () => {
    const a = catAt(300);
    const b = catAt(10);
    const c = catAt(0, 150);
    const picked = selectCandidateCats([a, b, c], ORIGIN.lat, ORIGIN.lng);
    expect(picked.map((x) => x.id)).toEqual([b.id, c.id, a.id]);
  });

  it("still takes only the ten nearest when more than ten are within 500 m", () => {
    const inside = Array.from({ length: 12 }, (_, i) => catAt(20 + i * 35)); // 20..405 m
    const outside = catAt(600);
    const shuffled = [...inside].reverse().concat(outside);

    const picked = selectCandidateCats(shuffled, ORIGIN.lat, ORIGIN.lng);
    expect(picked.map((c) => c.id)).toEqual(inside.slice(0, 10).map((c) => c.id));
  });

  it("carries the original cat objects through untouched", () => {
    const cat = { ...catAt(5), name: "Mitsos", primaryPhotoId: 7 };
    const [picked] = selectCandidateCats([cat], ORIGIN.lat, ORIGIN.lng);
    expect(picked).toBe(cat);
  });
});
