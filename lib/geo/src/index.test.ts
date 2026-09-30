/**
 * lib/geo — the one definition of "nearby" shared by the phone's picker and
 * the server's resolve check (SYC-119 plan, Slice 0.2).
 *
 * Spec references are to docs/specs/choose-a-different-cat.md §10.
 */
import { describe, expect, it } from 'vitest';
import {
  CELL_LAT_DEG,
  CELL_LNG_DEG,
  NEARBY_KM,
  haversineKm,
  isNearby,
  nearbyOrder,
  publishedPosition,
  squareCentre,
  type LatLng,
} from './index';

/** Deterministic pseudo-random numbers, so a red run can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Ermoupoli, Syros.
const ERMOUPOLI: LatLng = { lat: 37.4448, lng: 24.9425 };

/** A random point up to `km` from `centre` (roughly — a box is enough here). */
function around(r: () => number, centre: LatLng, km: number): LatLng {
  const dLat = ((r() * 2 - 1) * km) / 111.32;
  const dLng =
    ((r() * 2 - 1) * km) / (111.32 * Math.cos((centre.lat * Math.PI) / 180));
  return { lat: centre.lat + dLat, lng: centre.lng + dLng };
}

/** Another exact position inside the same published 250 m square. */
function elsewhereInSquare(r: () => number, p: LatLng): LatLng {
  const c = squareCentre(p);
  // Stay a hair inside the edges so floating point can't tip it over.
  const f = 0.499;
  return {
    lat: c.lat + (r() * 2 - 1) * f * CELL_LAT_DEG,
    lng: c.lng + (r() * 2 - 1) * f * CELL_LNG_DEG,
  };
}

/** A point exactly `km` due north of `p`. */
function northOf(p: LatLng, km: number): LatLng {
  return { lat: p.lat + ((km / 6371) * 180) / Math.PI, lng: p.lng };
}

describe('squareCentre', () => {
  it('is stable: every point in a square maps to the same centre', () => {
    const r = rng(1);
    for (let i = 0; i < 500; i++) {
      const p = around(r, ERMOUPOLI, 5);
      const c = squareCentre(p);
      expect(squareCentre(elsewhereInSquare(r, p))).toEqual(c);
      expect(squareCentre(c)).toEqual(c);
    }
  });

  it('moves a point by at most about 177 m (half the diagonal of 250 m)', () => {
    const r = rng(2);
    for (let i = 0; i < 1000; i++) {
      const p = around(r, ERMOUPOLI, 8);
      expect(haversineKm(p, squareCentre(p))).toBeLessThanOrEqual(0.1775);
    }
  });

  it('makes squares about 250 m on each side on Syros', () => {
    const c = squareCentre(ERMOUPOLI);
    const north = { lat: c.lat + CELL_LAT_DEG, lng: c.lng };
    const east = { lat: c.lat, lng: c.lng + CELL_LNG_DEG };
    expect(haversineKm(c, north)).toBeCloseTo(0.25, 2);
    expect(haversineKm(c, east)).toBeCloseTo(0.25, 2);
  });
});

describe('publishedPosition', () => {
  it('is the centre of the cat\'s 250 m square, never its exact position', () => {
    const cat = { lat: 37.44123, lng: 24.94567 };
    expect(publishedPosition(cat)).toEqual(squareCentre(cat));
    expect(publishedPosition(cat)).not.toEqual({ lat: cat.lat, lng: cat.lng });
  });
});

