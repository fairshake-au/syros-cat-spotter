import { haversineKm, squareCentre, type LatLng } from "@workspace/geo";

/**
 * Location blurring (cat-record-data-spine.md §6.2, §10.6; data spine plan
 * PR 6). Pure.
 *
 * Every public cat position is the centre of the fixed 250 m cell its exact
 * position falls in. Deterministic: a thousand requests return one answer,
 * so sampling one cat repeatedly yields nothing (§6.2 Option C).
 *
 * The honest guarantee: the public knows which 250 m square the cat is in,
 * and nothing finer. The grid is public. A secret grid origin was tried and
 * dropped (Samuel, 6 Oct 2026, review of #95): every published point is a
 * cell centre, so any one of them gives the origin away, and the secret
 * protected nothing while making the server refuse to start without it.
 */

/** Side of a published cell, in metres. The one configuration value (§6.2). */
export const BLUR_CELL_METRES = 250;
// BLUR_DISPLAY_RADIUS_METRES is retired: the client draws the cell (§6.2).

/** Decimal places kept in a published coordinate: about 0.1 m. */
const PUBLISHED_DECIMALS = 6;

function round(n: number): number {
  return Number(n.toFixed(PUBLISHED_DECIMALS));
}

/**
 * The centre of the 250 m cell (lat, lng) falls in, on lib/geo's grid.
 * Idempotent: a published centre maps to itself.
 */
export function blurPosition(lat: number, lng: number): LatLng {
  const c = squareCentre({ lat, lng });
  return { lat: round(c.lat), lng: round(c.lng) };
}

/**
 * Public distance from the viewer to a cat (§6.4.2): measured to the cat's
 * published cell centre, never its exact position, and rounded to 100 m, so
 * three distances can't be trilaterated back to the truth.
 */
export function publicDistanceKm(
  fromLat: number,
  fromLng: number,
  catLat: number,
  catLng: number,
): number {
  const published = blurPosition(catLat, catLng);
  const km = haversineKm({ lat: fromLat, lng: fromLng }, published);
  return Math.round(km * 10) / 10;
}
