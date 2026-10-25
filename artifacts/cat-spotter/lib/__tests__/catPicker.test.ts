/**
 * SYC-119 Slice A2: the "Find the cat" list's pure logic.
 * docs/specs/choose-a-different-cat.md §3.2, §4.4, §4.8, §9 and §10.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isNearby,
  nearbyOrder,
  publishedPosition,
  squareCentre,
  type LatLng,
} from '@workspace/geo';
import { ApiError } from '@workspace/api-client-react';
import {
  classifyResolveError,
  isBlankName,
  matchesSearch,
  pickedFromFor,
  noSignalMessage,
  pickerList,
} from '../catPicker';

type PickerCat = { id: number; name: string; lat: number; lng: number };

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ERMOUPOLI: LatLng = { lat: 37.4448, lng: 24.9425 };

function around(r: () => number, c: LatLng, km: number): LatLng {
  return {
    lat: c.lat + ((r() * 2 - 1) * km) / 111.32,
    lng: c.lng + ((r() * 2 - 1) * km) / (111.32 * Math.cos((c.lat * Math.PI) / 180)),
  };
}

const NAMES = ['Agatha', 'Krispy', 'Savma', 'Αγάθη', 'Μπέμπα', 'Zoé', 'Tigré', 'Ούζο'];

/**
 * A public catalogue as the phone receives it: every position is already a
 * cell centre (data spine PR 6).
 */
function catalogue(seed: number, n: number): PickerCat[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${i}` : ''}`,
    ...squareCentre(around(r, ERMOUPOLI, 3)),
  }));
}

describe('SYR numbers in search (test 12)', () => {
  const cat42 = { id: 42, name: 'Agatha', lat: 0, lng: 0 };
  const cat420 = { id: 420, name: 'Krispy', lat: 0, lng: 0 };

  it.each(['SYR-0042', 'syr 42', '0042', '42', ' SYR0042 ', 'syr-42', 'Syr42'])(
    '"%s" finds cat 42 and not cat 420',
    (q) => {
      expect(matchesSearch(cat42, q)).toBe(true);
      expect(matchesSearch(cat420, q)).toBe(false);
    },
  );
});

describe('names in search', () => {
  it('ignores case and Greek or French accents', () => {
    expect(matchesSearch({ id: 1, name: 'Αγάθη', lat: 0, lng: 0 }, 'αγαθη')).toBe(true);
    expect(matchesSearch({ id: 1, name: 'Αγάθη', lat: 0, lng: 0 }, 'ΑΓΆΘΗ')).toBe(true);
    expect(matchesSearch({ id: 1, name: 'Zoé', lat: 0, lng: 0 }, 'zoe')).toBe(true);
    expect(matchesSearch({ id: 1, name: 'Agatha', lat: 0, lng: 0 }, 'gath')).toBe(true);
    expect(matchesSearch({ id: 1, name: 'Agatha', lat: 0, lng: 0 }, 'krispy')).toBe(false);
  });

  // DECISIONS Part 2g: names compare in a folded form where final sigma (ς)
  // is the same letter as σ. Capitals typed mid-word lower-case to ς at the
  // end of the query ("ΝΗΣ" -> "νης"), so without folding, typing the first
  // letters of "Νησος" in capitals, or "αγαθησ" with a medial sigma, misses.
  it('treats final sigma as sigma (Part 2g folding)', () => {
    const nisos = { id: 1, name: 'Νησος', lat: 0, lng: 0 };
    const agathis = { id: 2, name: 'Αγάθης', lat: 0, lng: 0 };
    expect(matchesSearch(nisos, 'ΝΗΣ')).toBe(true);
    expect(matchesSearch(nisos, 'νης')).toBe(true);
    expect(matchesSearch(agathis, 'αγαθησ')).toBe(true);
    expect(matchesSearch(agathis, 'ΑΓΑΘΗΣ')).toBe(true);
  });

  it('an empty search matches every cat', () => {
    expect(matchesSearch({ id: 1, name: 'Agatha', lat: 0, lng: 0 }, '   ')).toBe(true);
  });
});

