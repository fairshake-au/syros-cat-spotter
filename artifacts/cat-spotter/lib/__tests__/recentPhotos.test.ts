/**
 * SYC-166 slice 2, Decision 2 B: the device's list of recent capture times and
 * photo fingerprints (spec §9 test 9; plan "Same-second photos and the same
 * photo twice", P12). Probes 5, 6, 7 and 10a turn a case here red.
 */
import { describe, expect, it } from 'vitest';
import {
  RECENT_PHOTOS_KEY,
  RECENT_PHOTOS_MAX,
  alreadyLoggedDestination,
  clearRecentPhotos,
  entryForOutcome,
  findAlreadyLogged,
  linkRecentPhotoToCat,
  loadRecentPhotos,
  photoFingerprint,
  recordRecentPhoto,
  replaceRecentExtraFingerprint,
  uniqueCaptureTime,
  type RecentPhoto,
  type RecentPhotoStorage,
} from '../recentPhotos';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 12);
const SECOND = Date.UTC(2026, 9, 3, 15, 42, 10);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  const storage: RecentPhotoStorage = {
    getItem: async (k) => (k in data ? data[k] : null),
    setItem: async (k, v) => {
      data[k] = v;
    },
    removeItem: async (k) => {
      delete data[k];
    },
  };
  return { storage, data };
}

/** A base64 string standing in for a photo: `seed` changes the content. */
function fakePhoto(seed: string, length = 200_000): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let x = 0;
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += alphabet[x % 64];
  }
  return out;
}

describe('photoFingerprint', () => {
  it('the same photo gives the same fingerprint', () => {
    expect(photoFingerprint(fakePhoto('a'))).toBe(photoFingerprint(fakePhoto('a')));
  });

  it('two different photos from one burst differ', () => {
    expect(photoFingerprint(fakePhoto('a'))).not.toBe(photoFingerprint(fakePhoto('b')));
  });

  it('same first 64 KB but a different size still differs', () => {
    const a = fakePhoto('a', 200_000);
    expect(photoFingerprint(a)).not.toBe(photoFingerprint(a.slice(0, 190_000)));
  });

  it('reads only the first 64 KB of the photo', () => {
    const a = fakePhoto('a', 200_000);
    const b = a.slice(0, 87_384) + fakePhoto('z', 200_000 - 87_384);
    expect(photoFingerprint(a)).toBe(photoFingerprint(b));
  });
});

describe('uniqueCaptureTime', () => {
  const entry = (capturedAtMs: number): RecentPhoto => ({ capturedAtMs });

  it('a time no entry has is kept as is', () => {
    expect(uniqueCaptureTime(SECOND, [entry(SECOND - 1000)])).toBe(SECOND);
  });

  it('two different photos with the same second: the second is one millisecond later', () => {
    expect(uniqueCaptureTime(SECOND, [entry(SECOND)])).toBe(SECOND + 1);
  });

  it('three in one second get +0, +1, +2', () => {
    const list: RecentPhoto[] = [];
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = uniqueCaptureTime(SECOND, list);
      times.push(t);
      list.push(entry(t));
    }
    expect(times).toEqual([SECOND, SECOND + 1, SECOND + 2]);
  });
});

