// @vitest-environment jsdom
/**
 * SYC-415 (spec §6.4, plan Task 4.4): the offline queue keeps, sends and
 * cleans up EVERY photo of a spot, and lets the spotter fix the one photo the
 * server refused. Each test here guards a silent loss, and each has a
 * mutation probe recorded in the commit.
 *
 * Web build, with the photo store replaced by the in-memory fake (the same
 * setup as OfflineContext.web.test.tsx).
 */
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, getItem, setItem, netInfoListeners, createSighting } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    netInfoListeners: [] as Array<(state: { isConnected: boolean; type?: string }) => void>,
    createSighting: vi.fn(),
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
  manipulateAsync: async () => ({ uri: 'blob:optimized', base64: 'optimized' }),
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

import { OfflineProvider, useOffline, type PendingSighting } from '../OfflineContext';
import { extrasOf } from '@/lib/offlineQueue';
import { setPhotoStoreAdapterForTests } from '@/lib/pendingPhotos';
import {
  b64,
  createFakePhotoStore,
  memoryLocalStorage,
  type FakePhotoStore,
} from '@/lib/__tests__/fakePhotoStore';

const QUEUE_KEY = 'cat-spotter/pending-sightings';
const HOUR = 60 * 60 * 1000;

type OfflineValue = ReturnType<typeof useOffline>;

let fake: FakePhotoStore;

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

async function mountLoaded() {
  const m = mount();
  await waitFor(() => expect(m.ctx.current.ready).toBe(true));
  return m;
}

function saved(): PendingSighting[] {
  const raw = storage.get(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as PendingSighting[]) : [];
}

function seedQueue(items: PendingSighting[]) {
  storage.set(QUEUE_KEY, JSON.stringify(items));
}

/** A spot as the Spot screen queues it: the first photo plus a face and a body. */
function threePhotoSpot(localId: string) {
  return {
    localId,
    photoBase64: b64(`first-${localId}`),
    photoUri: `blob:http://localhost/${localId}`,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
    extraPhotos: [
      { role: 'face' as const, photoUri: `blob:http://localhost/${localId}-face`, photoBase64: b64(`face-${localId}`) },
      { role: 'body' as const, photoUri: `blob:http://localhost/${localId}-body`, photoBase64: b64(`body-${localId}`) },
    ],
  };
}

/** A queued three-photo spot already in the store, as left by an earlier session. */
function storedSpot(localId: string, overrides: Partial<PendingSighting> = {}): PendingSighting {
  fake.seed(localId, `first-${localId}`);
  fake.seed(`${localId}-face`, `face-${localId}`);
  fake.seed(`${localId}-body`, `body-${localId}`);
  return {
    localId,
    photoUri: `idb:${localId}`,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
    status: 'queued',
    extraPhotos: [
      { role: 'face', photoUri: `idb:${localId}-face` },
      { role: 'body', photoUri: `idb:${localId}-body` },
    ],
    ...overrides,
  };
}

function lastSent() {
  const calls = createSighting.mock.calls;
  return calls[calls.length - 1][0] as {
    photoBase64: string;
    extraPhotos?: { role: string; photoBase64: string }[];
  };
}

beforeEach(() => {
  storage.clear();
  netInfoListeners.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', memoryLocalStorage());
  fake = createFakePhotoStore();
  setPhotoStoreAdapterForTests(fake.adapter);
  createSighting.mockResolvedValue({ sightingId: 4, isCatPhoto: true, candidates: [] });
});

afterEach(() => {
  cleanup();
  setPhotoStoreAdapterForTests(undefined);
  vi.unstubAllGlobals();
});

