// @vitest-environment jsdom
/**
 * The offline queue on the web build, with the photo store replaced by an
 * in-memory fake of its adapter (spec §6: no new dependency).
 */
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storage,
  getItem,
  setItem,
  netInfoListeners,
  createSighting,
  manipulateAsync,
} = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    netInfoListeners: [] as Array<
      (state: { isConnected: boolean; type?: string; details?: object }) => void
    >,
    createSighting: vi.fn(),
    manipulateAsync: vi.fn(async () => ({
      uri: 'blob:optimized',
      base64: 'optimized-photo-data',
    })),
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: null,
  EncodingType: { Base64: 'base64' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((cb: (typeof netInfoListeners)[number]) => {
      netInfoListeners.push(cb);
      return () => {};
    }),
  },
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync,
  SaveFormat: { JPEG: 'jpeg' },
}));

const { ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message = `HTTP ${status}`, data: unknown = null) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return { ApiError };
});
vi.mock('@workspace/api-client-react', () => ({
  createSighting: (...args: unknown[]) => createSighting(...args),
  ApiError,
}));

vi.mock('../DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'device-1' }),
}));

import {
  OfflineProvider,
  QueueWriteError,
  useOffline,
  type PendingSighting,
} from '../OfflineContext';
import { setPhotoStoreAdapterForTests } from '@/lib/pendingPhotos';
import {
  b64,
  createFakePhotoStore,
  memoryLocalStorage,
  type FakePhotoStore,
} from '@/lib/__tests__/fakePhotoStore';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

type OfflineValue = ReturnType<typeof useOffline>;

let fake: FakePhotoStore;
let objectUrls: string[];

function mount() {
  const ref: { current: OfflineValue | null } = { current: null };
  function Probe() {
    ref.current = useOffline();
    return null;
  }
  const { unmount } = render(
    <OfflineProvider>
      <Probe />
    </OfflineProvider>,
  );
  return { ctx: ref as { current: OfflineValue }, unmount };
}

function renderProvider() {
  return mount().ctx;
}

async function renderLoaded() {
  const ctx = renderProvider();
  await waitFor(() => expect(ctx.current.ready).toBe(true));
  return ctx;
}

function item(localId: string, overrides: Partial<PendingSighting> = {}): PendingSighting {
  return {
    localId,
    photoUri: `idb:${localId}`,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
    status: 'queued',
    ...overrides,
  };
}

function seedQueue(items: PendingSighting[]) {
  storage.set(QUEUE_KEY, JSON.stringify(items));
}

function saved(): PendingSighting[] {
  const raw = storage.get(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as PendingSighting[]) : [];
}

const cellular = { isConnected: true, type: 'cellular', details: { cellularGeneration: '4g' } };

beforeEach(() => {
  storage.clear();
  netInfoListeners.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', memoryLocalStorage());
  fake = createFakePhotoStore();
  setPhotoStoreAdapterForTests(fake.adapter);
  objectUrls = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${objectUrls.length + 1}`;
    objectUrls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  createSighting.mockResolvedValue({ sightingId: 4, isCatPhoto: true, candidates: [] });
});

afterEach(() => {
  // Unmount every provider rendered by the test that just ran. Without
  // this, a provider left mounted (renderProvider() discards `unmount`)
  // keeps its `window` "focus" listener registered — and the pre-launch
  // gate tests below rely on that listener being scoped to one test.
  cleanup();
  setPhotoStoreAdapterForTests(undefined);
  vi.unstubAllGlobals();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A sighting queued before this change: its photo inline in the list. */
function inlineItem(localId: string, photo = b64(`photo-${localId}`)): PendingSighting {
  return item(localId, {
    photoUri: `blob:http://localhost/${localId}-from-last-session`,
    photoBase64: photo,
  });
}

function newSighting(localId: string) {
  return {
    localId,
    photoBase64: b64(`photo-${localId}`),
    photoUri: `blob:http://localhost/${localId}`,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
  };
}

const byId = (list: PendingSighting[]) =>
  Object.fromEntries(list.map((p) => [p.localId, p]));

const DAY = 24 * 60 * 60 * 1000;

