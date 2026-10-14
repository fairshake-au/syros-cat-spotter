// The team map's geometry (SYC-209 PR 3.1; feeding-sites spec §3, plan K4).
// Standard Web Mercator ("slippy map") tile numbers, the island box the map
// is limited to, the picture sizes a phone or a computer is shown, and the
// one function that turns a tap on a picture into a position.

/** Syros, the app's own box (artifacts/cat-spotter/lib/offlineTiles.ts). */
export const ISLAND_BOX = {
  minLat: 37.36,
  maxLat: 37.53,
  minLng: 24.85,
  maxLng: 25.01,
} as const;

/**
 * Zoom 12 shows most of the island in four pictures; zoom 19 is where a
 * fingertip is about 10 m (spec §3). Nothing outside this range is fetched,
 * so the tile route can't be used as a free map proxy.
 */
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 19;

/**
 * The map is always 2 pictures by 2. The size of each picture depends on the
 * screen width (plan K4): a picture is never shrunk by the browser, because
 * the browser reports a tap in the picture's displayed pixels, and the
 * server converts at the size it drew. `minWidth` is the narrowest screen
 * (CSS px) each size is shown at; the page's CSS shows exactly one.
 *
 * 2×144 fits 320 px, 2×164 fits 360 px, 2×171 fits 375 px, 2×179 fits
 * 390 px (each with the page's 12 px margins), and 256 px pictures from
 * 600 px.
 */
export const BANDS = [
  { size: 144, minWidth: 0 },
  { size: 164, minWidth: 360 },
  { size: 171, minWidth: 375 },
  { size: 179, minWidth: 390 },
  { size: 256, minWidth: 600 },
] as const;

export type TileSize = (typeof BANDS)[number]["size"];
export const TILE_SIZES: readonly number[] = BANDS.map((b) => b.size);
export const isTileSize = (n: number): n is TileSize => TILE_SIZES.includes(n);

/** Pictures across and down. */
export const GRID = 2;

/** A tile: OpenStreetMap's z/x/y numbering. */
export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** What the map shows: the zoom and its top-left tile. */
export type View = Tile;

export interface Position {
  lat: number;
  lng: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Longitude to tile units at zoom z (fractional: the part is where in the tile). */
export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

/** Latitude to tile units at zoom z (fractional). */
export function latToTileY(lat: number, z: number): number {
  const phi = toRad(lat);
  return ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  return toDeg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))));
}

/** The tiles that touch the island box at zoom z (inclusive). */
export function islandTileRange(z: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: Math.floor(lngToTileX(ISLAND_BOX.minLng, z)),
    maxX: Math.floor(lngToTileX(ISLAND_BOX.maxLng, z)),
    // North is the smaller y.
    minY: Math.floor(latToTileY(ISLAND_BOX.maxLat, z)),
    maxY: Math.floor(latToTileY(ISLAND_BOX.minLat, z)),
  };
}

const isWhole = (n: number) => Number.isSafeInteger(n);

/** May this tile be fetched and served: a whole tile, zoom 12–19, touching Syros. */
export function isTileAllowed(t: Tile): boolean {
  if (!isWhole(t.z) || !isWhole(t.x) || !isWhole(t.y)) return false;
  if (t.z < MIN_ZOOM || t.z > MAX_ZOOM) return false;
  const r = islandTileRange(t.z);
  return t.x >= r.minX && t.x <= r.maxX && t.y >= r.minY && t.y <= r.maxY;
}

/** Is this position on Syros (inside the island box, edges included). */
export function inIsland(p: Position): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= ISLAND_BOX.minLat &&
    p.lat <= ISLAND_BOX.maxLat &&
    p.lng >= ISLAND_BOX.minLng &&
    p.lng <= ISLAND_BOX.maxLng
  );
}

/**
 * From a tap to a position (spec §3). `tile` is the picture that was tapped,
 * `size` the size it was drawn at (from the form, so always the size of the
 * picture that was tapped), and (px, py) the point the browser sent, in that
 * picture's displayed CSS pixels from its top-left corner.
 *
 * A browser sends whole pixels, so the tap is taken as the centre of that
 * pixel. A point outside the picture is refused (null): no browser sends one.
 */
export function tapToPosition(
  tile: Tile,
  size: number,
  px: number,
  py: number,
): Position | null {
  if (!isTileSize(size)) return null;
  if (!isWhole(px) || !isWhole(py)) return null;
  if (px < 0 || py < 0 || px > size || py > size) return null;
  // A tap reported on the far edge itself (px === size) is the last pixel.
  const fx = Math.min(px + 0.5, size) / size;
  const fy = Math.min(py + 0.5, size) / size;
  return {
    lat: tileYToLat(tile.y + fy, tile.z),
    lng: tileXToLng(tile.x + fx, tile.z),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Keep a view over the island: the zoom in range, and the 2×2 pictures
 * inside the tiles that touch the island box wherever the island is wider
 * than two tiles.
 */
export function clampView(v: View): View {
  const z = clamp(Math.round(v.z), MIN_ZOOM, MAX_ZOOM);
  const r = islandTileRange(z);
  return {
    z,
    x: clamp(Math.round(v.x), r.minX, Math.max(r.minX, r.maxX - (GRID - 1))),
    y: clamp(Math.round(v.y), r.minY, Math.max(r.minY, r.maxY - (GRID - 1))),
  };
}

/** The view at zoom z with this position as near the middle as the tiles allow. */
export function viewAround(p: Position, z: number): View {
  const zz = clamp(Math.round(z), MIN_ZOOM, MAX_ZOOM);
  // The middle of a 2×2 view is the corner its four tiles share, x0 + 1.
  return clampView({
    z: zz,
    x: Math.round(lngToTileX(p.lng, zz)) - GRID / 2,
    y: Math.round(latToTileY(p.lat, zz)) - GRID / 2,
  });
}

/** The position in the middle of a view. */
export function viewCentre(v: View): Position {
  return {
    lat: tileYToLat(v.y + GRID / 2, v.z),
    lng: tileXToLng(v.x + GRID / 2, v.z),
  };
}

export const zoomIn = (v: View): View => viewAround(viewCentre(v), v.z + 1);
export const zoomOut = (v: View): View => viewAround(viewCentre(v), v.z - 1);

/** Move by whole pictures: dx east, dy south. */
export const pan = (v: View, dx: number, dy: number): View =>
  clampView({ z: v.z, x: v.x + dx, y: v.y + dy });

/** The tiles a view draws, row by row. */
export function viewTiles(v: View): Tile[] {
  const out: Tile[] = [];
  for (let row = 0; row < GRID; row++)
    for (let col = 0; col < GRID; col++)
      out.push({ z: v.z, x: v.x + col, y: v.y + row });
  return out;
}

/**
 * Where a position falls on a view drawn with pictures of `size`, in whole
 * CSS pixels from the map's top-left corner, or null when it is off the map.
 */
export function pointOnView(
  v: View,
  size: number,
  p: Position,
): { left: number; top: number } | null {
  const left = Math.floor((lngToTileX(p.lng, v.z) - v.x) * size);
  const top = Math.floor((latToTileY(p.lat, v.z) - v.y) * size);
  const span = GRID * size;
  if (left < 0 || top < 0 || left >= span || top >= span) return null;
  return { left, top };
}
