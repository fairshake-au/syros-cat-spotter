// @vitest-environment jsdom
/**
 * The adversarial review's reproduced failure sequences, as tests
 * (docs/specs/reviews/offline-queue-on-web-review.md, spec §6).
 *
 * Each of these lost a tester's sighting, or sent it twice, before the queue
 * had a single write path (spec §3.1). They run against the native build
 * because the lost updates were never web-only: every platform had them.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storage,
  saveFailures,
  getItem,
  setItem,
  netInfoListeners,
  createSighting,
  photoFiles,
  writeAsStringAsync,
  readDirectoryAsync,
} = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const photoFiles = new Map<string, string>();
  const saveFailures = { always: false };
  return {
    storage,
    saveFailures,
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      if (saveFailures.always) throw new Error('QuotaExceededError');
      storage.set(key, value);
    }),
    netInfoListeners: [] as Array<(state: { isConnected: boolean }) => void>,
    createSighting: vi.fn(),
    photoFiles,
    writeAsStringAsync: vi.fn(async (uri: string, contents: string) => {
      photoFiles.set(uri, contents);
    }),
    readDirectoryAsync: vi.fn(async (directory: string) =>
      [...photoFiles.keys()]
        .filter((uri) => uri.startsWith(`${directory}/`))
        .map((uri) => uri.slice(uri.lastIndexOf('/') + 1)),
    ),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((cb: (state: { isConnected: boolean }) => void) => {
      netInfoListeners.push(cb);
      return () => {};
    }),
  },
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    const contents = photoFiles.get(from);
    if (contents === undefined) throw new Error('source file missing');
    photoFiles.set(to, contents);
  }),
  writeAsStringAsync,
  readAsStringAsync: vi.fn(async (uri: string) => {
    const contents = photoFiles.get(uri);
    if (contents === undefined) throw new Error('file missing');
    return contents;
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    photoFiles.delete(uri);
  }),
  // Every file reports an age well past the sweep's 24-hour guard. The guard
  // is a second line of defence with its own tests; pinning it open here
  // means these tests exercise the load gate alone.
  getInfoAsync: vi.fn(async (uri: string) =>
    photoFiles.has(uri)
      ? { exists: true, modificationTime: 0 }
      : { exists: false },
  ),
  readDirectoryAsync,
}));

vi.mock('@workspace/api-client-react', () => ({
  createSighting: (...args: unknown[]) => createSighting(...args),
  ApiError: class ApiError extends Error {},
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

const QUEUE_KEY = 'cat-spotter/pending-sightings';
const PHOTOS = 'file:///documents/pending-photos';

type OfflineValue = ReturnType<typeof useOffline>;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A queued item whose photo is already a file. */
function fileItem(localId: string, overrides: Partial<PendingSighting> = {}): PendingSighting {
  const photoUri = `${PHOTOS}/${localId}.jpg`;
  photoFiles.set(photoUri, `photo-${localId}`);
  return {
    localId,
    photoUri,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
    status: 'queued',
    ...overrides,
  };
}

function newSighting(localId: string) {
  return {
    localId,
    photoBase64: `photo-${localId}`,
    photoUri: `file:///picker-cache/${localId}.jpg`,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
  };
}

function renderProvider() {
  const ref: { current: OfflineValue | null } = { current: null };
  function Probe() {
    ref.current = useOffline();
    return null;
  }
  render(
    <OfflineProvider>
      <Probe />
    </OfflineProvider>,
  );
  return ref as { current: OfflineValue };
}

async function renderLoaded() {
  const ctx = renderProvider();
  await waitFor(() => expect(ctx.current.ready).toBe(true));
  return ctx;
}

function seedQueue(items: PendingSighting[]) {
  storage.set(QUEUE_KEY, JSON.stringify(items));
}

function saved(): PendingSighting[] {
  const raw = storage.get(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as PendingSighting[]) : [];
}

const byId = (list: PendingSighting[]) =>
  Object.fromEntries(list.map((p) => [p.localId, p]));

const matched = (sightingId: number) => ({
  sightingId,
  isCatPhoto: true,
  candidates: [],
});

beforeEach(() => {
  saveFailures.always = false;
  storage.clear();
  photoFiles.clear();
  netInfoListeners.length = 0;
  vi.clearAllMocks();
});

