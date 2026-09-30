import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  clampZoom,
  fromWorld,
  latLngAtOffset,
  toWorld,
  visibleTiles,
} from '../mapTiles';

// Ermoupoli harbour, and Talaras about 4 km to the south-west.
const ERMOUPOLI = { latitude: 37.4446, longitude: 24.9427 };
const TALARAS = { latitude: 37.4185, longitude: 24.9036 };

describe('toWorld / fromWorld', () => {
  it('round-trips a Syros coordinate at every zoom the picker uses', () => {
    for (let z = 12; z <= 19; z++) {
      const back = fromWorld(toWorld(ERMOUPOLI, z), z);
      expect(back.latitude).toBeCloseTo(ERMOUPOLI.latitude, 9);
      expect(back.longitude).toBeCloseTo(ERMOUPOLI.longitude, 9);
    }
  });

  it('puts Ermoupoli in the tile OpenStreetMap itself serves for it', () => {
    // z17 tile for Ermoupoli harbour, computed independently with the
    // standard slippy-map formula.
    const w = toWorld(ERMOUPOLI, 17);
    expect(Math.floor(w.x / TILE_SIZE)).toBe(74617);
    expect(Math.floor(w.y / TILE_SIZE)).toBe(50813);
  });

  it('maps the equator and prime meridian to the middle of the world', () => {
    const w = toWorld({ latitude: 0, longitude: 0 }, 0);
    expect(w.x).toBeCloseTo(128, 9);
    expect(w.y).toBeCloseTo(128, 9);
  });
});

describe('latLngAtOffset', () => {
  it('returns the centre when there is no offset', () => {
    const p = latLngAtOffset(ERMOUPOLI, 17, 0, 0);
    expect(p.latitude).toBeCloseTo(ERMOUPOLI.latitude, 9);
    expect(p.longitude).toBeCloseTo(ERMOUPOLI.longitude, 9);
  });

  it('moves east for a positive x offset and north for a negative y offset', () => {
    const p = latLngAtOffset(ERMOUPOLI, 17, 100, -100);
    expect(p.longitude).toBeGreaterThan(ERMOUPOLI.longitude);
    expect(p.latitude).toBeGreaterThan(ERMOUPOLI.latitude);
  });

  it('can reach Talaras from Ermoupoli by the pixel distance between them', () => {
    const z = 15;
    const from = toWorld(ERMOUPOLI, z);
    const to = toWorld(TALARAS, z);
    const p = latLngAtOffset(ERMOUPOLI, z, to.x - from.x, to.y - from.y);
    expect(p.latitude).toBeCloseTo(TALARAS.latitude, 6);
    expect(p.longitude).toBeCloseTo(TALARAS.longitude, 6);
  });

  it('one pixel at zoom 17 is about a metre on Syros, so a drag is precise', () => {
    const p = latLngAtOffset(ERMOUPOLI, 17, 1, 0);
    const metres =
      (p.longitude - ERMOUPOLI.longitude) *
      111_320 *
      Math.cos((ERMOUPOLI.latitude * Math.PI) / 180);
    expect(metres).toBeGreaterThan(0.8);
    expect(metres).toBeLessThan(1.1);
  });
});

describe('visibleTiles', () => {
  it('covers the whole view with no gaps', () => {
    const width = 343;
    const height = 220;
    const tiles = visibleTiles(ERMOUPOLI, 17, width, height);
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
      [width / 2, height / 2],
    ]) {
      const covering = tiles.filter(
        (t) =>
          x >= t.left && x < t.left + TILE_SIZE && y >= t.top && y < t.top + TILE_SIZE,
      );
      expect(covering, `point ${x},${y}`).toHaveLength(1);
    }
  });

  it('builds OpenStreetMap tile URLs', () => {
    const [tile] = visibleTiles(ERMOUPOLI, 17, 10, 10);
    expect(tile.url).toBe('https://tile.openstreetmap.org/17/74617/50813.png');
  });

  it('draws nothing before the view has a size', () => {
    expect(visibleTiles(ERMOUPOLI, 17, 0, 200)).toEqual([]);
  });
});

describe('clampZoom', () => {
  it('keeps zoom within what the picker allows', () => {
    expect(clampZoom(3)).toBe(12);
    expect(clampZoom(25)).toBe(19);
    expect(clampZoom(16.6)).toBe(17);
  });
});
