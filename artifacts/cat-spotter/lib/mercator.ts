/**
 * Web Mercator arithmetic shared by the maps.
 *
 * "World" coordinates are pixels on the whole map at a given zoom: the world
 * is TILE_SIZE * 2^zoom pixels square, with (0, 0) at the north-west corner.
 * Zoom here is the app's own scale (256-px world); see toMapLibreZoom.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 19;
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
 * MapLibre counts zoom against a 512-px world, the app against a 256-px one,
 * so MapLibre's zoom is the app's minus 1. This pair is the ONLY place the two
 * scales meet: convert here, never with an inline "- 1" elsewhere.
 */
export function toMapLibreZoom(appZoom: number): number {
  return appZoom - 1;
}

export function fromMapLibreZoom(mapLibreZoom: number): number {
  return mapLibreZoom + 1;
}
