// @vitest-environment jsdom
/**
 * The web photo store behind lib/pendingPhotos.ts (spec §3.2), exercised
 * through an in-memory fake of its adapter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  EncodingType: { Base64: 'base64' },
}));

import {
  deletePendingPhoto,
  deleteReviewPhoto,
  durablePhotos,
  isStoredPhotoRef,
  openPhotoForUpload,
  openStoredPhoto,
  readPendingPhoto,
  replacementPhotoKey,
  requestPersistentStorage,
  reviewPhotoKey,
  savePendingPhoto,
  saveWebPhoto,
  setPhotoStoreAdapterForTests,
} from '../pendingPhotos';
import {
  b64,
  createFakePhotoStore,
  memoryLocalStorage,
  type FakePhotoStore,
} from './fakePhotoStore';

let fake: FakePhotoStore;
let urls: string[];

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryLocalStorage());
  fake = createFakePhotoStore();
  setPhotoStoreAdapterForTests(fake.adapter);
  urls = [];
  let n = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    n += 1;
    const url = `blob:test/${n}-${blob.type}-${blob.size}`;
    urls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  setPhotoStoreAdapterForTests(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saveWebPhoto', () => {
  it('stores the bytes under idb:<id> and reads them back intact', async () => {
    const result = await saveWebPhoto('A', b64('photo-A'));
    expect(result).toEqual({ ok: true, ref: 'idb:A' });
    expect(fake.photos.get('A')?.bytes).toBeInstanceOf(ArrayBuffer);
    expect(fake.text('A')).toBe('photo-A');
    expect(await readPendingPhoto('idb:A')).toEqual({
      status: 'ok',
      base64: b64('photo-A'),
    });
  });

  it('strips a data-URL prefix and keeps its media type', async () => {
    const result = await saveWebPhoto('A', `data:image/png;base64,${b64('png-bytes')}`);
    expect(result.ok).toBe(true);
    expect(fake.text('A')).toBe('png-bytes');
    expect(fake.photos.get('A')?.type).toBe('image/png');
  });

  it.each([
    ['the old camera’s empty capture', 'data:,'],
    ['an empty string', ''],
    ['text that is not base64', 'not base64 at all!'],
  ])('refuses %s without storing anything', async (_label, value) => {
    expect(await saveWebPhoto('A', value)).toEqual({ ok: false, reason: 'failed' });
    expect(fake.photos.size).toBe(0);
  });

  it('counts a write whose read-back disagrees as failed', async () => {
    fake.faults.truncatePut = () => true;
    expect(await saveWebPhoto('A', b64('photo-A'))).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('reports a quota error as failed', async () => {
    fake.faults.failPut = () => true;
    expect(await saveWebPhoto('A', b64('photo-A'))).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('reports unavailable where there is no store', async () => {
    setPhotoStoreAdapterForTests(null);
    expect(await saveWebPhoto('A', b64('photo-A'))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('savePendingPhoto on web', () => {
  it('stores the photo and returns its idb: reference', async () => {
    expect(await savePendingPhoto('A', 'blob:x', b64('photo-A'))).toEqual({
      ok: true,
      ref: 'idb:A',
    });
    expect(fake.text('A')).toBe('photo-A');
  });

  it('reports unavailable where the browser cannot keep photos (R3)', async () => {
    vi.stubGlobal('localStorage', memoryLocalStorage({ broken: true }));
    expect(await savePendingPhoto('A', 'blob:x', b64('photo-A'))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(fake.photos.has('A')).toBe(false);
  });

  it('reports failed where it can, but this save did not work', async () => {
    fake.faults.failPut = (id) => id === 'A';
    expect(await savePendingPhoto('A', 'blob:x', b64('photo-A'))).toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});

describe('durablePhotos', () => {
  it('passes when a probe record can be written, read back and deleted', async () => {
    expect(await durablePhotos()).toBe(true);
    expect(fake.calls.putPhoto).toHaveLength(1);
    expect(fake.photos.size).toBe(0);
  });

  it('fails when the write fails, though the database opened', async () => {
    fake.faults.failPut = () => true;
    expect(await durablePhotos()).toBe(false);
  });

  it('fails when localStorage does not work, even if IndexedDB does', async () => {
    vi.stubGlobal('localStorage', memoryLocalStorage({ broken: true }));
    expect(await durablePhotos()).toBe(false);
    expect(fake.calls.putPhoto).toHaveLength(0);
  });

  it('fails where there is no localStorage at all', async () => {
    vi.stubGlobal('localStorage', undefined);
    expect(await durablePhotos()).toBe(false);
  });

  it('fails where there is no IndexedDB', async () => {
    setPhotoStoreAdapterForTests(null);
    expect(await durablePhotos()).toBe(false);
  });

  it('fails, rather than hanging the app, when the store never answers', async () => {
    vi.useFakeTimers();
    fake.faults.beforePut = () => new Promise<void>(() => {});
    const answer = durablePhotos();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await answer).toBe(false);
  });
});

describe('reading and deleting', () => {
  it('tells a photo that is gone apart from one that could not be read', async () => {
    expect(await readPendingPhoto('idb:gone')).toEqual({ status: 'missing' });
    fake.seed('A', 'photo-A');
    fake.faults.failGet = () => true;
    expect(await readPendingPhoto('idb:A')).toEqual({ status: 'error' });
  });

  it('deletes an idb: photo', async () => {
    fake.seed('A', 'photo-A');
    await deletePendingPhoto('idb:A');
    expect(fake.photos.has('A')).toBe(false);
  });

  it('deletes exactly the review photo a submission saved, by sighting id', async () => {
    const saved = await savePendingPhoto(reviewPhotoKey(42), 'blob:x', b64('review'));
    fake.seed(reviewPhotoKey(43), 'other review');
    fake.seed('A', 'queued photo');
    await deleteReviewPhoto(42);
    expect(saved).toEqual({ ok: true, ref: `idb:${reviewPhotoKey(42)}` });
    expect(fake.photos.has(reviewPhotoKey(42))).toBe(false);
    expect([...fake.photos.keys()].sort()).toEqual(['A', reviewPhotoKey(43)]);
  });

  it('recognises idb: references', () => {
    expect(isStoredPhotoRef('idb:A')).toBe(true);
    expect(isStoredPhotoRef('blob:http://x/1')).toBe(false);
    expect(isStoredPhotoRef(undefined)).toBe(false);
  });
});

describe('opening stored photos', () => {
  it('makes an object URL from the stored bytes, and revokes it on release', async () => {
    fake.seed('A', 'photo-A', Date.now(), 'image/png');
    const opened = await openStoredPhoto('idb:A');
    expect(opened?.uri).toMatch(/^blob:test\/1-image\/png-7$/);
    opened?.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(opened?.uri);
  });

  it('passes a file path through untouched', async () => {
    const opened = await openStoredPhoto('file:///documents/pending-photos/A.jpg');
    expect(opened?.uri).toBe('file:///documents/pending-photos/A.jpg');
    opened?.release();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('returns null for a photo the browser cleared', async () => {
    expect(await openStoredPhoto('idb:gone')).toBeNull();
  });

  it('opens an inline photo for upload from its base64, not its dead display URL', async () => {
    const opened = await openPhotoForUpload(
      'blob:http://localhost/revoked-long-ago',
      `data:image/jpeg;base64,${b64('inline')}`,
    );
    expect(opened?.uri).toMatch(/^blob:test\//);
    expect(opened?.uri).not.toContain('revoked-long-ago');
  });
});

describe('replacementPhotoKey', () => {
  it('never reuses the key of the photo it replaces', () => {
    expect(replacementPhotoKey('A', undefined)).toBe('A-r1');
    expect(replacementPhotoKey('A', 'idb:A')).toBe('A-r1');
    expect(replacementPhotoKey('A', 'idb:A-r1')).toBe('A-r2');
    expect(replacementPhotoKey('A', 'file:///documents/pending-photos/A-r3.jpg')).toBe(
      'A-r4',
    );
    expect(replacementPhotoKey('A', 'blob:http://x/1')).toBe('A-r1');
  });
});

describe('replacementPhotoKey with a role (SYC-415)', () => {
  it('keeps the first photo keys unchanged, and gives extras their own prefix', () => {
    expect(replacementPhotoKey('A', 'idb:A', 'first')).toBe('A-r1');
    expect(replacementPhotoKey('A', 'idb:A-face', 'face')).toBe('A-face-r1');
    expect(replacementPhotoKey('A', 'idb:A-face-r1', 'face')).toBe('A-face-r2');
    expect(replacementPhotoKey('A', 'file:///documents/pending-photos/A-body-r4.jpg', 'body')).toBe('A-body-r5');
  });

  it('only counts refs with the same prefix, so the first photo and an extra never collide', () => {
    expect(replacementPhotoKey('A', 'idb:A-r3', 'face')).toBe('A-face-r1');
    expect(replacementPhotoKey('A', 'idb:A-face-r3', 'first')).toBe('A-r1');
    expect(replacementPhotoKey('A', 'idb:A-face-r2', 'body')).toBe('A-body-r1');
  });
});


describe('requestPersistentStorage', () => {
  it('asks once per session', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist },
    });
    requestPersistentStorage();
    requestPersistentStorage();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
