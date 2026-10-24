import { describe, expect, it } from 'vitest';
import { SYROS_OUTLINE } from './syrosOutline';

const inside = (lat: number, lng: number): boolean => {
  let in_ = false;
  const p = SYROS_OUTLINE;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [yi, xi] = p[i]!;
    const [yj, xj] = p[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) in_ = !in_;
  }
  return in_;
};

describe('SYROS_OUTLINE', () => {
  // 250 m square CENTRES only (never exact sighting positions): the squares
  // with a sighting on 24 Oct 2026. Every one must sit inside the outline.
  const CENTRES: [number, number][] = [
    [37.41803, 24.87498], [37.44049, 24.94003], [37.44049, 24.94569],
    [37.44498, 24.90326], [37.44498, 24.90609], [37.44498, 24.94003],
    [37.44498, 24.94286], [37.44722, 24.90043], [37.44722, 24.94852],
  ];
  it.each(CENTRES)('has the sighted square centred at %s, %s inside', (lat, lng) => {
    expect(inside(lat, lng)).toBe(true);
  });
});
