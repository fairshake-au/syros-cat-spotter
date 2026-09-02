// @vitest-environment jsdom
/**
 * Photo-file lifecycle tests for the offline queue.
 *
 * Guards against queued sighting photos piling up as leftover storage:
 * - enqueue persists the photo as a file and strips base64 from the queue JSON
 * - remove deletes the persisted file
 * - the launch-time orphan sweep deletes unreferenced files
 * - legacy inline-base64 queue items are migrated to files on load
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- In-memory fakes -------------------------------------------------------

/** Fake document-directory file system keyed by full URI. */
const { files, DOC_DIR } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  DOC_DIR: 'file:///doc/',
}));
const PHOTOS_DIR = `${DOC_DIR}pending-photos`;

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: DOC_DIR,
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: vi.fn(async () => {}),
  copyAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = files.get(from);
    if (content === undefined) throw new Error('source missing');
    files.set(to, content);
  }),
  writeAsStringAsync: vi.fn(async (uri: string, content: string) => {
    files.set(uri, content);
  }),
  readAsStringAsync: vi.fn(async (uri: string) => {
    const content = files.get(uri);
    if (content === undefined) throw new Error('file missing');
    return content;
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    files.delete(uri);
  }),
  readDirectoryAsync: vi.fn(async (dir: string) =>
    [...files.keys()]
      .filter((u) => u.startsWith(`${dir}/`))
      .map((u) => u.slice(dir.length + 1)),
  ),
}));

/** Fake AsyncStorage. */
const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      storage.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      storage.delete(k);
    }),
  },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn(() => () => {}),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  createSighting: vi.fn(async () => ({
    sightingId: 42,
    isCatPhoto: true,
    candidates: [],
  })),
  ApiError: class ApiError extends Error {},
}));

vi.mock('../DeviceContext', () => ({
  useDevice: () => ({ deviceId: 'device-1' }),
}));

import { OfflineProvider, useOffline } from '../OfflineContext';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

function wrapper({ children }: { children: React.ReactNode }) {
  return <OfflineProvider>{children}</OfflineProvider>;
}

function baseItem(localId: string) {
  return {
    localId,
    photoUri: `file:///cache/${localId}.jpg`,
    lat: 37.4,
    lng: 24.9,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  files.clear();
  storage.clear();
});

describe('offline queue photo-file lifecycle', () => {
  it('enqueue persists the photo as a file and strips base64 from the queue JSON', async () => {
    const { result } = renderHook(() => useOffline(), { wrapper });

    // Picker cache file no longer exists → falls back to writing base64.
    await act(async () => {
      await result.current.enqueue({ ...baseItem('a1'), photoBase64: 'PHOTO_A' });
    });

    const expectedFile = `${PHOTOS_DIR}/a1.jpg`;
    expect(files.get(expectedFile)).toBe('PHOTO_A');

    const raw = storage.get(QUEUE_KEY)!;
    expect(raw).not.toContain('PHOTO_A');
    const [stored] = JSON.parse(raw);
    expect(stored.photoBase64).toBeUndefined();
    expect(stored.photoUri).toBe(expectedFile);
    expect(result.current.pending[0].photoUri).toBe(expectedFile);
  });

  it('enqueue prefers copying the picker cache file when it still exists', async () => {
    files.set('file:///cache/a2.jpg', 'CACHED_PHOTO');
    const { result } = renderHook(() => useOffline(), { wrapper });

    await act(async () => {
      await result.current.enqueue({ ...baseItem('a2'), photoBase64: 'PHOTO_B' });
    });

    expect(files.get(`${PHOTOS_DIR}/a2.jpg`)).toBe('CACHED_PHOTO');
    expect(storage.get(QUEUE_KEY)).not.toContain('PHOTO_B');
  });

  it('remove deletes the persisted photo file', async () => {
    const { result } = renderHook(() => useOffline(), { wrapper });

    await act(async () => {
      await result.current.enqueue({ ...baseItem('b1'), photoBase64: 'PHOTO_B1' });
    });
    const file = `${PHOTOS_DIR}/b1.jpg`;
    expect(files.has(file)).toBe(true);

    await act(async () => {
      await result.current.remove('b1');
    });

    await waitFor(() => expect(files.has(file)).toBe(false));
    expect(result.current.pending).toHaveLength(0);
  });

  it('replacePhoto overwrites the persisted photo and preserves sighting metadata', async () => {
    const oldFile = `${PHOTOS_DIR}/replace-1.jpg`;
    const createdAt = '2026-08-30T08:00:00.000Z';
    files.set(oldFile, 'OLD_PHOTO');
    storage.set(
      QUEUE_KEY,
      JSON.stringify([
        {
          ...baseItem('replace-1'),
          photoUri: oldFile,
          createdAt,
          status: 'rejected',
          rejectionKey: 'photoInvalid',
        },
      ]),
    );
    const { result } = renderHook(() => useOffline(), { wrapper });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    await act(async () => {
      await result.current.replacePhoto('replace-1', {
        photoBase64: 'NEW_PHOTO',
        photoUri: 'file:///cache/new.jpg',
      });
    });

    expect(files.get(oldFile)).toBe('NEW_PHOTO');
    expect(result.current.pending[0]).toMatchObject({
      photoUri: oldFile,
      createdAt,
      lat: 37.4,
      lng: 24.9,
      status: 'review',
      sightingId: 42,
    });
    expect(result.current.pending[0].rejectionKey).toBeUndefined();
  });

  it('launch-time sweep deletes orphan files but keeps referenced ones', async () => {
    const kept = `${PHOTOS_DIR}/keep.jpg`;
    const orphan1 = `${PHOTOS_DIR}/orphan-1.jpg`;
    const orphan2 = `${PHOTOS_DIR}/orphan-2.jpg`;
    files.set(kept, 'KEEP');
    files.set(orphan1, 'ORPHAN');
    files.set(orphan2, 'ORPHAN');
    storage.set(
      QUEUE_KEY,
      JSON.stringify([
        { ...baseItem('keep'), photoUri: kept, status: 'queued' },
      ]),
    );

    const { result } = renderHook(() => useOffline(), { wrapper });

    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    await waitFor(() => {
      expect(files.has(orphan1)).toBe(false);
      expect(files.has(orphan2)).toBe(false);
    });
    expect(files.get(kept)).toBe('KEEP');
  });

  it('migrates legacy inline-base64 items to files on load', async () => {
    storage.set(
      QUEUE_KEY,
      JSON.stringify([
        {
          ...baseItem('legacy'),
          photoBase64: 'LEGACY_PHOTO',
          status: 'queued',
        },
      ]),
    );

    const { result } = renderHook(() => useOffline(), { wrapper });

    const file = `${PHOTOS_DIR}/legacy.jpg`;
    await waitFor(() => expect(files.get(file)).toBe('LEGACY_PHOTO'));
    await waitFor(() => {
      const raw = storage.get(QUEUE_KEY)!;
      expect(raw).not.toContain('LEGACY_PHOTO');
      const [stored] = JSON.parse(raw);
      expect(stored.photoBase64).toBeUndefined();
      expect(stored.photoUri).toBe(file);
    });
    expect(result.current.pending[0].photoUri).toBe(file);
  });
});
