import { haversineKm } from "./catHelpers";

/**
 * SYC-39: a new photo is only compared with cats whose stored position is
 * within this distance of where it was taken. 500 m is the figure agreed with
 * Syros Cats (PRODUCT-SPEC.md §2.3).
 *
 * Measured on EXACT positions, deliberately. This overrides
 * cat-record-data-spine.md §6.3 point 1 (grid-snapped candidates at 750 m);
 * see DECISIONS.md, 30 September 2026, before changing it.
 *
 * The stored position is where the cat was first spotted, until SYC-80 adds
 * a derived "usual" position.
 */
export const MATCH_RADIUS_KM = 0.5;

/** At most this many nearby cats are sent to the vision model. */
export const MAX_CANDIDATES = 10;

/**
 * The cats a new photo should be compared with: those within
 * MATCH_RADIUS_KM of (lat, lng), nearest first, at most MAX_CANDIDATES.
 * Returns an empty list when none are close enough; the app then goes
 * straight to "add a new cat".
 */
export function selectCandidateCats<T extends { lat: number; lng: number }>(
  cats: readonly T[],
  lat: number,
  lng: number,
): T[] {
  return cats
    .map((cat) => ({ cat, dist: haversineKm(lat, lng, cat.lat, cat.lng) }))
    .filter((c) => c.dist <= MATCH_RADIUS_KM)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.cat);
}
