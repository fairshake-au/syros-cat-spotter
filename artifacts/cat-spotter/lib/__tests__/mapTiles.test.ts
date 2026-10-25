import { describe, expect, it } from 'vitest';
import { TILE_SIZE, visibleTiles } from '../mapTiles';

// Ermoupoli harbour.
const ERMOUPOLI = { latitude: 37.4446, longitude: 24.9427 };

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

describe('visibleTiles margin', () => {
  it('draws extra tiles so a drag of up to the margin still shows map, not gaps', () => {
    const width = 343;
    const height = 220;
    const margin = 384;
    const tiles = visibleTiles(ERMOUPOLI, 17, width, height, margin);
    // A point the full margin beyond each corner is still covered.
    for (const [x, y] of [
      [-margin, -margin],
      [width + margin - 1, -margin],
      [-margin, height + margin - 1],
      [width + margin - 1, height + margin - 1],
    ]) {
      const covering = tiles.filter(
        (t) =>
          x >= t.left && x < t.left + TILE_SIZE && y >= t.top && y < t.top + TILE_SIZE,
      );
      expect(covering, `point ${x},${y}`).toHaveLength(1);
    }
  });
});