describe('the stored list', () => {
  it('a fresh device has an empty list', async () => {
    const { storage } = memoryStorage();
    expect(await loadRecentPhotos(storage, NOW)).toEqual([]);
  });

  it.each(['not json', '{"a":1}', '[1,2,3]', 'null', '[{"capturedAtMs":"x"}]'])(
    'corrupt storage %j gives an empty list and never throws',
    async (raw) => {
      const { storage } = memoryStorage({ [RECENT_PHOTOS_KEY]: raw });
      expect(await loadRecentPhotos(storage, NOW)).toEqual([]);
    },
  );

  it('storage that throws gives an empty list, and a failed write never throws', async () => {
    const broken: RecentPhotoStorage = {
      getItem: async () => {
        throw new Error('nope');
      },
      setItem: async () => {
        throw new Error('nope');
      },
      removeItem: async () => {
        throw new Error('nope');
      },
    };
    expect(await loadRecentPhotos(broken, NOW)).toEqual([]);
    await expect(recordRecentPhoto(broken, { capturedAtMs: SECOND }, NOW)).resolves.toBeUndefined();
  });

  it('entries older than 30 days are dropped', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, { capturedAtMs: NOW - 31 * DAY }, NOW);
    await recordRecentPhoto(storage, { capturedAtMs: NOW - 29 * DAY }, NOW);
    expect((await loadRecentPhotos(storage, NOW)).map((e) => e.capturedAtMs)).toEqual([
      NOW - 29 * DAY,
    ]);
  });

  it(`at most ${200} entries are kept, the newest`, async () => {
    expect(RECENT_PHOTOS_MAX).toBe(200);
    const { storage } = memoryStorage();
    for (let i = 0; i < 205; i++) {
      await recordRecentPhoto(storage, { capturedAtMs: SECOND + i }, NOW);
    }
    const list = await loadRecentPhotos(storage, NOW);
    expect(list).toHaveLength(200);
    expect(list.some((e) => e.capturedAtMs === SECOND + 204)).toBe(true);
    expect(list.some((e) => e.capturedAtMs === SECOND)).toBe(false);
  });

  it('clearRecentPhotos empties it', async () => {
    const { storage, data } = memoryStorage();
    await recordRecentPhoto(storage, { capturedAtMs: SECOND, fingerprint: 'f' }, NOW);
    await clearRecentPhotos(storage);
    expect(data[RECENT_PHOTOS_KEY]).toBeUndefined();
    expect(await loadRecentPhotos(storage, NOW)).toEqual([]);
  });

  it('the stored JSON for a photo with a position contains no part of it (P12)', async () => {
    const { storage, data } = memoryStorage();
    // Only these fields can be recorded; a stray position on the entry is dropped.
    await recordRecentPhoto(
      storage,
      {
        capturedAtMs: SECOND,
        fingerprint: photoFingerprint(fakePhoto('a')),
        sightingId: 7,
        lat: 37.4412345,
        lng: 24.9412345,
      } as RecentPhoto,
      NOW,
    );
    expect(data[RECENT_PHOTOS_KEY]).not.toMatch(/37\.44|24\.94|4412345|9412345/);
  });
});

describe('the same photo twice', () => {
  const fp = photoFingerprint(fakePhoto('a'));

  it('the same photo picked twice is caught, with the stored sighting', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('sent', SECOND, fp, { sightingId: 12, isCatPhoto: true })!, NOW);
    const hit = findAlreadyLogged(fp, await loadRecentPhotos(storage, NOW), new Set());
    expect(hit).toMatchObject({ sightingId: 12 });
  });

  it('SYC-186: a sent spot kept in the list carries its card, opens it, and is freed when the card is discarded', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(
      storage,
      entryForOutcome('sent', SECOND, fp, { sightingId: 12, isCatPhoto: true, localId: 'K1' })!,
      NOW,
    );
    const list = await loadRecentPhotos(storage, NOW);
    const hit = findAlreadyLogged(fp, list, new Set(['K1']));
    expect(hit).toMatchObject({ sightingId: 12, localId: 'K1' });
    expect(alreadyLoggedDestination(hit!, [{ localId: 'K1', status: 'review' }])).toEqual({
      kind: 'review',
      localId: 'K1',
    });
    // The card was discarded: the same photo can be sent again.
    expect(findAlreadyLogged(fp, list, new Set())).toBeNull();
  });

  it('a different photo is not caught', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('sent', SECOND, fp, { sightingId: 12, isCatPhoto: true })!, NOW);
    expect(
      findAlreadyLogged(photoFingerprint(fakePhoto('b')), await loadRecentPhotos(storage, NOW), new Set()),
    ).toBeNull();
  });

  it('a saved-for-later photo is caught while its card is still waiting, with its localId', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('saved', SECOND, fp, { localId: 'L1' })!, NOW);
    const list = await loadRecentPhotos(storage, NOW);
    expect(findAlreadyLogged(fp, list, new Set(['L1']))).toMatchObject({ localId: 'L1' });
  });

  it('a saved-for-later photo whose card was discarded can be picked again', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('saved', SECOND, fp, { localId: 'L1' })!, NOW);
    expect(findAlreadyLogged(fp, await loadRecentPhotos(storage, NOW), new Set())).toBeNull();
  });

  it('a photo the server rejected as not a cat is not recorded as a photo, and can be picked again', async () => {
    const { storage } = memoryStorage();
    const entry = entryForOutcome('sent', SECOND, fp, { sightingId: 12, isCatPhoto: false });
    // Its time is still kept: the server stored a sighting at that second.
    expect(entry).toEqual({ capturedAtMs: SECOND, sightingId: 12 });
    await recordRecentPhoto(storage, entry!, NOW);
    const list = await loadRecentPhotos(storage, NOW);
    expect(findAlreadyLogged(fp, list, new Set())).toBeNull();
    expect(uniqueCaptureTime(SECOND, list)).toBe(SECOND + 1);
  });

  it.each(['rejected', 'send-failed', 'save-failed', 'not-saved'] as const)(
    'a %s outcome records nothing',
    (kind) => {
      expect(entryForOutcome(kind, SECOND, fp, {})).toBeNull();
    },
  );

  it('a photo with no fingerprint is recorded by time only', () => {
    expect(entryForOutcome('sent', SECOND, undefined, { sightingId: 3, isCatPhoto: true })).toEqual({
      capturedAtMs: SECOND,
      sightingId: 3,
    });
  });

  it('a retry of one send (never recorded, because it never succeeded) gets the identical time', async () => {
    const { storage } = memoryStorage();
    const first = uniqueCaptureTime(SECOND, await loadRecentPhotos(storage, NOW));
    // The send failed: entryForOutcome gives nothing to record.
    const failed = entryForOutcome('send-failed', first, fp, {});
    if (failed) await recordRecentPhoto(storage, failed, NOW);
    const retry = uniqueCaptureTime(SECOND, await loadRecentPhotos(storage, NOW));
    expect(retry).toBe(first);
  });
});

