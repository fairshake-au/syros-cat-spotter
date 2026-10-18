import { db, namedAreasTable } from "@workspace/db";
import { asc, isNull } from "drizzle-orm";
import { haversineKm } from "../catHelpers";
import { logger } from "../logger";
import { areaEventCount } from "./areaHistory";
import { SEED_AREAS, type NamedArea } from "./seedAreas";

// Named areas (spec §3.3): each has one centre, and a place belongs to the
// area whose centre is nearest. More than MAX_KM from every centre is
// "Off Syros".
//
// SYC-396 PR 2.4 (plan Decision 9): the list lives in the `named_areas` table
// and the team edits it on the Areas page. `areaFor` and `areaByKey` stay
// synchronous by reading a cache of it:
// - `loadAreas()` fills it, before the server listens (index.ts);
// - after that, a call that finds it older than AREAS_TTL_MS starts a reload
//   in the background and answers from what it has, so every server sees a
//   change within a minute;
// - `changeArea` reloads it at once on the server that made the change;
// - a reload that fails keeps the last good list and logs a warning. It never
//   empties the list.
// Until the first load (and in tests that never load), it answers from
// SEED_AREAS, version 1 of the list.

export type { NamedArea } from "./seedAreas";
export { SEED_AREAS } from "./seedAreas";

export const OFF_SYROS = { key: "off", name: "Off Syros" } as const;
const MAX_KM = 2;
export const AREAS_TTL_MS = 60_000;

interface Cache {
  areas: readonly NamedArea[];
  version: number;
  loadedAt: number;
}
let cache: Cache | null = null;
let reloading: Promise<void> | null = null;

/**
 * Reads the areas still in use, in the order they were added, and the
 * version. On failure, keeps whatever list it had and logs a warning.
 */
export async function loadAreas(): Promise<void> {
  try {
    const [rows, version] = await Promise.all([
      db
        .select({
          key: namedAreasTable.key,
          name: namedAreasTable.name,
          lat: namedAreasTable.lat,
          lng: namedAreasTable.lng,
        })
        .from(namedAreasTable)
        .where(isNull(namedAreasTable.retiredAt))
        .orderBy(asc(namedAreasTable.id)),
      areaEventCount(),
    ]);
    cache = { areas: Object.freeze(rows), version, loadedAt: Date.now() };
  } catch (err) {
    logger.warn({ err }, "named areas: reload failed; keeping the last good list");
    // Try again after another TTL, not on every call.
    cache = cache ? { ...cache, loadedAt: Date.now() } : { areas: SEED_AREAS, version: 0, loadedAt: Date.now() };
  }
}

/** Starts a background reload if the cache is stale and none is running. */
function refreshIfStale(): void {
  if (cache === null || reloading !== null) return;
  if (Date.now() - cache.loadedAt <= AREAS_TTL_MS) return;
  reloading = loadAreas().finally(() => {
    reloading = null;
  });
}

/** The areas in use now, from the cache. */
export function currentAreas(): readonly NamedArea[] {
  refreshIfStale();
  return cache?.areas ?? SEED_AREAS;
}

/**
 * The list's version: how many changes it has had (the seed is 21). 0 until
 * the first load.
 */
export function areasVersion(): number {
  refreshIfStale();
  return cache?.version ?? 0;
}

/** The nearest area within MAX_KM of a place, in a given list. Pure. */
export function areaForIn(
  areas: readonly NamedArea[],
  lat: number,
  lng: number,
): NamedArea | typeof OFF_SYROS {
  let best: NamedArea | null = null;
  let bestKm = Infinity;
  for (const a of areas) {
    const km = haversineKm(lat, lng, a.lat, a.lng);
    if (km < bestKm) {
      best = a;
      bestKm = km;
    }
  }
  return best !== null && bestKm <= MAX_KM ? best : OFF_SYROS;
}

export function areaFor(lat: number, lng: number): NamedArea | typeof OFF_SYROS {
  return areaForIn(currentAreas(), lat, lng);
}

export const areaByKey = (key: unknown): NamedArea | undefined =>
  typeof key === "string" ? currentAreas().find((a) => a.key === key) : undefined;

/** Tests only: forget the cache, as a freshly started server would. */
export function _resetAreasCacheForTests(): void {
  cache = null;
  reloading = null;
}