describe('load gate (F2)', () => {
  it('F2: a sighting queued while the load is still moving photos survives', async () => {
    seedQueue([
      {
        ...fileItem('A'),
        photoBase64: 'photo-A',
        photoUri: 'file:///purged-cache/A.jpg',
      },
    ]);
    const moveWrite = deferred();
    writeAsStringAsync.mockImplementationOnce(async (uri: string, contents: string) => {
      await moveWrite.promise;
      photoFiles.set(uri, contents);
    });

    const ctx = renderProvider();
    await waitFor(() => expect(writeAsStringAsync).toHaveBeenCalledTimes(1));
    expect(ctx.current.ready).toBe(false);

    let queued!: Promise<unknown>;
    act(() => {
      queued = ctx.current.enqueue(newSighting('C'));
    });
    await act(async () => {
      moveWrite.resolve();
      await queued;
    });

    const stored = byId(saved());
    expect(Object.keys(stored).sort()).toEqual(['A', 'C']);
    expect(stored.A.photoBase64).toBeUndefined();
    expect(stored.A.photoUri).toBe(`${PHOTOS}/A.jpg`);
    expect(photoFiles.get(stored.C.photoUri)).toBe('photo-C');
    expect(ctx.current.pending.map((p) => p.localId).sort()).toEqual(['A', 'C']);
  });

  it('a sighting queued during the launch sweep keeps its photo', async () => {
    seedQueue([fileItem('A')]);
    const sweep = deferred();
    readDirectoryAsync.mockImplementationOnce(async (directory: string) => {
      await sweep.promise;
      return [...photoFiles.keys()]
        .filter((uri) => uri.startsWith(`${directory}/`))
        .map((uri) => uri.slice(uri.lastIndexOf('/') + 1));
    });

    const ctx = renderProvider();
    await waitFor(() => expect(readDirectoryAsync).toHaveBeenCalled());

    let queued!: Promise<unknown>;
    act(() => {
      queued = ctx.current.enqueue(newSighting('C'));
    });
    // Give an ungated writer every chance to save its photo mid-sweep.
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      sweep.resolve();
      await queued;
    });

    const c = byId(saved()).C;
    expect(c).toBeDefined();
    expect(photoFiles.get(c.photoUri)).toBe('photo-C');
  });

  it('a sync asked for while the queue is loading sends the loaded queue', async () => {
    seedQueue([fileItem('A')]);
    const loadRead = deferred();
    getItem.mockImplementationOnce(async (key: string) => {
      await loadRead.promise;
      return storage.get(key) ?? null;
    });
    createSighting.mockResolvedValue(matched(5));

    const ctx = renderProvider();
    await act(async () => {
      netInfoListeners.forEach((cb) => cb({ isConnected: true }));
    });
    expect(createSighting).not.toHaveBeenCalled();
    expect(ctx.current.ready).toBe(false);

    await act(async () => {
      loadRead.resolve();
    });
    await waitFor(() =>
      expect(ctx.current.pending[0]).toMatchObject({ status: 'review', sightingId: 5 }),
    );
    expect(createSighting).toHaveBeenCalledTimes(1);
  });
});

describe('changes made during a sync survive it (F3)', () => {
  it('F3: resolving a reviewed sighting, and queueing a new one, during a sync', async () => {
    seedQueue([fileItem('A'), fileItem('B')]);
    const uploadB = deferred<ReturnType<typeof matched>>();
    createSighting
      .mockResolvedValueOnce(matched(1))
      .mockImplementationOnce(() => uploadB.promise);
    const ctx = await renderLoaded();

    let sync!: Promise<void>;
    act(() => {
      sync = ctx.current.syncNow();
    });
    await waitFor(() => expect(createSighting).toHaveBeenCalledTimes(2));
    expect(byId(ctx.current.pending).A.status).toBe('review');

    // A is resolved on the review screen while B is still uploading…
    await act(async () => {
      await ctx.current.remove('A');
    });
    // …and a new sighting is queued.
    await act(async () => {
      await ctx.current.enqueue(newSighting('X'));
    });
    await act(async () => {
      uploadB.resolve(matched(2));
      await sync;
    });

    const stored = byId(saved());
    expect(Object.keys(stored).sort()).toEqual(['B', 'X']);
    expect(stored.B).toMatchObject({ status: 'review', sightingId: 2 });
    expect(stored.X.status).toBe('queued');
    expect(Object.keys(byId(ctx.current.pending)).sort()).toEqual(['B', 'X']);
  });

  it('F3: a sighting discarded during a sync is not sent and does not come back', async () => {
    seedQueue([fileItem('A'), fileItem('B')]);
    const uploadA = deferred<ReturnType<typeof matched>>();
    createSighting.mockImplementationOnce(() => uploadA.promise);
    const ctx = await renderLoaded();

    let sync!: Promise<void>;
    act(() => {
      sync = ctx.current.syncNow();
    });
    await waitFor(() => expect(createSighting).toHaveBeenCalledTimes(1));
    await act(async () => {
      await ctx.current.remove('B');
    });
    await act(async () => {
      uploadA.resolve(matched(1));
      await sync;
    });

    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(saved().map((p) => p.localId)).toEqual(['A']);
    expect(ctx.current.pending.map((p) => p.localId)).toEqual(['A']);
  });

  it('F3: a photo replaced during a sync stays replaced', async () => {
    seedQueue([
      fileItem('A'),
      fileItem('R', { status: 'rejected', rejectionKey: 'photoInvalid' }),
    ]);
    const uploadA = deferred<ReturnType<typeof matched>>();
    createSighting.mockImplementationOnce(() => uploadA.promise);
    const ctx = await renderLoaded();

    let sync!: Promise<void>;
    act(() => {
      sync = ctx.current.syncNow();
    });
    await waitFor(() => expect(createSighting).toHaveBeenCalledTimes(1));
    await act(async () => {
      await ctx.current.replacePhoto('R', {
        photoBase64: 'new-photo-R',
        photoUri: 'file:///picker-cache/R-new.jpg',
      });
    });
    await act(async () => {
      uploadA.resolve(matched(1));
      await sync;
    });

    const stored = byId(saved());
    expect(stored.A.status).toBe('review');
    expect(stored.R.status).toBe('queued');
    expect(stored.R.rejectionKey).toBeUndefined();
    expect(photoFiles.get(stored.R.photoUri)).toBe('new-photo-R');
  });
});

