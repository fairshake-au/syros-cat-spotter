// Stub: the tests in index.test.ts are written first (TDD) and must fail.
export type LatLng = { lat: number; lng: number };
export const NEARBY_KM = NaN;
export const CELL_LAT_DEG = NaN;
export const CELL_LNG_DEG = NaN;
const todo = (): never => {
  throw new Error('lib/geo: not implemented yet');
};
export const haversineKm = (_a: LatLng, _b: LatLng): number => todo();
export const squareCentre = (_p: LatLng): LatLng => todo();
export const publishedPosition = (_p: LatLng): LatLng => todo();
export const isNearby = (_s: LatLng, _p: LatLng): boolean => todo();
export const nearbyOrder = <T extends LatLng & { id: number }>(
  _s: LatLng,
  _cats: readonly T[],
): T[] => todo();