describe('queueing a three-photo spot', () => {
  it('stores every photo outside the list, with refs and no base64 in it', async () => {
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.enqueue(threePhotoSpot('S'));
    });
    const [item] = saved();
    expect(item.photoUri).toBe('idb:S');
    expect(item.extraPhotos).toEqual([
      { role: 'face', photoUri: 'idb:S-face' },
      { role: 'body', photoUri: 'idb:S-body' },
    ]);
    expect(fake.text('S-face')).toBe('face-S');
    expect(fake.text('S-body')).toBe('body-S');
    expect(storage.get(QUEUE_KEY)).not.toContain(b64('face-S'));
    expect(item.extraNote).toBeUndefined();
  });

  it('9a: an extra that cannot be stored is dropped, never kept inline, and the spot says so', async () => {
    const { ctx } = await mountLoaded();
    fake.faults.failPut = (id) => id === 'S-face';
    let result: Awaited<ReturnType<OfflineValue['enqueue']>> | undefined;
    await act(async () => {
      result = await ctx.current.enqueue(threePhotoSpot('S'));
    });
    const [item] = saved();
    expect(item.photoUri).toBe('idb:S');
    expect(extrasOf(item)).toEqual([{ role: 'body', photoUri: 'idb:S-body' }]);
    expect(item.extraNote).toBe('extraNotKept');
    expect(result).toEqual({ extraNotKept: true });
    expect(storage.get(QUEUE_KEY)).not.toContain(b64('face-S'));
  });

  it('9b: where no photo can be stored outside the list, only the first photo goes inline', async () => {
    // A browser whose list storage is broken can't keep photos durably (R3);
    // the list itself here is AsyncStorage, which still works.
    vi.stubGlobal('localStorage', memoryLocalStorage({ broken: true }));
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.enqueue(threePhotoSpot('S'));
    });
    const [item] = saved();
    expect(item.photoBase64).toBe(b64('first-S'));
    expect(extrasOf(item)).toEqual([]);
    expect(item.extraNote).toBe('extraNotKept');
    const raw = storage.get(QUEUE_KEY) ?? '';
    expect(raw).not.toContain(b64('face-S'));
    expect(raw).not.toContain(b64('body-S'));
  });
});

describe('the tidy-up of leftover photo files', () => {
  it('1: keeps every photo of a waiting spot, not just the first', async () => {
    const first = await mountLoaded();
    await act(async () => {
      await first.ctx.current.enqueue(threePhotoSpot('S'));
    });
    first.unmount();
    // A day and an hour pass: every file is now old enough to be swept if
    // nothing refers to it.
    for (const [id, photo] of fake.photos) fake.photos.set(id, { ...photo, savedAt: photo.savedAt - 25 * HOUR });
    fake.seed('stray', 'x', Date.now() - 25 * HOUR);

    await mountLoaded();
    expect([...fake.photos.keys()].sort()).toEqual(['S', 'S-body', 'S-face']);
  });
});

describe('sending a queued spot', () => {
  it('2: sends the first photo and both extras, read from the store', async () => {
    seedQueue([storedSpot('S')]);
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(lastSent().photoBase64).toBe(b64('first-S'));
    expect(lastSent().extraPhotos).toEqual([
      { role: 'face', photoBase64: b64('face-S') },
      { role: 'body', photoBase64: b64('body-S') },
    ]);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'review', sightingId: 4 });
    expect(ctx.current.pending[0].extraNote).toBeUndefined();
  });

  it('a spot queued with one photo sends exactly as before (no extraPhotos key)', async () => {
    fake.seed('A', 'first-A');
    seedQueue([{ localId: 'A', photoUri: 'idb:A', lat: 1, lng: 2, createdAt: new Date().toISOString(), status: 'queued' }]);
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect('extraPhotos' in lastSent()).toBe(false);
  });

  it('3: a missing extra does not block the spot; it sends the others and says so', async () => {
    seedQueue([storedSpot('S')]);
    fake.photos.delete('S-face');
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(lastSent().extraPhotos).toEqual([{ role: 'body', photoBase64: b64('body-S') }]);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'review', extraNote: 'extraMissing' });
    expect(saved()[0]).toMatchObject({ status: 'review', extraNote: 'extraMissing' });
  });

  it('4: a missing first photo behaves as it does for any spot', async () => {
    seedQueue([storedSpot('S')]);
    fake.photos.delete('S');
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).not.toHaveBeenCalled();
    expect(ctx.current.pending[0]).toMatchObject({ status: 'error', errorKind: 'cleared' });
  });

  it('a malformed stored extras list is ignored, and the spot still sends', async () => {
    fake.seed('S', 'first-S');
    seedQueue([
      { localId: 'S', photoUri: 'idb:S', lat: 1, lng: 2, createdAt: new Date().toISOString(), status: 'queued', extraPhotos: 'garbage' },
    ]);
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).toHaveBeenCalledTimes(1);
    expect('extraPhotos' in lastSent()).toBe(false);
    expect(ctx.current.pending[0].status).toBe('review');
  });
});

