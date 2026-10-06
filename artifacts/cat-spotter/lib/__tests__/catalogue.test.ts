/**
 * Data spine PR 6 (SYC-41): the phone's copy of the public catalogue.
 * cat-record-data-spine.md §2.3 (paged) and §6.5 (the cache key).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Cat, CatPage, ListCatsParams } from '@workspace/api-client-react';
import {
  CATALOGUE_PAGE_SIZE,
  CATS_CACHE_KEY,
  RETIRED_CATS_CACHE_KEYS,
  fetchWholeCatalogue,
  forgetRetiredCatalogues,
  readCachedCatalogue,
  writeCachedCatalogue,
} from '../catalogue';

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

  it('an empty catalogue is one request', async () => {
    const { fetchPage, calls } = server([]);
    expect(await fetchWholeCatalogue(undefined, fetchPage)).toEqual([]);
    expect(calls).toHaveLength(1);
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