describe('moving photos already queued inline (spec §3.3)', () => {
  it('backs up the saved list, moves each photo, reads it back, and strips the list', async () => {
    const legacyCamera = `data:image/jpeg;base64,${b64('photo-B')}`;
    seedQueue([
      inlineItem('A'),
      // The pre-PR-#9 camera: a data URL in both fields.
      item('B', { photoUri: legacyCamera, photoBase64: legacyCamera }),
    ]);
    const before = storage.get(QUEUE_KEY);
    const ctx = await renderLoaded();

    expect([...fake.backups.values()].map((b) => b.raw)).toEqual([before]);
    expect(fake.text('A')).toBe('photo-A');
    expect(fake.text('B')).toBe('photo-B');
    const stored = byId(saved());
    expect(stored.A).toMatchObject({ photoUri: 'idb:A' });
    expect(stored.A.photoBase64).toBeUndefined();
    expect(stored.B).toMatchObject({ photoUri: 'idb:B' });
    expect(stored.B.photoBase64).toBeUndefined();
    expect(storage.get(QUEUE_KEY)).not.toContain('data:');
    expect(ctx.current.pending.map((p) => p.photoUri)).toEqual(['idb:A', 'idb:B']);
  });

  it('F1: a photo that cannot be moved stays inline, the others move, and the next save loses nothing', async () => {
    seedQueue([
      inlineItem('A'),
      // An empty canvas from the old camera: not base64 at all.
      item('B', { photoUri: 'data:,', photoBase64: 'data:,' }),
    ]);
    const ctx = await renderLoaded();

    expect(ctx.current.pending.map((p) => p.localId)).toEqual(['A', 'B']);
    let stored = byId(saved());
    expect(stored.A.photoUri).toBe('idb:A');
    expect(stored.B.photoBase64).toBe('data:,');

    // The tester queues another sighting.
    await act(async () => {
      await ctx.current.enqueue(newSighting('C'));
    });
    stored = byId(saved());
    expect(Object.keys(stored)).toEqual(['A', 'B', 'C']);
    expect(stored.A.photoUri).toBe('idb:A');
    expect(stored.B.photoBase64).toBe('data:,');
    expect(stored.C.photoUri).toBe('idb:C');
    expect(fake.text('A')).toBe('photo-A');
  });

  it('F1: a quota error on one photo leaves it inline without stopping the rest', async () => {
    seedQueue([inlineItem('A'), inlineItem('B')]);
    fake.faults.failPut = (id) => id === 'A';
    await renderLoaded();

    const stored = byId(saved());
    expect(stored.A.photoBase64).toBe(b64('photo-A'));
    expect(stored.B.photoUri).toBe('idb:B');
    expect(stored.B.photoBase64).toBeUndefined();
  });

  it('a photo whose read-back disagrees is not stripped from the list', async () => {
    seedQueue([inlineItem('A')]);
    fake.faults.truncatePut = (id) => id === 'A';
    const ctx = await renderLoaded();

    expect(saved()[0].photoBase64).toBe(b64('photo-A'));
    expect(ctx.current.pending[0].photoBase64).toBe(b64('photo-A'));
  });

  it('if the backup cannot be written, nothing moves on this load', async () => {
    seedQueue([inlineItem('A'), inlineItem('B')]);
    const before = storage.get(QUEUE_KEY);
    fake.faults.failBackup = true;
    const ctx = await renderLoaded();

    expect(fake.calls.putPhoto.filter((id) => !id.startsWith('probe-'))).toEqual([]);
    expect(storage.get(QUEUE_KEY)).toBe(before);
    expect(ctx.current.pending.map((p) => p.localId)).toEqual(['A', 'B']);
  });

  it('F2: a sighting queued while the move is writing photos survives', async () => {
    seedQueue([inlineItem('A')]);
    const moveWrite = deferred();
    fake.faults.beforePut = (id) => (id === 'A' ? moveWrite.promise : Promise.resolve());
    const ctx = renderProvider();
    await waitFor(() => expect(fake.calls.putPhoto).toContain('A'));
    expect(ctx.current.ready).toBe(false);

    let queued!: Promise<void>;
    act(() => {
      queued = ctx.current.enqueue(newSighting('C'));
    });
    await act(async () => {
      moveWrite.resolve();
      await queued;
    });

    const stored = byId(saved());
    expect(Object.keys(stored)).toEqual(['A', 'C']);
    expect(stored.A.photoUri).toBe('idb:A');
    expect(stored.C.photoUri).toBe('idb:C');
  });

  it('without strict durability, a photo is stripped only on the next load, after a second read-back', async () => {
    fake = createFakePhotoStore({ strictDurability: false });
    setPhotoStoreAdapterForTests(fake.adapter);
    seedQueue([inlineItem('A')]);

    const first = mount();
    await waitFor(() => expect(first.ctx.current.ready).toBe(true));
    expect(fake.text('A')).toBe('photo-A');
    expect(saved()[0].photoBase64).toBe(b64('photo-A'));
    first.unmount();

    const second = mount();
    await waitFor(() => expect(second.ctx.current.ready).toBe(true));
    expect(saved()[0].photoUri).toBe('idb:A');
    expect(saved()[0].photoBase64).toBeUndefined();
  });

  it('a browser that cannot keep photos durably keeps them inline (R3)', async () => {
    vi.stubGlobal('localStorage', memoryLocalStorage({ broken: true }));
    seedQueue([inlineItem('A')]);
    const ctx = await renderLoaded();
    expect(saved()[0].photoBase64).toBe(b64('photo-A'));

    await act(async () => {
      await ctx.current.enqueue(newSighting('C'));
    });
    expect(byId(saved()).C.photoBase64).toBe(b64('photo-C'));
    expect(fake.photos.size).toBe(0);
  });

  it('an unparseable saved list is copied to the backups store and left untouched', async () => {
    const garbled = '[{"localId":"A","photoBase64":"' + b64('photo-A');
    storage.set(QUEUE_KEY, garbled);
    const ctx = await renderLoaded();

    expect(ctx.current.readOnly).toBe(true);
    expect([...fake.backups.values()]).toMatchObject([{ raw: garbled, reason: 'unparseable' }]);
    expect(storage.get(QUEUE_KEY)).toBe(garbled);
  });

  it('backups older than 30 days are deleted', async () => {
    fake.backups.set('old', { raw: '[]', savedAt: Date.now() - 31 * DAY, reason: 'move' });
    fake.backups.set('recent', { raw: '[]', savedAt: Date.now() - 2 * DAY, reason: 'move' });
    await renderLoaded();
    expect([...fake.backups.keys()]).toEqual(['recent']);
  });

  it('the sweep deletes an unreferenced photo older than a day, but never a recent one', async () => {
    fake.seed('A', 'photo-A', Date.now() - 3 * DAY);
    fake.seed('orphan-old', 'x', Date.now() - 2 * DAY);
    fake.seed('orphan-recent', 'x', Date.now() - 60 * 60 * 1000);
    seedQueue([item('A')]);
    await renderLoaded();
    expect([...fake.photos.keys()].sort()).toEqual(['A', 'orphan-recent']);
  });

  it('the sweep keeps a review photo for seven days, then lets it go', async () => {
    fake.seed('review-41', 'photo', Date.now() - 6 * DAY);
    fake.seed('review-7', 'photo', Date.now() - 8 * DAY);
    await renderLoaded();
    expect([...fake.photos.keys()]).toEqual(['review-41']);
  });
});