describe('fixing the photo the server refused', () => {
  it('5: a refused extra is named, and removing it requeues and sends the spot', async () => {
    seedQueue([storedSpot('S')]);
    createSighting.mockRejectedValueOnce(
      new ApiError(400, 'bad', { error: 'Image could not be decoded: file appears corrupt', photo: 'face' }),
    );
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(ctx.current.pending[0]).toMatchObject({
      status: 'rejected',
      rejectionKey: 'photoInvalid',
      rejectedRole: 'face',
    });

    await act(async () => {
      await ctx.current.removeExtraPhoto('S', 'face');
    });
    expect(createSighting).toHaveBeenCalledTimes(2);
    expect(lastSent().extraPhotos).toEqual([{ role: 'body', photoBase64: b64('body-S') }]);
    expect(ctx.current.pending[0].status).toBe('review');
    expect(ctx.current.pending[0].rejectionKey).toBeUndefined();
    expect(ctx.current.pending[0].rejectedRole).toBeUndefined();
    expect(fake.photos.has('S-face')).toBe(false);
  });

  it('a refused first photo is named first, when the server does not say which', async () => {
    seedQueue([storedSpot('S')]);
    createSighting.mockRejectedValueOnce(new ApiError(400, 'bad', { error: 'Unsupported image format' }));
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(ctx.current.pending[0]).toMatchObject({
      status: 'rejected',
      rejectionKey: 'photoUnsupported',
      rejectedRole: 'first',
    });
  });

  it('6: a too-large spot is fixable: it becomes rejected with spotTooLarge, and removing an extra requeues it', async () => {
    seedQueue([storedSpot('S')]);
    createSighting.mockRejectedValueOnce(new ApiError(413, 'Payload Too Large', { error: 'too large' }));
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(ctx.current.pending[0]).toMatchObject({ status: 'rejected', rejectionKey: 'spotTooLarge' });

    await act(async () => {
      await ctx.current.removeExtraPhoto('S', 'body');
    });
    expect(createSighting).toHaveBeenCalledTimes(2);
    expect(ctx.current.pending[0].status).toBe('review');
  });

  it('replacing a refused extra sends the new photo under a new key and deletes the old file', async () => {
    seedQueue([storedSpot('S', { status: 'rejected', rejectionKey: 'photoInvalid', rejectedRole: 'body' })]);
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.replaceExtraPhoto('S', 'body', {
        photoUri: 'blob:http://localhost/new-body',
        photoBase64: b64('new-body'),
      });
    });
    expect(lastSent().extraPhotos).toEqual([
      { role: 'face', photoBase64: b64('face-S') },
      { role: 'body', photoBase64: b64('new-body') },
    ]);
    expect(fake.photos.has('S-body')).toBe(false);
    expect(fake.text('S-body-r1')).toBe('new-body');
  });

  it('removing an extra the server did not refuse leaves the spot waiting for the real fix', async () => {
    seedQueue([storedSpot('S', { status: 'rejected', rejectionKey: 'photoInvalid', rejectedRole: 'first' })]);
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.removeExtraPhoto('S', 'face');
    });
    expect(createSighting).not.toHaveBeenCalled();
    expect(ctx.current.pending[0]).toMatchObject({ status: 'rejected', rejectedRole: 'first' });
    expect(extrasOf(ctx.current.pending[0])).toEqual([{ role: 'body', photoUri: 'idb:S-body' }]);
  });
});

describe('removing a spot', () => {
  it('7: deletes all three stored photos', async () => {
    seedQueue([storedSpot('S')]);
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.remove('S');
    });
    await waitFor(() => expect(fake.photos.size).toBe(0));
    expect(saved()).toEqual([]);
  });
});

describe('replacement keys', () => {
  it('8: replacing the first photo and then the face extra never collide', async () => {
    seedQueue([storedSpot('S', { status: 'rejected', rejectionKey: 'photoInvalid', rejectedRole: 'first' })]);
    // The replaced first photo goes through, then the server refuses the face.
    createSighting.mockRejectedValueOnce(new ApiError(400, 'bad', { error: 'corrupt', photo: 'face' }));
    const { ctx } = await mountLoaded();
    await act(async () => {
      await ctx.current.replacePhoto('S', { photoUri: 'blob:new-first', photoBase64: b64('new-first') });
    });
    expect(ctx.current.pending[0]).toMatchObject({ status: 'rejected', rejectedRole: 'face' });

    await act(async () => {
      await ctx.current.replaceExtraPhoto('S', 'face', { photoUri: 'blob:new-face', photoBase64: b64('new-face') });
    });
    const sent = lastSent();
    expect(sent.photoBase64).toBe(b64('new-first'));
    expect(sent.extraPhotos?.find((e) => e.role === 'face')?.photoBase64).toBe(b64('new-face'));
    const item = saved()[0];
    const faceRef = extrasOf(item).find((e) => e.role === 'face')?.photoUri;
    expect(item.photoUri).not.toBe(faceRef);
    expect(fake.text(item.photoUri.slice('idb:'.length))).toBe('new-first');
    expect(fake.text((faceRef ?? '').slice('idb:'.length))).toBe('new-face');
  });
});
