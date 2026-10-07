/**
 * Data spine PR 6 (SYC-41): drawing a published cell (spec §6.2, "Fix: draw
 * the cell"). The drawn area is the cell itself, never bigger, never a pin.
 */
import { describe, expect, it } from 'vitest';
import { CORNER_SHARE, cellBoxPixels, groupByCell, roundedCellPolygon } from '../cellShape';
import { parsePublicDate } from '../catStatusLines';

const CENTRE = { latitude: 37.4448, longitude: 24.9425 };
const M_PER_DEG = 111_320;

describe('roundedCellPolygon', () => {
  const poly = roundedCellPolygon(CENTRE, 250);
  const halfLat = 125 / M_PER_DEG;
  const halfLng = halfLat / Math.cos((CENTRE.latitude * Math.PI) / 180);

  it('stays inside the 250 m square: it never claims more than the cell', () => {
    for (const p of poly) {
      expect(Math.abs(p.latitude - CENTRE.latitude)).toBeLessThanOrEqual(halfLat + 1e-12);
      expect(Math.abs(p.longitude - CENTRE.longitude)).toBeLessThanOrEqual(halfLng + 1e-12);
    }
  });

  it('reaches every side of the square, so it is the cell and not a smaller blob', () => {
    const lats = poly.map((p) => p.latitude);
    const lngs = poly.map((p) => p.longitude);
    expect(Math.max(...lats)).toBeCloseTo(CENTRE.latitude + halfLat, 10);
    expect(Math.min(...lats)).toBeCloseTo(CENTRE.latitude - halfLat, 10);
    expect(Math.max(...lngs)).toBeCloseTo(CENTRE.longitude + halfLng, 10);
    expect(Math.min(...lngs)).toBeCloseTo(CENTRE.longitude - halfLng, 10);
  });

  it('softens the corners: no point sits on a sharp corner', () => {
    for (const p of poly) {
      const atCorner =
        Math.abs(Math.abs(p.latitude - CENTRE.latitude) - halfLat) < 1e-9 &&
        Math.abs(Math.abs(p.longitude - CENTRE.longitude) - halfLng) < 1e-9;
      expect(atCorner).toBe(false);
    }
  });
});

describe('cellBoxPixels', () => {
  it('centres the box on the cell and sizes it to the cell at that zoom', () => {
    const box = cellBoxPixels(CENTRE, 250, CENTRE, 16, 400, 300);
    expect(box.left + box.width / 2).toBeCloseTo(200, 6);
    expect(box.top + box.height / 2).toBeCloseTo(150, 0);
    // At z16 a pixel is about 2.39 m × cos(lat) ≈ 1.9 m on Syros: 250 m ≈ 131 px.
    expect(box.width).toBeGreaterThan(120);
    expect(box.width).toBeLessThan(140);
    expect(box.radius).toBeCloseTo(Math.min(box.width, box.height) * CORNER_SHARE, 6);
  });
});

describe('groupByCell', () => {
  it('draws cats sharing a cell once, in their given order', () => {
    const a = { id: 1, lat: 1, lng: 2 };
    const b = { id: 2, lat: 3, lng: 4 };
    const c = { id: 3, lat: 1, lng: 2 };
    expect(groupByCell([a, b, c])).toEqual([[a, c], [b]]);
  });
});

describe('parsePublicDate', () => {
  it('reads a public date as that calendar day in any timezone', () => {
    const d = parsePublicDate('2026-10-06');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 6]);
  });

  it('still reads an older server\'s full timestamp', () => {
    expect(parsePublicDate('2026-10-06T10:00:00Z').toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });
});
