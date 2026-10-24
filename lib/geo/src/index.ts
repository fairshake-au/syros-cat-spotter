/**
 * The one definition of "nearby" (SYC-119, docs/specs/choose-a-different-cat.md
 * §4.4 and §4.8). The phone's "Find the cat" list and the server's check on a
 * hand pick both import this, so they can't disagree (spec §10 test 25).
 *
 * Nothing here ever works from a cat's exact position. Distances and order are
 * measured to the centre of the cat's published 250 m square
 * (cat-record-data-spine.md §6.2, §6.4.2–3), because an order or a refusal
 * worked out from exact distance lets someone locate the cat by asking from
 * different places.
 *
 * Data spine PR 6 (blurring) has landed: the public payload itself carries
 * each cat's cell centre (artifacts/api-server/src/lib/blur.ts, on this
 * file's grid). So `publishedPosition` reads that position as it is and never
 * snaps again, and the server's hand-pick check passes it the same centre.
 * The payload is the one source of truth for where the public thinks a cat
 * is.
 */

export type LatLng = { lat: number; lng: number };

/** "Nearby" everywhere in the app: the Cats tab filter and the picker. */
export const NEARBY_KM = 1.5;

/** Side of a published square (cat-record-data-spine.md §6.2). */
export const CELL_METRES = 250;

const EARTH_RADIUS_KM = 6371;
const METRES_PER_DEGREE_LAT = 111_320;
/** Longitude steps are scaled at Syros's latitude so squares stay square. */
const SYROS_LAT = 37.44;

export const CELL_LAT_DEG = CELL_METRES / METRES_PER_DEGREE_LAT;
export const CELL_LNG_DEG =
  CELL_LAT_DEG / Math.cos((SYROS_LAT * Math.PI) / 180);

/**
 * Inclusive edge: "within 1.5 km" accepts exactly 1.5 km (spec test 22). The
 * slack is a micrometre, only there to absorb floating-point rounding.
 */
const EDGE_SLACK_KM = 1e-9;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * The centre of the 250 m square a point falls in, on a public grid with its
 * origin at 0°, 0°. The server's blurPosition (blur.ts) publishes on this
 * grid. The grid is public on purpose: a secret origin was dropped because
 * any one published centre gives it away (Samuel, 6 Oct 2026).
 */
export function squareCentre(p: LatLng): LatLng {
  return {
    lat: (Math.floor(p.lat / CELL_LAT_DEG) + 0.5) * CELL_LAT_DEG,
    lng: (Math.floor(p.lng / CELL_LNG_DEG) + 0.5) * CELL_LNG_DEG,
  };
}

/**
 * Where the public may consider a cat to be: the centre of its 250 m cell,
 * exactly as the public cat payload gives it. Never snapped again here (data
 * spine PR 6): pass the payload's lat/lng on the phone, and the server's
 * blurPosition() result on the server.
 */
export function publishedPosition(cat: LatLng): LatLng {
  return { lat: cat.lat, lng: cat.lng };
}

/**
 * Is a cat's published position within 1.5 km (inclusive) of where the photo
 * was taken? `sighting` is the location saved with the sighting, never the
 * phone's current one (spec §4.8, test 26).
 */
export function isNearby(sighting: LatLng, published: LatLng): boolean {
  return haversineKm(sighting, published) <= NEARBY_KM + EDGE_SLACK_KM;
}

/**
 * "Cats known around here": the cats whose published square is nearby,
 * nearest first by published square, ties broken by SYR number (the cat id),
 * lowest first. Returns the caller's own objects in a new array. The cats
 * must be the public payload's, whose positions are already cell centres.
 */
export function nearbyOrder<T extends LatLng & { id: number }>(
  sighting: LatLng,
  cats: readonly T[],
): T[] {
  return cats
    .map((cat) => ({
      cat,
      km: haversineKm(sighting, publishedPosition(cat)),
    }))
    .filter(({ km }) => km <= NEARBY_KM + EDGE_SLACK_KM)
    .sort((a, b) => a.km - b.km || a.cat.id - b.cat.id)
    .map(({ cat }) => cat);
}

export { SYROS_OUTLINE } from "./syrosOutline";
