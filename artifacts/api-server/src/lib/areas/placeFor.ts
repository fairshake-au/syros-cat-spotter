import { areaForIn, currentAreas, OFF_SYROS, type NamedArea } from "./namedAreas";

/*
 * The server's copy of artifacts/cat-spotter/lib/island.ts (SYC-166 slice 4).
 * Copied unchanged; placeFor.test.ts pins the rectangle and margin to the
 * client's text.
 */

/**
 * The whole island as a rectangle. It is the offline tile box
 * (lib/offlineTiles.ts), not a coastline.
 */
export const SYROS_RECT = { minLat: 37.36, maxLat: 37.53, minLon: 24.85, maxLon: 25.01 };

/**
 * How far outside the rectangle still counts as Syros: 0.02 degrees, about
 * 2 km (plan Decision E1). The nearest other island, Tinos, is more than
 * 10 km past the east edge.
 */
export const SYROS_MARGIN_DEG = 0.02;

export function isOnSyros(lat: number, lng: number, marginDeg: number = SYROS_MARGIN_DEG): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= SYROS_RECT.minLat - marginDeg &&
    lat <= SYROS_RECT.maxLat + marginDeg &&
    lng >= SYROS_RECT.minLon - marginDeg &&
    lng <= SYROS_RECT.maxLon + marginDeg
  );
}

export interface Place {
  areaKey: string;
  onIsland: boolean;
}

/** The area key (or "off") and whether the point is on Syros. */
export function placeFor(lat: number, lng: number, areas: readonly NamedArea[] = currentAreas()): Place {
  const area = areaForIn(areas, lat, lng);
  return { areaKey: area === OFF_SYROS ? OFF_SYROS.key : area.key, onIsland: isOnSyros(lat, lng) };
}

/** On the island but outside every named area. */
export function isRemote(p: Place): boolean {
  return p.areaKey === OFF_SYROS.key && p.onIsland;
}
