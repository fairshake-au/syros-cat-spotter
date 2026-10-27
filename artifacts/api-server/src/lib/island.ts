// Syros: the island box, the one place that says whether a position is on the
// island, and where the team map opens. Lives outside the map code so it
// survives the move to MapLibre (SYC-705 Phase 2).

export interface Position {
  lat: number;
  lng: number;
}

/** Syros, the app's own box (artifacts/cat-spotter/lib/offlineTiles.ts). */
export const ISLAND_BOX = {
  minLat: 37.36,
  maxLat: 37.53,
  minLng: 24.85,
  maxLng: 25.01,
} as const;

/** Where a map opens: the middle of the island. */
export const ISLAND_CENTRE: Position = { lat: 37.445, lng: 24.93 };

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
