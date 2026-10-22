/**
 * SYC-166 slice 4: is a position on Syros? The island is a rectangle (the
 * offline tile box) plus a small margin, so a photo taken at the very edge of
 * the coast still counts (plan Decision E1: 0.02 degrees, about 2 km).
 */
import { describe, expect, it } from 'vitest';
import { ERMOUPOLI, SYROS_MARGIN_DEG, SYROS_RECT, isOnSyros } from '../island';

// About one metre: 0.00001 degrees is 1.1 m of latitude, 0.9 m of longitude here.
const ONE_METRE = 0.00001;

describe('isOnSyros', () => {
  it('uses the offline tile box and a 0.02 degree margin', () => {
    expect(SYROS_RECT).toEqual({ minLat: 37.36, maxLat: 37.53, minLon: 24.85, maxLon: 25.01 });
    expect(SYROS_MARGIN_DEG).toBe(0.02);
  });

  it('counts Ermoupoli and coastal villages as Syros', () => {
    expect(isOnSyros(ERMOUPOLI.latitude, ERMOUPOLI.longitude)).toBe(true);
    // Finikas and Kini, read off OpenStreetMap.
    expect(isOnSyros(37.3972, 24.8776)).toBe(true);
    expect(isOnSyros(37.4447, 24.9012)).toBe(true);
  });

  it('counts every point inside the rectangle', () => {
    expect(isOnSyros(37.45, 24.93)).toBe(true);
    expect(isOnSyros(SYROS_RECT.minLat, SYROS_RECT.minLon)).toBe(true);
    expect(isOnSyros(SYROS_RECT.maxLat, SYROS_RECT.maxLon)).toBe(true);
  });

  it('counts each edge of the margin exactly, one metre inside, and not one metre outside', () => {
    const m = SYROS_MARGIN_DEG;
    const midLat = 37.445;
    const midLon = 24.93;
    const edges: Array<[string, (d: number) => [number, number]]> = [
      ['south', (d) => [SYROS_RECT.minLat - m - d, midLon]],
      ['north', (d) => [SYROS_RECT.maxLat + m + d, midLon]],
      ['west', (d) => [midLat, SYROS_RECT.minLon - m - d]],
      ['east', (d) => [midLat, SYROS_RECT.maxLon + m + d]],
    ];
    for (const [name, at] of edges) {
      expect(isOnSyros(...at(0)), `${name} edge`).toBe(true);
      expect(isOnSyros(...at(-ONE_METRE)), `${name} one metre inside`).toBe(true);
      expect(isOnSyros(...at(ONE_METRE)), `${name} one metre outside`).toBe(false);
    }
  });

  it('counts a point just outside the tile box (inside the margin) as Syros', () => {
    expect(isOnSyros(SYROS_RECT.minLat - 0.01, 24.93)).toBe(true);
    expect(isOnSyros(37.445, SYROS_RECT.maxLon + 0.01)).toBe(true);
  });

  it('does not count other islands, Athens, Munich or Null Island', () => {
    expect(isOnSyros(37.538, 25.163), 'Tinos town').toBe(false);
    expect(isOnSyros(37.447, 25.329), 'Mykonos town').toBe(false);
    expect(isOnSyros(37.085, 25.15), 'Parikia, Paros').toBe(false);
    expect(isOnSyros(37.984, 23.727), 'Athens').toBe(false);
    expect(isOnSyros(48.137, 11.575), 'Munich').toBe(false);
    expect(isOnSyros(0, 0), 'Null Island').toBe(false);
  });

  it('does not count values that are not a position', () => {
    expect(isOnSyros(Number.NaN, 24.93)).toBe(false);
    expect(isOnSyros(37.445, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('puts Ermoupoli inside the tile box itself', () => {
    expect(ERMOUPOLI).toEqual({ latitude: 37.4449, longitude: 24.9433 });
    expect(isOnSyros(ERMOUPOLI.latitude, ERMOUPOLI.longitude, 0)).toBe(true);
  });
});
