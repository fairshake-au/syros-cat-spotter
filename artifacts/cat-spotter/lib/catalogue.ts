/**
 * The public cat-alogue on the phone (data spine PR 6; SYC-41;
 * cat-record-data-spine.md §2.3, §6.5).
 *
 * `GET /cats` is paged, so the app walks every page and keeps the whole
 * list, exactly as before: the offline catalogue still works without signal.
 *
 * The cache key carries the viewer tier and a version (§6.5). The list is
 * always the public, blurred view, so only one tier exists. Earlier builds
 * stored exact positions under the old key; that key is never read again,
 * and it's deleted so those positions don't sit on the phone indefinitely.
 */
import { listCats, type Cat, type ListCatsParams } from '@workspace/api-client-react';
import { roundForRoute } from './reviewParams';

/** Never used by any earlier build. */
export const CATS_CACHE_KEY = 'cat-spotter/cats-cache/public/v2';

/** Keys earlier builds wrote, holding exact positions. Deleted, never read. */
export const RETIRED_CATS_CACHE_KEYS = ['cat-spotter/cats-cache'] as const;

/** The server's largest page: fewest round trips. */
export const CATALOGUE_PAGE_SIZE = 200;

/** A safety stop, far beyond any real catalogue (200 × 500 = 100,000 cats). */
const MAX_PAGES = 500;

type Position = { lat: number; lng: number };

/**
 * The phone's position as the catalogue request carries it: rounded to about
 * 110 m (SYC-317), or nothing. `GET /cats?lat=&lng=` puts it in the request's
 * address, which a host's or proxy's access log and the browser's HTTP cache
 * may keep. The list is sorted by distance, so 110 m barely moves the order.
 */
function roundedPosition(params?: Position): Position | undefined {
  if (!params || !Number.isFinite(params.lat) || !Number.isFinite(params.lng)) return undefined;
  return { lat: roundForRoute(params.lat), lng: roundForRoute(params.lng) };
}

export function catalogueParams(lat?: number, lng?: number): Position | undefined {
  return lat !== undefined && lng !== undefined ? roundedPosition({ lat, lng }) : undefined;
}

/** Invalidate this to refresh every screen's catalogue, whatever its position. */
export const CATALOGUE_QUERY_ROOT = ['cat-spotter/catalogue'] as const;

/** One react-query key for "the whole catalogue from here", shared by every screen. */
export function catalogueQueryKey(params?: Position) {
  return [...CATALOGUE_QUERY_ROOT, params ?? null] as const;
}

/**
 * Every page, in the server's order. A cat that appears twice (the list
 * shifted between pages) is kept once, at its first place. If the list
 * shifted so that a cat was skipped (fewer cats than the server's total, or
 * the total changed mid-walk), the walk starts again once, so the offline
 * catalogue isn't left a cat short (review of #95, finding 8).
 */
export async function fetchWholeCatalogue(
  params?: Position,
  fetchPage: (p: ListCatsParams) => ReturnType<typeof listCats> = (p) => listCats(p),
): Promise<Cat[]> {
  // Rounded here too, so no caller can send an exact position (SYC-317).
  const position = roundedPosition(params);
  const first = await walkOnce(position, fetchPage);
  return first.complete ? first.cats : (await walkOnce(position, fetchPage)).cats;
}

async function walkOnce(
  params: Position | undefined,
  fetchPage: (p: ListCatsParams) => ReturnType<typeof listCats>,
): Promise<{ cats: Cat[]; complete: boolean }> {
  const totals = new Set<number>();
  const seen = new Set<number>();
  const cats: Cat[] = [];
  let page: number | null = 1;
  for (let n = 0; page !== null && n < MAX_PAGES; n++) {
    const res = await fetchPage({ ...params, page, pageSize: CATALOGUE_PAGE_SIZE });
    totals.add(res.total);
    for (const cat of res.cats) {
      if (seen.has(cat.id)) continue;
      seen.add(cat.id);
      cats.push(cat);
    }
    page = res.nextPage;
  }
  const [total] = [...totals];
  return { cats, complete: totals.size === 1 && cats.length >= (total ?? 0) };
}

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function readCachedCatalogue(storage: Storage): Promise<Cat[] | null> {
  const raw = await storage.getItem(CATS_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Cat[]) : null;
  } catch {
    return null; // corrupt cache: ignore it
  }
}

export async function writeCachedCatalogue(storage: Storage, cats: Cat[]): Promise<void> {
  await storage.setItem(CATS_CACHE_KEY, JSON.stringify(cats));
}

/** Remove what earlier builds cached, without reading it. */
export async function forgetRetiredCatalogues(storage: Storage): Promise<void> {
  await Promise.all(RETIRED_CATS_CACHE_KEYS.map((k) => storage.removeItem(k)));
}
