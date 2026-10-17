/**
 * Data spine PR 6 (SYC-41): the phone's copy of the public catalogue.
 * cat-record-data-spine.md §2.3 (paged) and §6.5 (the cache key).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBaseUrl, type Cat, type CatPage, type ListCatsParams } from '@workspace/api-client-react';
import {
  CATALOGUE_PAGE_SIZE,
  CATS_CACHE_KEY,
  RETIRED_CATS_CACHE_KEYS,
  catalogueParams,
  catalogueQueryKey,
  fetchWholeCatalogue,
  forgetRetiredCatalogues,
  readCachedCatalogue,
  writeCachedCatalogue,
} from '../catalogue';
import { appearanceLine } from '../appearance';
import { TRANSLATIONS } from '../i18n';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function cat(id: number): Cat {
  return {
    id,
    name: `Cat ${id}`,
    description: '',
    photoUrl: null,
    lat: 37.44,
    lng: 24.94,
    locationPrecision: 'approximate',
    locationCellM: 250,
    sightingsCount: 1,
    lastSeenAt: '2026-10-01',
    hasHome: false,
    lifeStatus: 'street',
    notSeenSince: null,
    sterilised: { value: null, confidence: 'unknown', clippedTipSightings: 0 },
  };
}

/** A fake server holding `ids`, served `size` per page. */
function server(ids: number[], size = 2) {
  const calls: ListCatsParams[] = [];
  const fetchPage = async (p: ListCatsParams): Promise<CatPage> => {
    calls.push(p);
    const page = p.page ?? 1;
    const slice = ids.slice((page - 1) * size, page * size);
    return {
      cats: slice.map(cat),
      page,
      pageSize: size,
      total: ids.length,
      nextPage: page * size < ids.length ? page + 1 : null,
    };
  };
  return { fetchPage, calls };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn(async (k: string) => data.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn(async (k: string) => void data.delete(k)),
  };
}

