// @vitest-environment jsdom
/**
 * SYC-63: the queue's part in "Delete my data" (plan §6.2, §8.2), on a
 * phone: Platform.OS is 'ios' and there is no lock manager, so withLock runs
 * straight away and only the sync's own promise can be waited for.
 *
 * Harness copied from OfflineContext.test.tsx.
 *
 * The pure flagging rules live in lib/offlineQueue and have their own unit
 * tests; these tests confirm the React wiring — syncNow, retry, and
 * load-time stale marking — actually applies and persists those rules.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storage,
  getItem,
  setItem,
  netInfoListeners,
  createSighting,
  photoFiles,
  makeDirectoryAsync,
  copyAsync,
  writeAsStringAsync,
  readAsStringAsync,
  deleteAsync,
  readDirectoryAsync,
    manipulateAsync,
} =
  vi.hoisted(() => {
    const storage = new Map<string, string>();
    const photoFiles = new Map<string, string>();
    return {
      storage,
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      netInfoListeners: [] as Array<
        (state: {
          isConnected: boolean;
          type?: string;
          details?: {
            isConnectionExpensive?: boolean;
            cellularGeneration?: string;
            strength?: number;
          };
        }) => void
      >,
      createSighting: vi.fn(),
      photoFiles,
      makeDirectoryAsync: vi.fn(async () => {}),
      copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
        const contents = photoFiles.get(from);
        if (contents === undefined) throw new Error('source file missing');
        photoFiles.set(to, contents);
      }),
      writeAsStringAsync: vi.fn(
        async (uri: string, contents: string) => {
          photoFiles.set(uri, contents);
        },
      ),
      readAsStringAsync: vi.fn(async (uri: string) => {
        const contents = photoFiles.get(uri);
        if (contents === undefined) throw new Error('file missing');
        return contents;
      }),
      deleteAsync: vi.fn(async (uri: string) => {
        photoFiles.delete(uri);
      }),
      readDirectoryAsync: vi.fn(async (directory: string) =>
        [...photoFiles.keys()]
          .filter((uri) => uri.startsWith(`${directory}/`))
          .map((uri) => uri.slice(uri.lastIndexOf('/') + 1)),
      ),
      manipulateAsync: vi.fn(async () => ({
        uri: 'file://optimized.jpg',
        base64: 'optimized-photo-data',
      })),
    };
  });

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem,
    setItem,
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
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
  manipulateAsync,
  SaveFormat: { JPEG: 'jpeg' },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync,
  copyAsync,
  writeAsStringAsync,
  readAsStringAsync,
  deleteAsync,
  readDirectoryAsync,
}));

const { ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(
      status: number,
      message = `HTTP ${status}`,
      data: unknown = null,
    ) {
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
  useOffline,
  type PendingSighting,
} from '../OfflineContext';
import { MAX_QUEUE_AGE_MS } from '../../lib/offlineQueue';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

type OfflineValue = ReturnType<typeof useOffline>;

function makeItem(overrides: Partial<PendingSighting> = {}): PendingSighting {
  return {
    localId: 'local-1',
    photoBase64: 'abc',
    photoUri: 'file://photo.jpg',
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
    status: 'queued',
    ...overrides,
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

function seedQueue(items: PendingSighting[]) {
  storage.set(QUEUE_KEY, JSON.stringify(items));
}

function persistedQueue(): PendingSighting[] {
  const raw = storage.get(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as PendingSighting[]) : [];
}

beforeEach(() => {
  storage.clear();
  photoFiles.clear();
  netInfoListeners.length = 0;
  vi.clearAllMocks();
});


const PHOTOS = 'file:///documents/pending-photos';

function goOnline() {
  for (const listener of netInfoListeners) listener({ isConnected: true });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('pauseSync', () => {
  it('waits for the upload in flight, with no lock manager', async () => {
    seedQueue([makeItem({ localId: 'a' })]);
    const upload = deferred<unknown>();
    createSighting.mockReturnValueOnce(upload.promise);
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.ready).toBe(true));
    act(() => goOnline());
    await waitFor(() => expect(createSighting).toHaveBeenCalledTimes(1));

    let paused = false;
    const pausing = ctx.current.pauseSync().then(() => {
      paused = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(paused).toBe(false);

    await act(async () => {
      upload.resolve({ id: 99, isCatPhoto: true, candidates: [] });
      await pausing;
    });
    expect(paused).toBe(true);
  });

  it('stops later items and reconnects from syncing until resumed', async () => {
    seedQueue([makeItem({ localId: 'a' }), makeItem({ localId: 'b' })]);
    const upload = deferred<unknown>();
    createSighting.mockReturnValueOnce(upload.promise);
    createSighting.mockResolvedValue({ id: 100, isCatPhoto: true, candidates: [] });
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.ready).toBe(true));
    act(() => goOnline());
    await waitFor(() => expect(createSighting).toHaveBeenCalledTimes(1));
    const pausing = ctx.current.pauseSync();
    await act(async () => {
      upload.resolve({ id: 99, isCatPhoto: true, candidates: [] });
      await pausing;
    });
    // The second item was not sent, and a reconnect doesn't send it either.
    act(() => goOnline());
    await new Promise((r) => setTimeout(r, 20));
    expect(createSighting).toHaveBeenCalledTimes(1);

    await act(async () => {
      ctx.current.resumeSync();
    });
    await waitFor(() => expect(createSighting).toHaveBeenCalledTimes(2));
  });
});

describe('wipeQueue', () => {
  it('forgets every spot and sighting photo, and leaves report photos alone', async () => {
    photoFiles.set(`${PHOTOS}/a.jpg`, 'x');
    photoFiles.set(`${PHOTOS}/a-r1.jpg`, 'x');
    photoFiles.set(`${PHOTOS}/review-12.jpg`, 'x');
    photoFiles.set(`${PHOTOS}/report-local-9.jpg`, 'x');
    seedQueue([
      makeItem({ localId: 'a', photoBase64: undefined, photoUri: `${PHOTOS}/a.jpg`, status: 'error' }),
    ]);
    storage.set('cat-spotter/pending-reports', '[]');
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.ready).toBe(true));

    await act(async () => {
      await ctx.current.wipeQueue();
    });
    expect(storage.has(QUEUE_KEY)).toBe(false);
    expect(ctx.current.pending).toEqual([]);
    expect([...photoFiles.keys()]).toEqual([`${PHOTOS}/report-local-9.jpg`]);
    expect(storage.get('cat-spotter/pending-reports')).toBe('[]');
  });

  it('wipes an unreadable (read-only) queue too', async () => {
    storage.set(QUEUE_KEY, '{not json');
    photoFiles.set(`${PHOTOS}/old.jpg`, 'x');
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.ready).toBe(true));
    expect(ctx.current.readOnly).toBe(true);

    await act(async () => {
      await ctx.current.wipeQueue();
    });
    expect(storage.has(QUEUE_KEY)).toBe(false);
    expect(photoFiles.size).toBe(0);
    expect(ctx.current.readOnly).toBe(false);
  });

  it('lets no spot saved during a deletion survive the wipe', async () => {
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.ready).toBe(true));
    await act(async () => {
      await ctx.current.pauseSync();
      const adding = ctx.current.enqueue({
        localId: 'late',
        photoBase64: 'abc',
        photoUri: 'file://late.jpg',
        lat: 37.4,
        lng: 24.9,
        createdAt: new Date().toISOString(),
      });
      const wiping = ctx.current.wipeQueue();
      const [added] = await Promise.allSettled([adding, wiping]);
      expect(added.status).toBe('rejected');
    });
    expect(storage.has(QUEUE_KEY)).toBe(false);
    expect(ctx.current.pending).toEqual([]);
  });
});

describe('unsentCount', () => {
  it('counts spots the server has never seen, not ones waiting for review', async () => {
    seedQueue([
      makeItem({ localId: 'q', status: 'queued' }),
      makeItem({ localId: 'e', status: 'error' }),
      makeItem({ localId: 'r', status: 'review', sightingId: 5 }),
    ]);
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.ready).toBe(true));
    expect(ctx.current.unsentCount).toBe(2);
  });
});