describe('a save that fails after an upload (F6)', () => {
  it('F6: does not send the sighting again in the same session, and is saved by the next change', async () => {
    seedQueue([fileItem('A')]);
    createSighting.mockResolvedValue(matched(8));
    const ctx = await renderLoaded();

    setItem.mockRejectedValueOnce(new Error('QuotaExceededError'));
    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'review', sightingId: 8 });
    expect(saved()[0].status).toBe('queued');

    await act(async () => {
      await ctx.current.syncNow();
    });
    expect(createSighting).toHaveBeenCalledTimes(1);

    await act(async () => {
      await ctx.current.enqueue(newSighting('X'));
    });
    const stored = byId(saved());
    expect(stored.A).toMatchObject({ status: 'review', sightingId: 8 });
    expect(stored.X.status).toBe('queued');
  });
});

describe('loading never empties the queue', () => {
  it('an unreadable saved list is left untouched, and queueing says so instead of overwriting it', async () => {
    storage.set(QUEUE_KEY, '[{"localId":"A","photoBase64":"abc"');
    const ctx = await renderLoaded();

    expect(ctx.current.readOnly).toBe(true);
    const error = await ctx.current
      .enqueue(newSighting('C'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueWriteError);
    expect((error as QueueWriteError).reason).toBe('read-only');
    expect(storage.get(QUEUE_KEY)).toBe('[{"localId":"A","photoBase64":"abc"');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('shows the parsed list even when saving the load’s changes fails', async () => {
    const old = fileItem('old', {
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    });
    seedQueue([old, fileItem('fresh')]);
    saveFailures.always = true;

    const ctx = await renderLoaded();
    const loaded = byId(ctx.current.pending);
    expect(Object.keys(loaded).sort()).toEqual(['fresh', 'old']);
    expect(loaded.old).toMatchObject({ status: 'error', errorKind: 'stale' });
  });
});

describe('user changes fail honestly', () => {
  it('enqueue throws QueueWriteError and leaves the queue as it was when the save fails', async () => {
    seedQueue([fileItem('A')]);
    const ctx = await renderLoaded();
    setItem.mockRejectedValueOnce(new Error('QuotaExceededError'));

    const error = await ctx.current
      .enqueue(newSighting('C'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueWriteError);
    expect((error as QueueWriteError).reason).toBe('failed');
    expect(ctx.current.pending.map((p) => p.localId)).toEqual(['A']);
    expect(saved().map((p) => p.localId)).toEqual(['A']);
  });

  it('remove throws QueueWriteError and keeps the item and its photo when the save fails', async () => {
    seedQueue([fileItem('A')]);
    const ctx = await renderLoaded();
    setItem.mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(ctx.current.remove('A')).rejects.toBeInstanceOf(QueueWriteError);
    expect(ctx.current.pending.map((p) => p.localId)).toEqual(['A']);
    expect(photoFiles.has(`${PHOTOS}/A.jpg`)).toBe(true);
  });
});