describe('queueing on the web build', () => {
  it('keeps the photo in the store and only a reference in the list', async () => {
    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.enqueue(newSighting('C'));
    });
    expect(fake.text('C')).toBe('photo-C');
    expect(saved()[0].photoUri).toBe('idb:C');
    expect(storage.get(QUEUE_KEY)).not.toContain(b64('photo-C'));
  });

  it('a failed photo save is reported, not stuffed into the list', async () => {
    const ctx = await renderLoaded();
    fake.faults.failPut = (id) => id === 'C';
    const error = await ctx.current.enqueue(newSighting('C')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueWriteError);
    expect(saved()).toEqual([]);
    expect(ctx.current.pending).toEqual([]);
  });
});

describe('uploading stored web photos', () => {
  it('sends the stored bytes of an idb: photo', async () => {
    fake.seed('A', 'full-photo');
    seedQueue([item('A')]);
    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).toHaveBeenCalledWith(
      expect.objectContaining({ photoBase64: b64('full-photo') }),
    );
    expect(ctx.current.pending[0]).toMatchObject({ status: 'review', sightingId: 4 });
  });

  it('F9: on a constrained network, shrinks an idb: photo through a blob: URL and revokes it', async () => {
    fake.seed('A', 'full-photo');
    seedQueue([item('A')]);
    const ctx = await renderLoaded();

    await act(async () => {
      netInfoListeners.forEach((cb) => cb(cellular));
    });
    await waitFor(() => expect(ctx.current.pending[0]?.status).toBe('review'));

    expect(manipulateAsync).toHaveBeenCalledTimes(1);
    const [source] = manipulateAsync.mock.calls[0] as unknown as [string];
    expect(source).toMatch(/^blob:/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(source);
    expect(createSighting).toHaveBeenCalledWith(
      expect.objectContaining({ photoBase64: 'optimized-photo-data' }),
    );
  });

  it('shrinks an inline web photo from its own bytes, not its dead display URL', async () => {
    seedQueue([
      item('A', {
        photoUri: 'blob:http://localhost/revoked-last-session',
        photoBase64: b64('inline-photo'),
      }),
    ]);
    await renderLoaded();

    await act(async () => {
      netInfoListeners.forEach((cb) => cb(cellular));
    });
    await waitFor(() => expect(createSighting).toHaveBeenCalled());
    const [source] = manipulateAsync.mock.calls[0] as unknown as [string];
    expect(source).toMatch(/^blob:test\//);
  });
});

describe('a photo the browser cleared', () => {
  it('gets its own status, not "too old to send"', async () => {
    seedQueue([item('A')]);
    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).not.toHaveBeenCalled();
    expect(ctx.current.pending[0]).toMatchObject({ status: 'error', errorKind: 'cleared' });
    expect(saved()[0]).toMatchObject({ status: 'error', errorKind: 'cleared' });
  });

  it('a photo that merely could not be read this time stays queued', async () => {
    fake.seed('A', 'full-photo');
    fake.faults.failGet = () => true;
    seedQueue([item('A')]);
    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).not.toHaveBeenCalled();
    expect(ctx.current.pending[0].status).toBe('queued');
  });
});

