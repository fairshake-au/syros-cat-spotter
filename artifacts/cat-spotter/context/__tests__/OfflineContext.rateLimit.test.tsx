// @vitest-environment jsdom
/**
 * SYC-196: a 429 ("too many, try later") keeps spots queued and retries later.
 *
 * The pure flagging rules live in lib/offlineQueue and have their own unit
 * tests; these tests confirm the React wiring — syncNow, retry, and
 * load-time stale marking — actually applies and persists those rules.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    headers: Headers;
    constructor(
      status: number,
      message = `HTTP ${status}`,
      data: unknown = null,
    ) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
      this.headers = new Headers();
    }
  }
  return { ApiError };
});
vi.mock('@workspace/api-client-react', () => ({
  createSighting: (...args: unknown[]) => createSighting(...args),
  ApiError,
}));

const finishPendingMove = vi.hoisted(() => vi.fn(async (_opts?: unknown) => null));
vi.mock('../DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'device-1', finishPendingMove }),
}));

import { OfflineProvider, useOffline, type PendingSighting } from '../OfflineContext';

const QUEUE_KEY = 'cat-spotter/pending-sightings';
type OfflineValue = ReturnType<typeof useOffline>;

function makeItem(localId: string): PendingSighting {
  return {
    localId,
    photoBase64: 'abc',
    photoUri: 'file://photo.jpg',
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
    status: 'queued',
  };
}

function tooMany(retryAfter?: string) {
  const err = new ApiError(429);
  if (retryAfter) err.headers = new Headers({ 'retry-after': retryAfter });
  return err;
}

const sent = { sightingId: 1, isCatPhoto: true, candidates: [] };

async function setup(ids: string[]) {
  storage.set(QUEUE_KEY, JSON.stringify(ids.map(makeItem)));
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
  await waitFor(() => expect(ref.current?.pending).toHaveLength(ids.length));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  return ref as { current: OfflineValue };
}

async function sync(ctx: { current: OfflineValue }) {
  await act(async () => {
    await ctx.current.syncNow();
  });
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  storage.clear();
  photoFiles.clear();
  netInfoListeners.length = 0;
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a 429 from the server', () => {
  it('keeps the spot queued, then sends it on its own once the wait is over', async () => {
    const ctx = await setup(['a']);
    createSighting.mockRejectedValueOnce(tooMany()).mockResolvedValue(sent);

    await sync(ctx);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'queued' });
    expect(ctx.current.pending[0].failCount).toBeUndefined();
    expect(createSighting).toHaveBeenCalledTimes(1);

    await wait(59_000);
    expect(createSighting).toHaveBeenCalledTimes(1);
    await wait(2_000);
    expect(createSighting).toHaveBeenCalledTimes(2);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'review' });
  });

  it('waits as long as Retry-After says', async () => {
    const ctx = await setup(['a']);
    createSighting.mockRejectedValueOnce(tooMany('300')).mockResolvedValue(sent);

    await sync(ctx);
    await wait(299_000);
    expect(createSighting).toHaveBeenCalledTimes(1);
    await wait(2_000);
    expect(createSighting).toHaveBeenCalledTimes(2);
    expect(ctx.current.pending[0].status).toBe('review');
  });

  it('stops the pass and sends nothing more while waiting, even if sync is asked again', async () => {
    const ctx = await setup(['a', 'b', 'c']);
    createSighting.mockRejectedValueOnce(tooMany()).mockResolvedValue(sent);

    await sync(ctx);
    await sync(ctx);
    await sync(ctx);
    expect(createSighting).toHaveBeenCalledTimes(1);
    expect(ctx.current.pending.every((p) => p.status === 'queued')).toBe(true);
  });

  it('repeated 429s stay queued with no failed state, backing off further each time', async () => {
    const ctx = await setup(['a']);
    createSighting.mockRejectedValue(tooMany());

    await sync(ctx);
    await wait(60_000); // 2nd try, then waits 120s
    expect(createSighting).toHaveBeenCalledTimes(2);
    await wait(119_000);
    expect(createSighting).toHaveBeenCalledTimes(2);
    await wait(2_000); // 3rd try, then waits 240s
    expect(createSighting).toHaveBeenCalledTimes(3);
    // Past MAX_SYNC_ATTEMPTS, still just waiting; about 1 try per 15 min once capped (10 in 97 min).
    for (let i = 0; i < 6; i++) await wait(15 * 60_000);
    expect(createSighting.mock.calls.length).toBeLessThanOrEqual(11);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'queued' });
    expect(ctx.current.pending[0].errorKind).toBeUndefined();
    expect(ctx.current.pending[0].failCount).toBeUndefined();
  });

  it('a queue of 25 spots all end up sent when the server refuses the 21st once', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const ctx = await setup(ids);
    let calls = 0;
    createSighting.mockImplementation(async () => {
      calls += 1;
      if (calls === 21) throw tooMany('60');
      return sent;
    });

    await sync(ctx);
    expect(ctx.current.pending.filter((p) => p.status === 'review')).toHaveLength(20);
    await wait(61_000);
    expect(ctx.current.pending.filter((p) => p.status === 'review')).toHaveLength(25);
    expect(ctx.current.pending.some((p) => p.status === 'error')).toBe(false);
  });

  it('a permanent 4xx still fails the spot', async () => {
    const ctx = await setup(['a']);
    createSighting.mockRejectedValueOnce(new ApiError(422));
    await sync(ctx);
    expect(ctx.current.pending[0]).toMatchObject({ status: 'error' });
  });
});