describe('pickerList', () => {
  it('is the nearby list, nearest first by published square, ties by SYR number', () => {
    const cats = catalogue(1, 150);
    const from = around(rng(2), ERMOUPOLI, 0.5);
    expect(pickerList(from, cats, '').map((c) => c.id)).toEqual(
      nearbyOrder(from, cats).map((c) => c.id),
    );
  });

  it('test 25: the phone lists exactly the cats the server would accept, over a grid of locations', () => {
    const cats = catalogue(3, 200);
    for (let dy = -2; dy <= 2; dy += 0.25) {
      for (let dx = -2; dx <= 2; dx += 0.25) {
        const from = {
          lat: ERMOUPOLI.lat + dy / 111.32,
          lng: ERMOUPOLI.lng + dx / 88.4,
        };
        const listed = new Set(pickerList(from, cats, '').map((c) => c.id));
        for (const cat of cats) {
          // The server's check (routes/sightings.ts) is exactly this call.
          expect(listed.has(cat.id), `cat ${cat.id} at ${dy},${dx}`).toBe(
            isNearby(from, publishedPosition(cat)),
          );
        }
      }
    }
  });

  it('test 28: search never reaches beyond the nearby set', () => {
    const cats = catalogue(4, 200);
    const r = rng(5);
    const queries = ['a', 'Agatha', 'αγ', 'syr 1', '7', 'SYR-0150', 'zoe', 'ούζο', '1'];
    for (let i = 0; i < 30; i++) {
      const from = around(r, ERMOUPOLI, 1);
      const nearby = new Set(nearbyOrder(from, cats).map((c) => c.id));
      for (const q of queries) {
        for (const cat of pickerList(from, cats, q)) {
          expect(nearby.has(cat.id)).toBe(true);
        }
      }
    }
  });

  it('search narrows without reordering (a filtered list is the list with cats removed)', () => {
    const cats = catalogue(6, 200);
    const from = ERMOUPOLI;
    const all = pickerList(from, cats, '').map((c) => c.id);
    const found = pickerList(from, cats, 'a').map((c) => c.id);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(all.length);
    expect(found).toEqual(all.filter((id) => found.includes(id)));
  });

  it('test 2 (phone side): moving cats within their squares changes nothing on screen', () => {
    const cats = catalogue(7, 150);
    const r = rng(8);
    // Each cat's exact position moves somewhere else in its square; the
    // server publishes the same cell centre, so the phone sees no change.
    const moved = cats.map((c) =>
      ({
        ...c,
        ...squareCentre({
          lat: c.lat + (r() * 2 - 1) * 0.0011,
          lng: c.lng + (r() * 2 - 1) * 0.0014,
        }),
      }),
    );
    for (let i = 0; i < 20; i++) {
      const from = around(r, ERMOUPOLI, 1.5);
      expect(pickerList(from, moved, '').map((c) => c.id)).toEqual(
        pickerList(from, cats, '').map((c) => c.id),
      );
    }
  });
});

describe('pickedFromFor', () => {
  it('says "search" when the spotter typed something, "nearby" otherwise', () => {
    expect(pickedFromFor('')).toBe('nearby');
    expect(pickedFromFor('  ')).toBe('nearby');
    expect(pickedFromFor('Aga')).toBe('search');
  });
});

describe('classifyResolveError', () => {
  function apiError(status: number, data: unknown) {
    return new ApiError(
      new Response(JSON.stringify(data), { status }),
      data,
      { method: 'POST', url: '/api/sightings/1/resolve' },
    );
  }

  it('NOT_NEARBY is the refusal', () => {
    expect(
      classifyResolveError(apiError(422, { error: 'x', code: 'NOT_NEARBY' })),
    ).toEqual({ kind: 'not-nearby' });
  });

  it('NAME_TAKEN carries the named cat when the server sends it', () => {
    const cat = { id: 7, name: 'Agatha', photoUrl: '/api/photos/3' };
    expect(
      classifyResolveError(apiError(409, { error: 'x', code: 'NAME_TAKEN', cat })),
    ).toEqual({ kind: 'name-taken', cat });
    expect(
      classifyResolveError(apiError(409, { error: 'x', code: 'NAME_TAKEN' })),
    ).toEqual({ kind: 'name-taken', cat: null });
  });

  it('OFFENSIVE_NAME is its own case', () => {
    expect(
      classifyResolveError(apiError(400, { error: 'x', code: 'OFFENSIVE_NAME' })),
    ).toEqual({ kind: 'offensive' });
  });

  it('SYR_SHAPED_NAME is its own case', () => {
    expect(
      classifyResolveError(apiError(400, { error: 'x', code: 'SYR_SHAPED_NAME' })),
    ).toEqual({ kind: 'syr-shaped' });
  });

  it('test 10: a request that never reached the server is "no signal"', () => {
    expect(classifyResolveError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'offline',
    });
  });

  it('anything else is a plain error', () => {
    expect(classifyResolveError(apiError(500, null))).toEqual({ kind: 'error' });
  });
});

