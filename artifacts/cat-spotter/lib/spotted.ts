/**
 * Spotted stamps (SYC-505, docs/specs/spotted-stamps.md). The rules for the
 * Home hero, the strip heading and the Cat-alogue filter live here, pure, so
 * they are tested without a screen.
 */
import { NEARBY_KM } from '@workspace/geo';

export type HomeHero = 'firstSpot' | 'progress' | 'unknown';

// Spec §3.2: no list from the server means "unknown", never "zero spotted".
export function homeHeroState(
  profile: { catsSpotted?: number; spottedCatIds?: unknown } | undefined,
): HomeHero {
  if (!Array.isArray(profile?.spottedCatIds)) return 'unknown';
  return profile.catsSpotted === 0 && profile.spottedCatIds.length === 0
    ? 'firstSpot'
    : 'progress';
}

// Spec §3.2: say "near you" only when some cat really is within NEARBY_KM.
export function stripHeadingKey(
  hasCoords: boolean,
  cats: ReadonlyArray<{ distanceKm?: number | null }>,
): 'homeNearbyEyebrow' | 'homeToCollectEyebrow' {
  const someNear = cats.some((c) => c.distanceKm != null && c.distanceKm <= NEARBY_KM);
  return hasCoords && someNear ? 'homeNearbyEyebrow' : 'homeToCollectEyebrow';
}

export type CatalogueFilter = 'all' | 'nearby' | 'homed' | 'notSpotted';

// Spec §3.3: without collection data "Not spotted yet" cannot be answered, so show all.
export function effectiveFilter(
  filter: CatalogueFilter,
  hasCollectionData: boolean,
): CatalogueFilter {
  return filter === 'notSpotted' && !hasCollectionData ? 'all' : filter;
}

// Spec §3.3: which empty message to show, in precedence order.
export function catalogueEmptyKey(args: {
  filter: CatalogueFilter;
  hasCoords: boolean;
  catCount: number;
  search: string;
}): 'filterNeedsLocation' | 'noCats' | 'filterNotSpottedAllDone' | 'noCatsSearch' {
  if (args.filter === 'nearby' && !args.hasCoords) return 'filterNeedsLocation';
  if (args.catCount === 0) return 'noCats';
  if (args.filter === 'notSpotted' && args.search.trim() === '') {
    return 'filterNotSpottedAllDone';
  }
  return 'noCatsSearch';
}
