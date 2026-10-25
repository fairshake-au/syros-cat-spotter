/**
 * Picture-tile layout for the web location picker, which draws OpenStreetMap
 * tiles itself. The Mercator maths lives in ./mercator and is re-exported here
 * until the MapLibre move (Task 3.6) deletes this file.
 */

import { TILE_SIZE, toWorld, type LatLng } from './mercator';

export * from './mercator';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface PlacedTile {
  key: string;
  url: string;
  left: number;
  top: number;
}

/**
 * Every tile needed to cover a width x height view centred on `center`, plus
 * `margin` pixels on each side. The picker only recentres when a drag ends,
 * so the margin is what a drag reveals before then instead of grey gaps.
 */
export function visibleTiles(
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
  margin = 0,
): PlacedTile[] {
  if (width <= 0 || height <= 0) return [];
  const c = toWorld(center, zoom);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;
  const count = 2 ** zoom;
  const firstX = Math.floor((originX - margin) / TILE_SIZE);
  const lastX = Math.floor((originX + width + margin) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor((originY - margin) / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + height + margin) / TILE_SIZE));
  const tiles: PlacedTile[] = [];
  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      const wrappedX = ((tx % count) + count) % count;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: TILE_URL.replace('{z}', String(zoom))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(ty)),
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}
