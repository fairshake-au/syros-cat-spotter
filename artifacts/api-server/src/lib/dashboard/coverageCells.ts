import { db, sightingsTable } from "@workspace/db";
import { CELL_LAT_DEG, CELL_LNG_DEG, haversineKm, type LatLng } from "@workspace/geo";
import { and, gte, isNull, lte } from "drizzle-orm";
import { namedAreasAt } from "../areas/areaHistory";

// The island as 250 m squares (SYC-396 plan Decision 13; spec §9.3 report 3,
// §6.1). Built in PR 3.3b for Coverage and spotting; PR 2.6's "Not looked at
// yet" map layer reuses it.
//
// The squares are blurPosition's (lib/blur.ts): lib/geo's fixed public grid,
// so they line up with the public map. A square is known by its row and
// column on that grid (whole numbers), never by a position, so a page can
// draw it without printing one.
//
// - **seen:** at least one sighting in the period falls in it.
// - **notLookedAt:** its centre is within GAP_RADIUS_M of a named area's
//   centre and nothing in the period falls in it. A seen square is never
//   notLookedAt.
//
// Sightings counted: every one a spotter sent (pending, waiting for the team
// or matched), entered within the period ("as of" is entered by then,
// Decision 10), and never one redacted for privacy (privacy beats
// reproducibility).

export const GAP_RADIUS_M = 500;
/** PR 2.6's map layer looks back this far for "Not looked at yet". */
export const GAP_LOOKBACK_DAYS = 90;

export interface Cell {
  /** "row:col" on the grid. */
  key: string;
  row: number;
  col: number;
  south: number;
  west: number;
  north: number;
  east: number;
  seen: boolean;
  notLookedAt: boolean;
}

export const cellOf = (p: LatLng): { row: number; col: number } => ({
  row: Math.floor(p.lat / CELL_LAT_DEG),
  col: Math.floor(p.lng / CELL_LNG_DEG),
});

/** A square's centre: the same point blurPosition gives for anything inside it. */
export const cellCentre = (row: number, col: number): LatLng => ({
  lat: (row + 0.5) * CELL_LAT_DEG,
  lng: (col + 0.5) * CELL_LNG_DEG,
});

const cell = (row: number, col: number, seen: boolean): Cell => ({
  key: `${row}:${col}`,
  row,
  col,
  south: row * CELL_LAT_DEG,
  west: col * CELL_LNG_DEG,
  north: (row + 1) * CELL_LAT_DEG,
  east: (col + 1) * CELL_LNG_DEG,
  seen,
  notLookedAt: !seen,
});

/**
 * The squares with a sighting, and the empty squares near an area centre.
 * Pure. Ordered north to south, then west to east.
 */
export function cellsFrom(points: readonly LatLng[], centres: readonly LatLng[]): Cell[] {
  const out = new Map<string, Cell>();
  for (const p of points) {
    const { row, col } = cellOf(p);
    const key = `${row}:${col}`;
    if (!out.has(key)) out.set(key, cell(row, col, true));
  }
  // A square is 250 m, so a 500 m circle reaches at most 3 squares away.
  const reach = Math.ceil(GAP_RADIUS_M / 250) + 1;
  for (const c of centres) {
    const home = cellOf(c);
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const row = home.row + dr;
        const col = home.col + dc;
        const key = `${row}:${col}`;
        if (out.has(key)) continue;
        if (haversineKm(cellCentre(row, col), c) * 1000 <= GAP_RADIUS_M) out.set(key, cell(row, col, false));
      }
    }
  }
  return [...out.values()].sort((a, b) => b.row - a.row || a.col - b.col);
}

export interface SightingPoint {
  lat: number;
  lng: number;
  at: Date;
  /** Null once a spotter has been deleted: counted as a sighting, not as a spotter. */
  deviceId: string | null;
}

/** The sightings entered in a period, not redacted. All time when `from` is null. */
export async function sightingsIn(o: { from: Date | null; to: Date }): Promise<SightingPoint[]> {
  const s = sightingsTable;
  return db
    .select({ lat: s.lat, lng: s.lng, at: s.createdAt, deviceId: s.deviceId })
    .from(s)
    .where(and(isNull(s.redactedAt), lte(s.createdAt, o.to), o.from === null ? undefined : gte(s.createdAt, o.from)))
    .orderBy(s.createdAt, s.id);
}

/** The squares for a period, against the named areas as they stood at its end. */
export async function coverageCells(o: { from: Date | null; to: Date }): Promise<Cell[]> {
  const [points, areas] = await Promise.all([sightingsIn(o), namedAreasAt(o.to)]);
  return cellsFrom(points, areas.areas);
}
