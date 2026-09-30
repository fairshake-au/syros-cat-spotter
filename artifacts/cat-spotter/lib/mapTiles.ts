/**
 * Web Mercator arithmetic for the web location picker, which draws
 * OpenStreetMap tiles itself so it can know where the map has been dragged
 * (an embedded OSM iframe cannot report that across the frame boundary).
 *
 * "World" coordinates are pixels on the whole map at a given zoom: the world
 * is TILE_SIZE * 2^zoom pixels square, with (0, 0) at the north-west corner.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 19;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Beyond this latitude Web Mercator is undefined; the map simply stops.
const MAX_LAT = 85.05112878;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacedTile {
  key: string;
  url: string;
  left: number;
  top: number;
}

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

export function toWorld({ latitude, longitude }: LatLng, zoom: number): Point {
  const size = worldSize(zoom);
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function fromWorld({ x, y }: Point, zoom: number): LatLng {
  const size = worldSize(zoom);
  const clampedY = Math.max(0, Math.min(size, y));
  const n = Math.PI - (2 * Math.PI * clampedY) / size;
  let longitude = (x / size) * 360 - 180;
  // Dragging past the antimeridian wraps rather than running off the world.
  longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return {
    latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    longitude,
  };
}

/**
 * The coordinates under a point on the picker, given the coordinates at its
 * centre. Used both for dragging (the new centre is the point the finger
 * started from, moved by the drag) and for tapping a spot.
 */
export function latLngAtOffset(
  center: LatLng,
  zoom: number,
  dx: number,
  dy: number,
): LatLng {
  const c = toWorld(center, zoom);
  return fromWorld({ x: c.x + dx, y: c.y + dy }, zoom);
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
