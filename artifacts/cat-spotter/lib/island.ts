/**
 * SYC-166 slice 4: where Syros is, for the app. Pure, with no imports, so the
 * server's own on-Syros check (SYC-249) can copy it unchanged.
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

/** Where the map starts when there is no usable position: Ermoupoli's centre. */
export const ERMOUPOLI = { latitude: 37.4449, longitude: 24.9433 };

export function isOnSyros(lat: number, lng: number, marginDeg: number = SYROS_MARGIN_DEG): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= SYROS_RECT.minLat - marginDeg &&
    lat <= SYROS_RECT.maxLat + marginDeg &&
    lng >= SYROS_RECT.minLon - marginDeg &&
    lng <= SYROS_RECT.maxLon + marginDeg
  );
}
