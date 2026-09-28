// @vitest-environment jsdom
/**
 * The offline queue on the web build, with the photo store replaced by an
 * in-memory fake of its adapter (spec §6: no new dependency).
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

vi.mock('@workspace/api-client-react', () => ({
  createSighting: (...args: unknown[]) => createSighting(...args),
  ApiError: class ApiError extends Error {},
}));

vi.mock('../DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'device-1' }),
}));

import { OfflineProvider, useOffline, type PendingSighting } from '../OfflineContext';
import { setPhotoStoreAdapterForTests } from '@/lib/pendingPhotos';
import {
  b64,
  createFakePhotoStore,
  type FakePhotoStore,
} from '@/lib/__tests__/fakePhotoStore';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

type OfflineValue = ReturnType<typeof useOffline>;

let fake: FakePhotoStore;
let objectUrls: string[];

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
  setPhotoStoreAdapterForTests(undefined);
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
