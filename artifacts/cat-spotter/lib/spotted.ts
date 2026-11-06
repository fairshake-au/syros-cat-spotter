/**
 * Spotted stamps (SYC-505, docs/specs/spotted-stamps.md). The rules for the
 * Home hero, the strip heading and the Cat-alogue filter live here, pure, so
 * they are tested without a screen.
 */
import { NEARBY_KM } from '@workspace/geo';
import { areaSearchText } from './areaNames';
import type { Language } from './i18n';

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

export type CatalogueFilter = 'all' | 'nearby' | 'homed' | 'noHome' | 'notSpotted';

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
}): 'filterNeedsLocation' | 'noCats' | 'filterNotSpottedAllDone' | 'filterNoHomeEmpty' | 'noCatsSearch' {
  if (args.filter === 'nearby' && !args.hasCoords) return 'filterNeedsLocation';
  if (args.catCount === 0) return 'noCats';
  if (args.filter === 'notSpotted' && args.search.trim() === '') {
    return 'filterNotSpottedAllDone';
  }
  // SYC-810: with no search typed, an empty No home list means every cat has a home.
  if (args.filter === 'noHome' && args.search.trim() === '') return 'filterNoHomeEmpty';
  return 'noCatsSearch';
}

/**
 * Whether a cat shows under the typed search and the chosen filter. The
 * search looks at the name, description, id and the cat's area (SYC-810),
 * in the shown name and the server's name. `noHome` needs `hasHome` to be
 * exactly false: a cat cached by an older app has no such field and is left
 * out. `query` is already trimmed and lower-cased.
 */
export function catalogueMatches(
  cat: {
    id: number;
    name: string;
    description?: string | null;
    hasHome?: boolean;
    lifeStatus?: string;
    distanceKm?: number | null;
    areaKey?: string | null;
    areaName?: string | null;
  },
  args: { query: string; filter: CatalogueFilter; spottedIds: ReadonlySet<number>; language: Language },
): boolean {
  if (args.query) {
    const haystack = [cat.name, cat.description, String(cat.id), areaSearchText(cat, args.language)]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(args.query)) return false;
  }
  switch (args.filter) {
    case 'nearby':
      // distanceKm is only present when the list was fetched with coords.
      return cat.distanceKm != null && cat.distanceKm <= NEARBY_KM;
    case 'homed':
      return Boolean(cat.hasHome);
    case 'noHome':
      // Not a cat in care or one who has died: neither is a cat with no home.
      return cat.hasHome === false && cat.lifeStatus !== 'in_care' && cat.lifeStatus !== 'deceased';
    case 'notSpotted':
      return !args.spottedIds.has(cat.id);
    default:
      return true;
  }
}
