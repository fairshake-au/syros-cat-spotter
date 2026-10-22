/**
 * Drawing a cat's published position as the area it really means (data
 * spine PR 6; cat-record-data-spine.md §6.2 "Fix: draw the cell").
 *
 * The API sends the centre of a square cell and its side in metres
 * (`locationCellM`). The map draws that square with softened corners, so it
 * reads as a region, not a building footprint, and never as a pin.
 */
import { MIN_ZOOM, fromWorld, toWorld, type LatLng } from './mapTiles';

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

/** The closest the Cat-alogue map opens: a 250 m cell is about 160 px, never a pin. */
export const FIT_MAX_ZOOM = 16;

export interface FitCell {
  /** The cell's centre, as the API sent it. */
  latitude: number;
  longitude: number;
  /** The cell's side in metres. */
  sizeMetres: number;
}

export interface FitOptions {
  /** The map's measured size on screen, in pixels. */
  width: number;
  height: number;
  /** Empty space kept around the cats, in cells (the biggest cell's side). */
  marginCells?: number;
  maxZoom?: number;
  minZoom?: number;
}

export interface FittedRegion extends LatLng {
  /** A whole tile zoom, as the web map uses. */
  zoom: number;
  /** What the map shows at that zoom, for react-native-maps. */
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * The centre and zoom that show every cell with a margin, for a map of the
 * given size. Uses both spans (so a wide east-west spread in a short box
 * zooms out enough), never goes closer than `maxZoom` or farther than
 * `minZoom`. Returns null for no cells (or an unmeasured map): the caller
 * keeps the island view.
 */
export function fitRegion(cells: readonly FitCell[], opts: FitOptions): FittedRegion | null {
  const { width, height, marginCells = 1, maxZoom = FIT_MAX_ZOOM, minZoom = MIN_ZOOM } = opts;
  if (cells.length === 0 || !(width > 0) || !(height > 0)) return null;

  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  let biggest = 0;
  for (const c of cells) {
    const { dLat, dLng } = halfSideDegrees(c, c.sizeMetres);
    north = Math.max(north, c.latitude + dLat);
    south = Math.min(south, c.latitude - dLat);
    east = Math.max(east, c.longitude + dLng);
    west = Math.min(west, c.longitude - dLng);
    biggest = Math.max(biggest, c.sizeMetres);
  }
  const mid = { latitude: (north + south) / 2, longitude: (east + west) / 2 };
  const margin = halfSideDegrees(mid, biggest * marginCells * 2);
  north += margin.dLat / 2;
  south -= margin.dLat / 2;
  east += margin.dLng / 2;
  west -= margin.dLng / 2;

  // Size of the padded box in world pixels at zoom 0; every zoom doubles it.
  const nw = toWorld({ latitude: north, longitude: west }, 0);
  const se = toWorld({ latitude: south, longitude: east }, 0);
  const spanX = Math.max(se.x - nw.x, 1e-9);
  const spanY = Math.max(se.y - nw.y, 1e-9);
  // toWorld(.., 0) puts the whole world in 256 px, and each zoom doubles it.
  const zoom = Math.max(
    minZoom,
    Math.min(maxZoom, Math.floor(Math.log2(Math.min(width / spanX, height / spanY)))),
  );

  const centre = fromWorld({ x: (nw.x + se.x) / 2 * 2 ** zoom, y: (nw.y + se.y) / 2 * 2 ** zoom }, zoom);
  const centreWorld = toWorld(centre, zoom);
  const top = fromWorld({ x: centreWorld.x, y: centreWorld.y - height / 2 }, zoom);
  const bottom = fromWorld({ x: centreWorld.x, y: centreWorld.y + height / 2 }, zoom);
  return {
    latitude: centre.latitude,
    longitude: centre.longitude,
    zoom,
    latitudeDelta: top.latitude - bottom.latitude,
    longitudeDelta: (width / (256 * 2 ** zoom)) * 360,
  };
}