describe("the pre-launch gate's 401 (SYC-121)", () => {
  const GATE_BODY = {
    error: 'prelaunch_pass_required',
    message: "Cat Spotters isn't open yet.",
  };

  it('leaves the item queued (no error flagged), sets needsSignIn, and pauses further sync', async () => {
    fake.seed('A', 'full-photo');
    // A non-zero failCount from earlier server failures must survive a gate
    // 401 untouched — the gate says nothing about the sighting itself, so it
    // must not be counted as another failed attempt.
    seedQueue([item('A', { failCount: 2 })]);
    createSighting.mockRejectedValue(new ApiError(401, 'no pass', GATE_BODY));

    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });

    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'queued' });
    expect(ctx.current.pending[0].errorKind).toBeUndefined();
    expect(ctx.current.pending[0].failCount).toBe(2);
    expect(ctx.current.needsSignIn).toBe(true);

    // A second automatic trigger (e.g. NetInfo reporting back online) must
    // not hammer the gate again while signed out.
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).toHaveBeenCalledTimes(1);
  });

  it('retries automatically and uploads once after retryAfterSignIn', async () => {
    fake.seed('A', 'full-photo');
    seedQueue([item('A')]);
    createSighting.mockRejectedValueOnce(new ApiError(401, 'no pass', GATE_BODY));

    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(ctx.current.needsSignIn).toBe(true);

    // Sign-in succeeded (e.g. the tester completed the website's sign-in
    // page); the next request carries a valid cookie and succeeds.
    createSighting.mockResolvedValueOnce({
      sightingId: 21,
      isCatPhoto: true,
      candidates: [],
    });
    await act(async () => {
      await ctx.current.retryAfterSignIn();
    });

    expect(createSighting).toHaveBeenCalledTimes(2);
    expect(ctx.current.needsSignIn).toBe(false);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'review', sightingId: 21 });
    expect(saved()[0]).toMatchObject({ status: 'review', sightingId: 21 });
  });

  it('retries automatically when the tab regains focus (returning from sign-in)', async () => {
    fake.seed('A', 'full-photo');
    seedQueue([item('A')]);
    createSighting.mockRejectedValueOnce(new ApiError(401, 'no pass', GATE_BODY));

    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(ctx.current.needsSignIn).toBe(true);

    createSighting.mockResolvedValueOnce({
      sightingId: 22,
      isCatPhoto: true,
      candidates: [],
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      // The focus handler's retry is async; let it settle.
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(ctx.current.pending[0]?.status).toBe('review'));

    expect(createSighting).toHaveBeenCalledTimes(2);
    expect(ctx.current.needsSignIn).toBe(false);
  });

  it('a device-secret 401 on the same route is not mistaken for the gate and stays permanent', async () => {
    fake.seed('A', 'full-photo');
    seedQueue([item('A')]);
    createSighting.mockRejectedValueOnce(
      new ApiError(401, 'device secret required', { error: 'Device secret required' }),
    );

    const ctx = await renderLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });

    expect(ctx.current.needsSignIn).toBe(false);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'error', errorKind: 'server' });
  });
});