describe('isNearby (spec §4.8)', () => {
  it('uses 1.5 km, the same number as the Cats tab', () => {
    expect(NEARBY_KM).toBe(1.5);
  });

  it('test 22: accepts exactly 1.5 km and refuses just beyond it', () => {
    const cat = squareCentre(ERMOUPOLI);
    expect(isNearby(northOf(cat, 1.5), publishedPosition(cat))).toBe(true);
    expect(isNearby(northOf(cat, 1.501), publishedPosition(cat))).toBe(false);
    expect(isNearby(northOf(cat, 3), publishedPosition(cat))).toBe(false);
  });

  it('test 23 (arithmetic): every cat within 500 m exactly is nearby by published square', () => {
    // Suggested cats are within 500 m on exact positions (DECISIONS Part 2h).
    // Snapping moves a cat at most ~177 m, so 500 + 177 < 1500 always passes.
    const r = rng(3);
    for (let i = 0; i < 2000; i++) {
      const sighting = around(r, ERMOUPOLI, 6);
      let cat = around(r, sighting, 0.5);
      if (haversineKm(sighting, cat) > 0.5) continue;
      expect(isNearby(sighting, publishedPosition(cat))).toBe(true);
    }
  });

  it('test 24: moving a cat within its square never changes acceptance', () => {
    const r = rng(4);
    for (let i = 0; i < 3000; i++) {
      const cat = around(r, ERMOUPOLI, 3);
      const moved = elsewhereInSquare(r, cat);
      // Sightings concentrated around the 1.5 km edge, where it matters.
      const centre = squareCentre(cat);
      const angle = r() * 2 * Math.PI;
      const km = 1.3 + r() * 0.4;
      const sighting = {
        lat: centre.lat + ((km * Math.cos(angle)) / 6371) * (180 / Math.PI),
        lng:
          centre.lng +
          ((km * Math.sin(angle)) /
            (6371 * Math.cos((centre.lat * Math.PI) / 180))) *
            (180 / Math.PI),
      };
      expect(isNearby(sighting, publishedPosition(moved))).toBe(
        isNearby(sighting, publishedPosition(cat)),
      );
    }
  });
});

describe('nearbyOrder (spec §4.4)', () => {
  type TestCat = { id: number; lat: number; lng: number };

  function catsAround(r: () => number, n: number): TestCat[] {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      ...around(r, ERMOUPOLI, 2.5),
    }));
  }

  it('keeps only cats whose published square is within 1.5 km', () => {
    const r = rng(5);
    const cats = catsAround(r, 200);
    const sighting = around(r, ERMOUPOLI, 0.5);
    const listed = nearbyOrder(sighting, cats);
    const expected = cats.filter((c) =>
      isNearby(sighting, publishedPosition(c)),
    );
    expect(listed.map((c) => c.id).sort((a, b) => a - b)).toEqual(
      expected.map((c) => c.id).sort((a, b) => a - b),
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(cats.length);
  });

  it('is nearest first by published square, ties broken by SYR number (lowest first)', () => {
    const r = rng(6);
    const cats = catsAround(r, 200);
    const sighting = around(r, ERMOUPOLI, 0.3);
    const listed = nearbyOrder(sighting, cats);
    for (let i = 1; i < listed.length; i++) {
      const a = haversineKm(sighting, publishedPosition(listed[i - 1]!));
      const b = haversineKm(sighting, publishedPosition(listed[i]!));
      expect(a).toBeLessThanOrEqual(b);
      if (a === b) expect(listed[i - 1]!.id).toBeLessThan(listed[i]!.id);
    }
  });

  it('cats in the same square tie, whatever their exact positions', () => {
    const square = squareCentre(ERMOUPOLI);
    const r = rng(7);
    // Cat 9 is exactly on the sighting, cat 3 at the far corner of the square.
    const cats: TestCat[] = [
      { id: 9, ...ERMOUPOLI },
      { id: 3, ...elsewhereInSquare(r, square) },
      { id: 5, ...elsewhereInSquare(r, square) },
    ];
    expect(nearbyOrder(ERMOUPOLI, cats).map((c) => c.id)).toEqual([3, 5, 9]);
  });

  it('test 2: moving cats within their squares changes neither the list nor its order', () => {
    const r = rng(8);
    for (let round = 0; round < 40; round++) {
      const cats = catsAround(r, 120);
      const moved = cats.map((c) => ({ ...c, ...elsewhereInSquare(r, c) }));
      for (let s = 0; s < 10; s++) {
        const sighting = around(r, ERMOUPOLI, 1.5);
        expect(nearbyOrder(sighting, moved).map((c) => c.id)).toEqual(
          nearbyOrder(sighting, cats).map((c) => c.id),
        );
      }
    }
  });

  it('does not mutate its input and keeps the caller\'s own objects', () => {
    const cats = [
      { id: 2, lat: 37.445, lng: 24.943, name: 'Agatha' },
      { id: 1, lat: 37.445, lng: 24.943, name: 'Krispy' },
    ];
    const copy = JSON.parse(JSON.stringify(cats));
    const listed = nearbyOrder(ERMOUPOLI, cats);
    expect(cats).toEqual(copy);
    expect(listed[0]).toBe(cats[1]);
    expect(listed[0]!.name).toBe('Krispy');
  });
});