describe('source guards', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

  it('tests 1 and 18: the picker never sees what the matcher compared or suggested', () => {
    // The list is built as if the matcher had never run (spec §4.4). Neither
    // the picker nor what review.tsx hands it may use the candidates.
    for (const file of ['lib/catPicker.ts', 'components/CatPicker.tsx']) {
      expect(read(file), file).not.toMatch(/candidate/i);
    }
    const review = read('app/review.tsx');
    const pickerUse = review.slice(review.indexOf('<CatPicker'));
    const props = pickerUse.slice(0, pickerUse.indexOf('/>'));
    expect(props).not.toMatch(/candidate/i);
    expect(review).not.toMatch(/cats\s*\.filter\([^)]*candidate/i);
  });

  it('test 26: the list is measured from the sighting\'s saved location, never the phone\'s', () => {
    for (const file of ['lib/catPicker.ts', 'components/CatPicker.tsx']) {
      const src = read(file);
      expect(src, file).not.toMatch(/useLocation|expo-location|getCurrentPosition/);
    }
    const review = read('app/review.tsx');
    expect(review).not.toMatch(/useLocation|expo-location/);
  });

  it('the picker never shows a distance', () => {
    expect(read('components/CatPicker.tsx')).not.toMatch(/distanceKm|\bkm\b/);
  });
});

// Review of #52: "Your sighting is saved. Finish this when you're back
// online" is only true for a sighting in the phone's review list (one that
// went through the queue). A sighting sent straight away has no entry there:
// once the spotter leaves the screen, there is no way back to it. So it gets
// an honest line instead of a promise the app can't keep.
describe('noSignalMessage', () => {
  it('promises the review list only for a queued sighting', () => {
    expect(noSignalMessage({ inReviewList: true })).toBe('pickerNoSignal');
    expect(noSignalMessage({ inReviewList: false })).toBe('pickerNoSignalStay');
  });

  it('the review screen never shows the promise directly', () => {
    const src = readFileSync(path.resolve(__dirname, '../../app/review.tsx'), 'utf8');
    expect(src).not.toMatch(/["']pickerNoSignal["']/);
    expect(src).toMatch(/noSignalMessage\(/);
  });
});


describe('the new-cat request (SYC-151)', () => {
  it('says whether the spotter opened "Find the cat yourself" first', async () => {
    const { newCatRequest } = await import('../catPicker');
    expect(newCatRequest('dev-1', '  Agatha ', true)).toEqual({
      deviceId: 'dev-1',
      newCatName: 'Agatha',
      openedPicker: true,
    });
    expect(newCatRequest('dev-1', 'Agatha', false)).toEqual({
      deviceId: 'dev-1',
      newCatName: 'Agatha',
      openedPicker: false,
    });
  });

  it('SYC-398 PR D: carries colourFilterOn only when the picker said', async () => {
    const { newCatRequest } = await import('../catPicker');
    expect(newCatRequest('dev-1', 'Agatha', true, true)).toEqual({
      deviceId: 'dev-1',
      newCatName: 'Agatha',
      openedPicker: true,
      colourFilterOn: true,
    });
    expect(newCatRequest('dev-1', 'Agatha', true, false)).toMatchObject({ colourFilterOn: false });
    expect(newCatRequest('dev-1', 'Agatha', true)).not.toHaveProperty('colourFilterOn');
  });

  it('review.tsx builds its new-cat request with it, from the picker having been opened', () => {
    const review = readFileSync(path.resolve(__dirname, '../../app/review.tsx'), 'utf8');
    // SYC-398 PR D adds the optional colour-filter flag after it.
    expect(review).toMatch(/newCatRequest\(\s*deviceId,\s*newName,\s*openedPicker(,\s*pickerFilterOn)?\s*\)/);
    expect(review).toMatch(/setOpenedPicker\(true\)/);
  });
});

describe('isBlankName (SYC-101)', () => {
  it('treats empty, spaces and invisible-only names as blank', () => {
    expect(isBlankName('')).toBe(true);
    expect(isBlankName('  \u00a0 ')).toBe(true);
    expect(isBlankName('\u200b\u2060\u200b')).toBe(true);
  });
  it('keeps any real name, including a single accent-bearing letter or emoji', () => {
    expect(isBlankName('Ή')).toBe(false);
    expect(isBlankName('🐈')).toBe(false);
    expect(isBlankName(' Μιμή ')).toBe(false);
  });
});