describe('"Open that sighting" (Decision C2)', () => {
  const pending = [
    { localId: 'Q1', status: 'queued' as const },
    { localId: 'R1', status: 'review' as const },
  ];

  it('once matched, it goes to the cat page', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, { capturedAtMs: SECOND, fingerprint: 'f', sightingId: 12 }, NOW);
    await linkRecentPhotoToCat(storage, { sightingId: 12 }, 44, NOW);
    const [entry] = await loadRecentPhotos(storage, NOW);
    expect(alreadyLoggedDestination(entry, pending)).toEqual({ kind: 'cat', catId: 44 });
  });

  it('a saved-for-later card is linked by its localId when it is matched', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, { capturedAtMs: SECOND, fingerprint: 'f', localId: 'R1' }, NOW);
    await linkRecentPhotoToCat(storage, { sightingId: 99, localId: 'R1' }, 45, NOW);
    const [entry] = await loadRecentPhotos(storage, NOW);
    expect(entry).toMatchObject({ catId: 45, sightingId: 99 });
  });

  it('a card waiting for its review opens that review', () => {
    expect(
      alreadyLoggedDestination({ capturedAtMs: SECOND, fingerprint: 'f', localId: 'R1' }, pending),
    ).toEqual({ kind: 'review', localId: 'R1' });
  });

  it('a card still waiting to be sent has no button (it is on the same screen)', () => {
    expect(
      alreadyLoggedDestination({ capturedAtMs: SECOND, fingerprint: 'f', localId: 'Q1' }, pending),
    ).toBeNull();
  });

  it('a sent sighting not yet matched has no button', () => {
    expect(
      alreadyLoggedDestination({ capturedAtMs: SECOND, fingerprint: 'f', sightingId: 12 }, pending),
    ).toBeNull();
  });
});

describe('the review screen links a matched sighting to its cat (C2)', () => {
  it('calls linkRecentPhotoToCat with the sighting, the card and the cat', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.resolve(__dirname, '../../app/review.tsx'), 'utf8');
    const at = src.indexOf('const finishAndInvalidate');
    const call = src.indexOf('linkRecentPhotoToCat(', at);
    expect(call).toBeGreaterThan(at);
    expect(src.slice(call, call + 200)).toMatch(
      /sightingId: data\.sightingId, localId: data\.localId[\s\S]*res\.cat\.id/,
    );
  });
});

