/**
 * Drawing a cat's published position as the area it really means (data
 * spine PR 6; cat-record-data-spine.md §6.2 "Fix: draw the cell").
 *
 * The API sends the centre of a square cell and its side in metres
 * (`locationCellM`). The map draws that square with softened corners, so it
 * reads as a region, not a building footprint, and never as a pin.
 */
import { toWorld, type LatLng } from './mapTiles';

const METRES_PER_DEGREE_LAT = 111_320;

/** The published cell's side when a cached cat predates `locationCellM`. */
export const DEFAULT_CELL_M = 250;

/** How far into each side the corner rounding reaches, as a share of the side. */
export const CORNER_SHARE = 0.2;

/** Points per rounded corner (the native polygon's smoothness). */
const CORNER_STEPS = 6;

function halfSideDegrees(centre: LatLng, sideMetres: number) {
  const dLat = sideMetres / 2 / METRES_PER_DEGREE_LAT;
  const dLng = dLat / Math.cos((centre.latitude * Math.PI) / 180);
  return { dLat, dLng };
}

/**
 * The cell as a closed polygon with rounded corners, for react-native-maps.
 * Every point lies inside the true square, so the drawn area never claims
 * more than the cell.
 */
export function roundedCellPolygon(centre: LatLng, sideMetres: number): LatLng[] {
  const { dLat, dLng } = halfSideDegrees(centre, sideMetres);
  const rLat = 2 * dLat * CORNER_SHARE;
  const rLng = 2 * dLng * CORNER_SHARE;
  // Corner centres, clockwise from north-east, with the angle each arc starts at.
  const corners: { lat: number; lng: number; start: number }[] = [
    { lat: centre.latitude + dLat - rLat, lng: centre.longitude + dLng - rLng, start: 0 },
    { lat: centre.latitude - dLat + rLat, lng: centre.longitude + dLng - rLng, start: -90 },
    { lat: centre.latitude - dLat + rLat, lng: centre.longitude - dLng + rLng, start: -180 },
    { lat: centre.latitude + dLat - rLat, lng: centre.longitude - dLng + rLng, start: -270 },
  ];
  const points: LatLng[] = [];
  for (const c of corners) {
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const a = ((c.start + 90 - (90 * i) / CORNER_STEPS) * Math.PI) / 180;
      points.push({ latitude: c.lat + rLat * Math.sin(a), longitude: c.lng + rLng * Math.cos(a) });
    }
  }
  return points;
}

/** The cell's box in pixels on a tile map centred on `mapCentre` (the web map). */
export function cellBoxPixels(
  centre: LatLng,
  sideMetres: number,
  mapCentre: LatLng,
  zoom: number,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number; radius: number } {
  const { dLat, dLng } = halfSideDegrees(centre, sideMetres);
  const origin = toWorld(mapCentre, zoom);
  const nw = toWorld({ latitude: centre.latitude + dLat, longitude: centre.longitude - dLng }, zoom);
  const se = toWorld({ latitude: centre.latitude - dLat, longitude: centre.longitude + dLng }, zoom);
  const w = se.x - nw.x;
  const h = se.y - nw.y;
  return {
    left: nw.x - origin.x + width / 2,
    top: nw.y - origin.y + height / 2,
    width: w,
    height: h,
    radius: Math.min(w, h) * CORNER_SHARE,
  };
}

/**
 * Cats that share one published cell share one drawn area: draw each cell
 * once, keeping the cats in it in their given order.
 */
export function groupByCell<T extends { lat: number; lng: number }>(cats: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const cat of cats) {
    const key = `${cat.lat},${cat.lng}`;
    const g = groups.get(key);
    if (g) g.push(cat);
    else groups.set(key, [cat]);
  }
  return [...groups.values()];
}
