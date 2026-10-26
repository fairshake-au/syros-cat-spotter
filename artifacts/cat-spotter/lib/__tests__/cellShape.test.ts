/**
 * Data spine PR 6 (SYC-41): drawing a published cell (spec §6.2, "Fix: draw
 * the cell"). The drawn area is the cell itself, never bigger, never a pin.
 */
import { describe, expect, it } from 'vitest';
import { fitRegion, groupByCell, roundedCellPolygon } from '../cellShape';
import { toWorld } from '../mercator';
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

describe('fitRegion', () => {
  const box = { width: 390, height: 600 };
  const cell = (latitude: number, longitude: number, sizeMetres = 250) => ({ latitude, longitude, sizeMetres });

  it('returns null with no cells, or before the map is measured', () => {
    expect(fitRegion([], box)).toBeNull();
    expect(fitRegion([cell(37.44, 24.94)], { width: 0, height: 0 })).toBeNull();
  });

  it('opens one cell at the zoom cap, centred on it, never as a pin', () => {
    const r = fitRegion([cell(37.44, 24.94)], box)!;
    expect(r.zoom).toBe(16);
    expect(r.latitude).toBeCloseTo(37.44, 6);
    expect(r.longitude).toBeCloseTo(24.94, 6);
  });

  it('zooms out to hold a spread', () => {
    const cells = [cell(37.42, 24.92), cell(37.46, 24.97)];
    const r = fitRegion(cells, box)!;
    expect(r.zoom).toBeGreaterThanOrEqual(12);
    expect(r.zoom).toBeLessThan(16);
  });

  // Where a cell's corners land on screen at the fitted zoom, given the fit's centre.
  const onScreen = (
    c: { latitude: number; longitude: number; sizeMetres: number },
    r: { latitude: number; longitude: number; zoom: number },
    w: number,
    h: number,
  ) => {
    const dLat = c.sizeMetres / 2 / 111_320;
    const dLng = dLat / Math.cos((c.latitude * Math.PI) / 180);
    const o = toWorld(r, r.zoom);
    const nw = toWorld({ latitude: c.latitude + dLat, longitude: c.longitude - dLng }, r.zoom);
    const se = toWorld({ latitude: c.latitude - dLat, longitude: c.longitude + dLng }, r.zoom);
    return {
      left: nw.x - o.x + w / 2,
      top: nw.y - o.y + h / 2,
      right: se.x - o.x + w / 2,
      bottom: se.y - o.y + h / 2,
      cellPx: se.x - nw.x,
    };
  };

  it('keeps a one-cell margin on every side of every cell', () => {
    const cells = [cell(37.42, 24.92), cell(37.46, 24.97)];
    const r = fitRegion(cells, box)!;
    for (const c of cells) {
      const p = onScreen(c, r, box.width, box.height);
      expect(p.left).toBeGreaterThanOrEqual(p.cellPx - 1);
      expect(p.top).toBeGreaterThanOrEqual(p.cellPx - 1);
      expect(box.width - p.right).toBeGreaterThanOrEqual(p.cellPx - 1);
      expect(box.height - p.bottom).toBeGreaterThanOrEqual(p.cellPx - 1);
    }
  });

  it('holds a wide east-west spread inside a short box', () => {
    const cells = [cell(37.44, 24.9), cell(37.44, 24.99)];
    const r = fitRegion(cells, { width: 390, height: 200 })!;
    for (const c of cells) {
      const p = onScreen(c, r, 390, 200);
      expect(p.left).toBeGreaterThanOrEqual(-1);
      expect(p.right).toBeLessThanOrEqual(391);
    }
  });

  it('uses the longitude span too: a wide east-west spread in a short box', () => {
    const cells = [cell(37.44, 24.90), cell(37.44, 24.99)];
    const wide = fitRegion(cells, { width: 390, height: 200 })!;
    const roomy = fitRegion(cells, { width: 1200, height: 200 })!;
    expect(wide.zoom).toBeLessThan(roomy.zoom);
  });

  it('never zooms out past the floor of 12, even for an island-wide spread', () => {
    const r = fitRegion([cell(37.3, 24.8), cell(37.55, 25.1)], { width: 300, height: 300 })!;
    expect(r.zoom).toBe(12);
  });

  it('gives native the deltas the chosen zoom shows', () => {
    const r = fitRegion([cell(37.44, 24.94)], box)!;
    expect(r.longitudeDelta).toBeCloseTo((390 / (256 * 2 ** 16)) * 360, 8);
    expect(r.latitudeDelta).toBeGreaterThan(0);
  });
});