describe('SYC-415: already logged covers every photo of a spot', () => {
  const F2 = { role: 'face' as const, fingerprint: 'F2' };
  const F3 = { role: 'body' as const, fingerprint: 'F3' };

  it('a sent spot records its extra photos too, with their roles', () => {
    expect(entryForOutcome('sent', SECOND, 'F1', { sightingId: 9, isCatPhoto: true }, [F2, F3])).toEqual({
      capturedAtMs: SECOND,
      sightingId: 9,
      fingerprint: 'F1',
      extraFingerprints: [F2, F3],
    });
  });

  it('a saved-for-later spot records its extra photos too', () => {
    expect(entryForOutcome('saved', SECOND, 'F1', { localId: 'L1' }, [F2])).toEqual({
      capturedAtMs: SECOND,
      fingerprint: 'F1',
      localId: 'L1',
      extraFingerprints: [F2],
    });
  });

  it('a spot the server said is not a cat keeps no fingerprints at all (review M5)', () => {
    expect(entryForOutcome('sent', SECOND, 'F1', { sightingId: 9, isCatPhoto: false }, [F2, F3])).toEqual({
      capturedAtMs: SECOND,
      sightingId: 9,
    });
  });

  it('no extras, no extraFingerprints key', () => {
    expect(entryForOutcome('sent', SECOND, 'F1', { sightingId: 9, isCatPhoto: true }, [])).toEqual({
      capturedAtMs: SECOND,
      sightingId: 9,
      fingerprint: 'F1',
    });
  });

  it('finds an extra photo picked again later, as a first photo or an extra', async () => {
    const { storage } = memoryStorage();
    const entry = entryForOutcome('sent', SECOND, 'F1', { sightingId: 9, isCatPhoto: true }, [F2, F3])!;
    await recordRecentPhoto(storage, entry, NOW);
    const list = await loadRecentPhotos(storage, NOW);
    expect(findAlreadyLogged('F3', list, new Set())).toEqual(entry);
    expect(findAlreadyLogged('F1', list, new Set())).toEqual(entry);
    expect(findAlreadyLogged('F9', list, new Set())).toBeNull();
  });

  it('drops an extraFingerprints that is not a list of role + fingerprint pairs', async () => {
    const { storage } = memoryStorage({
      [RECENT_PHOTOS_KEY]: JSON.stringify([
        { capturedAtMs: SECOND, sightingId: 1, extraFingerprints: 'F2' },
        { capturedAtMs: SECOND + 1, sightingId: 2, extraFingerprints: ['F2'] },
        { capturedAtMs: SECOND + 2, sightingId: 3, extraFingerprints: [{ role: 'tail', fingerprint: 'F2' }] },
        { capturedAtMs: SECOND + 3, sightingId: 4, extraFingerprints: [{ role: 'body', fingerprint: 'F4' }] },
      ]),
    });
    const list = await loadRecentPhotos(storage, NOW);
    expect(list.map((e) => e.extraFingerprints)).toEqual([undefined, undefined, undefined, [{ role: 'body', fingerprint: 'F4' }]]);
    expect(findAlreadyLogged('F2', list, new Set())).toBeNull();
  });
});

describe('SYC-415 review: fixing a refused extra on a waiting spot updates "already logged"', () => {
  const F2 = { role: 'face' as const, fingerprint: 'F2' };
  const F3 = { role: 'body' as const, fingerprint: 'F3' };

  it('removing an extra forgets its fingerprint, so the photo can be used again', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('saved', SECOND, 'F1', { localId: 'L1' }, [F2, F3])!, NOW);
    await replaceRecentExtraFingerprint(storage, 'L1', 'face', null, NOW);
    const list = await loadRecentPhotos(storage, NOW);
    expect(list[0].extraFingerprints).toEqual([F3]);
    expect(findAlreadyLogged('F2', list, new Set(['L1']))).toBeNull();
    expect(findAlreadyLogged('F3', list, new Set(['L1']))).not.toBeNull();
  });

  it('replacing an extra records the new photo in its place', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('saved', SECOND, 'F1', { localId: 'L1' }, [F2])!, NOW);
    await replaceRecentExtraFingerprint(storage, 'L1', 'face', 'F9', NOW);
    const list = await loadRecentPhotos(storage, NOW);
    expect(list[0].extraFingerprints).toEqual([{ role: 'face', fingerprint: 'F9' }]);
    expect(findAlreadyLogged('F2', list, new Set(['L1']))).toBeNull();
    expect(findAlreadyLogged('F9', list, new Set(['L1']))).not.toBeNull();
  });

  it('removing the last extra drops the key; other spots are untouched; never throws', async () => {
    const { storage } = memoryStorage();
    await recordRecentPhoto(storage, entryForOutcome('saved', SECOND, 'F1', { localId: 'L1' }, [F2])!, NOW);
    await recordRecentPhoto(storage, entryForOutcome('saved', SECOND + 5, 'G1', { localId: 'L2' }, [{ role: 'face', fingerprint: 'G2' }])!, NOW);
    await replaceRecentExtraFingerprint(storage, 'L1', 'face', null, NOW);
    const list = await loadRecentPhotos(storage, NOW);
    expect('extraFingerprints' in list[0]).toBe(false);
    expect(list[1].extraFingerprints).toEqual([{ role: 'face', fingerprint: 'G2' }]);
    const broken = {
      getItem: async () => { throw new Error('x'); },
      setItem: async () => { throw new Error('x'); },
      removeItem: async () => {},
    };
    await expect(replaceRecentExtraFingerprint(broken, 'L1', 'face', null, NOW)).resolves.toBeUndefined();
  });
});