describe('fetchWholeCatalogue', () => {
  it('walks every page, in order, so the offline catalogue is complete', async () => {
    const { fetchPage, calls } = server([5, 3, 9, 1, 7]);
    const cats = await fetchWholeCatalogue(undefined, fetchPage);
    expect(cats.map((c) => c.id)).toEqual([5, 3, 9, 1, 7]);
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(calls.every((c) => c.pageSize === CATALOGUE_PAGE_SIZE)).toBe(true);
  });

  it('passes the viewer position on every page', async () => {
    const { fetchPage, calls } = server([1, 2, 3]);
    await fetchWholeCatalogue({ lat: 37.45, lng: 24.93 }, fetchPage);
    for (const c of calls) expect(c).toMatchObject({ lat: 37.45, lng: 24.93 });
  });

  it('keeps a cat once if the list shifted between pages', async () => {
    const pages: CatPage[] = [
      { cats: [cat(1), cat(2)], page: 1, pageSize: 2, total: 3, nextPage: 2 },
      { cats: [cat(2), cat(3)], page: 2, pageSize: 2, total: 3, nextPage: null },
    ];
    const cats = await fetchWholeCatalogue(undefined, async (p) => pages[(p.page ?? 1) - 1]!);
    expect(cats.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('walks again once if a cat was skipped because the list shifted mid-walk', async () => {
    let walk = 0;
    const fetchPage = async (p: ListCatsParams): Promise<CatPage> => {
      if (p.page === 1) walk++;
      // First walk: cat 3 is added between pages, so page 2 starts one later
      // and cat 2 is never seen. Second walk: stable.
      const ids = walk === 1 && p.page === 2 ? [0, 1, 2, 3].slice(2) : [1, 2, 3].slice(((p.page ?? 1) - 1) * 2, (p.page ?? 1) * 2);
      const total = walk === 1 && p.page === 2 ? 4 : 3;
      return { cats: ids.map(cat), page: p.page ?? 1, pageSize: 2, total, nextPage: p.page === 1 ? 2 : null };
    };
    const cats = await fetchWholeCatalogue(undefined, fetchPage);
    expect(walk).toBe(2);
    expect(cats.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('an empty catalogue is one request', async () => {
    const { fetchPage, calls } = server([]);
    expect(await fetchWholeCatalogue(undefined, fetchPage)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("the phone's position in the request (SYC-317)", () => {
  /** A GPS fix to the centimetre, as the phone reports it. */
  const EXACT = { lat: 37.4412345, lng: 24.9412345 };

  afterEach(() => {
    setBaseUrl(null);
    vi.unstubAllGlobals();
  });

  /** The web addresses the real request builder sends, through a stubbed fetch. */
  async function urlsSent(params?: { lat: number; lng: number }): Promise<URL[]> {
    const urls: URL[] = [];
    setBaseUrl('https://apptest.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        urls.push(new URL(String(input instanceof Request ? input.url : input)));
        const body: CatPage = { cats: [], page: 1, pageSize: 200, total: 0, nextPage: null };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await fetchWholeCatalogue(params);
    return urls;
  }

  it('the address carries the position to 3 decimals (about 110 m), never the exact fix', async () => {
    const [url] = await urlsSent(catalogueParams(EXACT.lat, EXACT.lng));
    expect(url!.pathname).toMatch(/\/cats$/);
    expect(url!.searchParams.get('lat')).toBe('37.441');
    expect(url!.searchParams.get('lng')).toBe('24.941');
    // Whole address, so a renamed parameter cannot slip past.
    expect(url!.href).not.toMatch(/\d\.\d{4,}/);
  });

  it('a caller that skips catalogueParams still sends a rounded position', async () => {
    const [url] = await urlsSent(EXACT);
    expect(url!.searchParams.get('lat')).toBe('37.441');
    expect(url!.searchParams.get('lng')).toBe('24.941');
  });

  it('every page carries the rounded position', async () => {
    const { fetchPage, calls } = server([1, 2, 3, 4, 5]);
    await fetchWholeCatalogue(EXACT, fetchPage);
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c).toMatchObject({ lat: 37.441, lng: 24.941 });
  });

  it('no position sends no lat or lng', async () => {
    const [url] = await urlsSent(catalogueParams(undefined, undefined));
    expect(url!.searchParams.has('lat')).toBe(false);
    expect(url!.searchParams.has('lng')).toBe(false);
  });

  it('a position that is not a number is dropped, not sent', () => {
    expect(catalogueParams(Number.NaN, 24.94)).toBeUndefined();
    expect(catalogueParams(37.44, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('a position off the globe is dropped, not sent', async () => {
    expect(catalogueParams(500, 24.94)).toBeUndefined();
    expect(catalogueParams(37.44, -181)).toBeUndefined();
    const [url] = await urlsSent({ lat: 500, lng: 24.94 });
    expect(url!.searchParams.has('lat')).toBe(false);
  });

  it('small moves inside the same 110 m share one cache entry', () => {
    const a = catalogueQueryKey(catalogueParams(37.44121, 24.94121));
    const b = catalogueQueryKey(catalogueParams(37.44139, 24.94139));
    expect(a).toEqual(b);
    expect(catalogueQueryKey(catalogueParams(37.4449, 24.9449))).not.toEqual(a);
  });
});

describe('the cache key (§6.5)', () => {
  it('carries the tier and a version no earlier build used', () => {
    expect(CATS_CACHE_KEY).toBe('cat-spotter/cats-cache/public/v2');
    expect(RETIRED_CATS_CACHE_KEYS).toContain('cat-spotter/cats-cache');
    expect(RETIRED_CATS_CACHE_KEYS).not.toContain(CATS_CACHE_KEY);
  });

  it('the old key is never read: an exact payload left there stays unseen', async () => {
    const storage = memoryStorage({
      'cat-spotter/cats-cache': JSON.stringify([{ ...cat(1), lat: 37.4431234567 }]),
    });
    expect(await readCachedCatalogue(storage)).toBeNull();
    for (const old of RETIRED_CATS_CACHE_KEYS) {
      expect(storage.getItem).not.toHaveBeenCalledWith(old);
    }
  });

  it('the old key is deleted, without being read', async () => {
    const storage = memoryStorage({ 'cat-spotter/cats-cache': '[]' });
    await forgetRetiredCatalogues(storage);
    expect(storage.data.has('cat-spotter/cats-cache')).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('round-trips under the new key and ignores a corrupt cache', async () => {
    const storage = memoryStorage();
    await writeCachedCatalogue(storage, [cat(4)]);
    expect(storage.data.has(CATS_CACHE_KEY)).toBe(true);
    expect((await readCachedCatalogue(storage))?.map((c) => c.id)).toEqual([4]);
    storage.data.set(CATS_CACHE_KEY, '{not json');
    expect(await readCachedCatalogue(storage)).toBeNull();
  });

  it('no source file outside lib/catalogue.ts names a catalogue cache key', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '__tests__', '.expo', 'dist'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith(path.join('lib', 'catalogue.ts'))) {
          if (readFileSync(full, 'utf8').includes('cats-cache')) offenders.push(path.relative(root, full));
        }
      }
    };
    for (const d of ['app', 'components', 'context', 'hooks', 'lib']) walk(path.join(root, d));
    expect(offenders).toEqual([]);
  });
});

// SYC-2 PR 2.1 (coat-markings-and-health.md §8, §10.4; plan test T-cache).
// The new coat and markings fields are additive, so the key stays v2: a
// phone that updates the app with no signal (on the ferry) keeps its
// catalogue. Retired keys are deleted unread, so a bump would empty it.
describe('T-cache: a catalogue saved by the build before SYC-2 still works', () => {
  /** The key every build since data spine PR 6 has written. */
  const V2 = 'cat-spotter/cats-cache/public/v2';

  it('a v2 cache in the shape today\'s build writes (no coat, no markings) is read, and every cat shows no appearance line', async () => {
    const saved = [cat(1), cat(2), cat(3)];
    for (const c of saved) {
      expect('coat' in c).toBe(false);
      expect('markings' in c).toBe(false);
    }
    // Written under the literal key, exactly as the earlier build did.
    const storage = memoryStorage({ [V2]: JSON.stringify(saved) });
    const read = await readCachedCatalogue(storage);
    expect(read?.map((c) => c.id)).toEqual([1, 2, 3]);
    for (const language of ['en', 'el', 'fr'] as const) {
      const t = (k: string) => TRANSLATIONS[language][k] ?? k;
      for (const c of read!) expect(appearanceLine(c, t), `${language} cat ${c.id}`).toBeNull();
    }
    // Starting up forgets only the retired keys, never this one.
    await forgetRetiredCatalogues(storage);
    expect(storage.data.has(V2)).toBe(true);
  });

  it('a cached cat that does carry the fields shows its line offline', async () => {
    const described = { ...cat(4), coat: ['ginger', 'tabby'], markings: ['white_paws'] } as Cat;
    const storage = memoryStorage({ [V2]: JSON.stringify([described]) });
    const [c] = (await readCachedCatalogue(storage))!;
    // SYC-398 A2 (coat-colours-and-pattern.md §6): an old cached coat is
    // translated for display, so it never shows the old word "Tabby".
    expect(appearanceLine(c!, (k) => TRANSLATIONS.en[k] ?? k)).toBe('Ginger · Stripes · White paws');
  });

  it('guard for any later bump: if the key changes, catalogue.ts still reads v2 as a fallback', () => {
    if (CATS_CACHE_KEY === V2) return;
    // Spec §10.4: "the new code reads the old key as a fallback until the
    // first successful fetch and only then deletes it."
    const src = readFileSync(path.join(root, 'lib/catalogue.ts'), 'utf8');
    expect(src, 'catalogue.ts names the previous key').toContain(V2);
    expect(RETIRED_CATS_CACHE_KEYS as readonly string[], 'v2 is not deleted unread').not.toContain(V2);
  });
});
