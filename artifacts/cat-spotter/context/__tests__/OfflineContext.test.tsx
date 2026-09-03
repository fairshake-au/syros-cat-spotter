// @vitest-environment jsdom
/**
 * Integration-style tests for the OfflineProvider sync loop.
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

describe('native photo persistence', () => {
  it('writes an enqueued photo to document storage and strips inline base64', async () => {
    const ctx = renderProvider();

    await act(async () => {
      await ctx.current.enqueue({
        localId: 'native-1',
        photoBase64: 'native-photo-data',
        photoUri: 'file://picker-cache/native-1.jpg',
        lat: 37.4,
        lng: 24.9,
        createdAt: new Date().toISOString(),
      });
    });

    const expectedUri = 'file:///documents/pending-photos/native-1.jpg';
    expect(photoFiles.get(expectedUri)).toBe('native-photo-data');
    expect(writeAsStringAsync).toHaveBeenCalledWith(
      expectedUri,
      'native-photo-data',
      { encoding: 'base64' },
    );
    expect(ctx.current.pending[0]).toMatchObject({
      localId: 'native-1',
      photoUri: expectedUri,
      status: 'queued',
    });
    expect(ctx.current.pending[0].photoBase64).toBeUndefined();
    expect(persistedQueue()[0].photoBase64).toBeUndefined();
  });

  it('migrates a legacy inline photo into document storage on load', async () => {
    seedQueue([
      makeItem({
        localId: 'legacy-1',
        photoBase64: 'legacy-photo-data',
        photoUri: 'file://purged-cache/legacy-1.jpg',
      }),
    ]);

    const ctx = renderProvider();
    const expectedUri = 'file:///documents/pending-photos/legacy-1.jpg';

    await waitFor(() =>
      expect(ctx.current.pending[0]).toMatchObject({
        localId: 'legacy-1',
        photoUri: expectedUri,
      }),
    );
    expect(ctx.current.pending[0].photoBase64).toBeUndefined();
    expect(photoFiles.get(expectedUri)).toBe('legacy-photo-data');
    await waitFor(() => {
      expect(persistedQueue()[0].photoBase64).toBeUndefined();
      expect(persistedQueue()[0].photoUri).toBe(expectedUri);
    });
  });
});

describe('load-time stale marking', () => {
  it('flags over-age queued items on load and persists the change', async () => {
    const old = makeItem({
      localId: 'old-1',
      createdAt: new Date(Date.now() - MAX_QUEUE_AGE_MS - 60_000).toISOString(),
    });
    const fresh = makeItem({ localId: 'fresh-1' });
    seedQueue([old, fresh]);

    const ctx = renderProvider();

    await waitFor(() => expect(ctx.current.pending).toHaveLength(2));
    expect(ctx.current.pending.find((p) => p.localId === 'old-1')).toMatchObject(
      { status: 'error', errorKind: 'stale' },
    );
    expect(
      ctx.current.pending.find((p) => p.localId === 'fresh-1')?.status,
    ).toBe('queued');

    // The stale flag must be written back to storage, not just kept in state.
    await waitFor(() => {
      expect(
        persistedQueue().find((p) => p.localId === 'old-1'),
      ).toMatchObject({ status: 'error', errorKind: 'stale' });
    });
  });

  it('does not rewrite storage when nothing changed on load', async () => {
    seedQueue([
      makeItem({
        photoBase64: undefined,
        photoUri: 'file:///documents/pending-photos/local-1.jpg',
      }),
    ]);
    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('syncNow', () => {
  it('reads a queued native photo file and sends its base64 contents', async () => {
    const photoUri = 'file:///documents/pending-photos/native-sync.jpg';
    photoFiles.set(photoUri, 'photo-from-file');
    seedQueue([
      makeItem({
        localId: 'native-sync',
        photoBase64: undefined,
        photoUri,
      }),
    ]);
    createSighting.mockResolvedValueOnce({
      sightingId: 12,
      isCatPhoto: true,
      candidates: [],
    });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    await act(async () => {
      await ctx.current.syncNow();
    });

    expect(readAsStringAsync).toHaveBeenCalledWith(photoUri, {
      encoding: 'base64',
    });
    expect(createSighting).toHaveBeenCalledWith(
      expect.objectContaining({ photoBase64: 'photo-from-file' }),
    );
    expect(ctx.current.pending[0]).toMatchObject({
      status: 'review',
      sightingId: 12,
    });
  });

  it('continues past a permanent failure and syncs the rest of the queue', async () => {
    seedQueue([
      makeItem({ localId: 'bad-1' }),
      makeItem({ localId: 'good-1' }),
    ]);
    createSighting
      .mockRejectedValueOnce(new ApiError(422, 'not a cat'))
      .mockResolvedValueOnce({
        sightingId: 7,
        isCatPhoto: true,
        candidates: [],
      });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(2));

    await act(async () => {
      await ctx.current.syncNow();
    });

    expect(createSighting).toHaveBeenCalledTimes(2);
    const byId = Object.fromEntries(
      ctx.current.pending.map((p) => [p.localId, p]),
    );
    expect(byId['bad-1']).toMatchObject({
      status: 'error',
      errorKind: 'server',
      failCount: 1,
    });
    expect(byId['good-1']).toMatchObject({ status: 'review', sightingId: 7 });
    // Both outcomes are persisted.
    const stored = Object.fromEntries(
      persistedQueue().map((p) => [p.localId, p]),
    );
    expect(stored['bad-1']).toMatchObject({ status: 'error' });
    expect(stored['good-1']).toMatchObject({ status: 'review' });
    // A successful sync surfaces the review prompt.
    expect(ctx.current.reviewPromptVisible).toBe(true);
    expect(ctx.current.reviewReadyCount).toBe(1);
  });

  it('marks a 400 photo rejection as rejected with a translation key', async () => {
    seedQueue([makeItem({ localId: 'huge-1' })]);
    createSighting.mockRejectedValueOnce(
      new ApiError(400, 'photo too large', { error: 'photo too large' }),
    );

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    await act(async () => {
      await ctx.current.syncNow();
    });

    expect(ctx.current.pending[0]).toMatchObject({
      status: 'rejected',
      rejectionKey: 'photoTooLarge',
    });
    expect(persistedQueue()[0]).toMatchObject({ status: 'rejected' });
  });

  it('stops the loop on a network error and keeps items queued', async () => {
    const firstUri = 'file:///documents/pending-photos/net-1.jpg';
    const secondUri = 'file:///documents/pending-photos/net-2.jpg';
    photoFiles.set(firstUri, 'net-photo-1');
    photoFiles.set(secondUri, 'net-photo-2');
    seedQueue([
      makeItem({
        localId: 'net-1',
        photoBase64: undefined,
        photoUri: firstUri,
      }),
      makeItem({
        localId: 'net-2',
        photoBase64: undefined,
        photoUri: secondUri,
      }),
    ]);
    createSighting.mockRejectedValue(new TypeError('Network request failed'));

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(2));
    await act(async () => {
      await ctx.current.syncNow();
    });

    // The loop breaks after the first network failure — no second attempt.
    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(ctx.current.pending.every((p) => p.status === 'queued')).toBe(true);
    // Nothing was persisted (items are unchanged) and no prompt appears.
    expect(setItem).not.toHaveBeenCalled();
    expect(ctx.current.reviewPromptVisible).toBe(false);
    expect(ctx.current.syncing).toBe(false);
  });

  it('bumps failCount but keeps the item queued on a transient 500', async () => {
    seedQueue([makeItem({ localId: 'flaky-1' })]);
    createSighting.mockRejectedValueOnce(new ApiError(500, 'boom'));

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    await act(async () => {
      await ctx.current.syncNow();
    });

    expect(ctx.current.pending[0]).toMatchObject({
      status: 'queued',
      failCount: 1,
    });
    expect(persistedQueue()[0]).toMatchObject({ status: 'queued', failCount: 1 });
  });

  it('flags an item whose photo is gone as stale and moves on', async () => {
    // No inline base64 and readPendingPhotoBase64 is mocked to return null.
    seedQueue([
      makeItem({ localId: 'lost-1', photoBase64: undefined }),
      makeItem({ localId: 'ok-1' }),
    ]);
    createSighting.mockResolvedValueOnce({
      sightingId: 9,
      isCatPhoto: true,
      candidates: [],
    });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(2));
    await act(async () => {
      await ctx.current.syncNow();
    });

    const byId = Object.fromEntries(
      ctx.current.pending.map((p) => [p.localId, p]),
    );
    expect(byId['lost-1']).toMatchObject({ status: 'error', errorKind: 'stale' });
    expect(byId['ok-1']).toMatchObject({ status: 'review', sightingId: 9 });
  });

  it('syncs when the NetInfo listener reports the device back online', async () => {
    seedQueue([makeItem({ localId: 'auto-1' })]);
    createSighting.mockResolvedValueOnce({
      sightingId: 3,
      isCatPhoto: true,
      candidates: [],
    });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));

    await act(async () => {
      netInfoListeners.forEach((cb) => cb({ isConnected: true }));
    });

    await waitFor(() =>
      expect(ctx.current.pending[0]).toMatchObject({
        status: 'review',
        sightingId: 3,
      }),
    );
  });

  it('uses a smaller temporary photo when syncing over cellular data', async () => {
    const photoUri = 'file:///documents/pending-photos/cellular.jpg';
    photoFiles.set(photoUri, 'full-size-photo');
    seedQueue([
      makeItem({
        localId: 'cellular-1',
        photoBase64: undefined,
        photoUri,
      }),
    ]);
    createSighting.mockResolvedValueOnce({
      sightingId: 4,
      isCatPhoto: true,
      candidates: [],
    });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));

    await act(async () => {
      netInfoListeners.forEach((cb) =>
        cb({
          isConnected: true,
          type: 'cellular',
          details: { cellularGeneration: '4g' },
        }),
      );
    });

    await waitFor(() =>
      expect(ctx.current.pending[0]).toMatchObject({
        status: 'review',
        sightingId: 4,
      }),
    );
    expect(manipulateAsync).toHaveBeenCalledWith(
      photoUri,
      [{ resize: { width: 1280 } }],
      expect.objectContaining({
        compress: 0.72,
        base64: true,
      }),
    );
    expect(createSighting).toHaveBeenCalledWith(
      expect.objectContaining({ photoBase64: 'optimized-photo-data' }),
    );
  });
});

describe('retry', () => {
  it('requeues a failed item, resets its fail count, and syncs again', async () => {
    seedQueue([
      makeItem({
        localId: 'fail-1',
        status: 'error',
        errorKind: 'server',
        failCount: 3,
      }),
    ]);
    createSighting.mockResolvedValueOnce({
      sightingId: 11,
      isCatPhoto: false,
      candidates: [],
    });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    await act(async () => {
      await ctx.current.retry('fail-1');
    });

    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(ctx.current.pending[0]).toMatchObject({
      status: 'review',
      sightingId: 11,
      failCount: 0,
    });
  });

  it('a retried item that fails again over the network stays queued', async () => {
    seedQueue([
      makeItem({
        localId: 'fail-2',
        status: 'error',
        errorKind: 'server',
        failCount: 3,
      }),
    ]);
    createSighting.mockRejectedValueOnce(new TypeError('offline again'));

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    await act(async () => {
      await ctx.current.retry('fail-2');
    });

    expect(ctx.current.pending[0]).toMatchObject({
      status: 'queued',
      errorKind: undefined,
      failCount: 0,
    });
    // The requeue itself was persisted so the retry survives an app restart.
    expect(persistedQueue()[0]).toMatchObject({ status: 'queued' });
  });
});

describe('replacePhoto', () => {
  it('requeues and syncs a rejected item with a new photo and original metadata', async () => {
    const createdAt = '2026-08-31T10:15:00.000Z';
    seedQueue([
      makeItem({
        status: 'rejected',
        rejectionKey: 'photoInvalid',
        createdAt,
        lat: 37.441,
        lng: 24.942,
      }),
    ]);
    createSighting.mockResolvedValueOnce({
      sightingId: 22,
      isCatPhoto: true,
      candidates: [],
    });

    const ctx = renderProvider();
    await waitFor(() => expect(ctx.current.pending).toHaveLength(1));
    await act(async () => {
      await ctx.current.replacePhoto('local-1', {
        photoBase64: 'replacement-photo',
        photoUri: 'file://replacement.jpg',
      });
    });

    expect(createSighting).toHaveBeenCalledWith({
      deviceId: 'device-1',
      photoBase64: 'replacement-photo',
      lat: 37.441,
      lng: 24.942,
      capturedAt: createdAt,
    });
    expect(ctx.current.pending[0]).toMatchObject({
      status: 'review',
      sightingId: 22,
      photoUri: 'file:///documents/pending-photos/local-1.jpg',
      createdAt,
      lat: 37.441,
      lng: 24.942,
    });
    expect(ctx.current.pending[0].rejectionKey).toBeUndefined();
  });
});
