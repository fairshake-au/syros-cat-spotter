// @vitest-environment jsdom
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SYC-664 final review I1: "A reload mid-move" (spec, Technical notes). The app
 * stored a pending move just before redeem. If it opens again within 60 s, it
 * asks again with the same values BEFORE any request goes out as the old id;
 * the server's replay answers, and the phone becomes the spotter that came back.
 */

const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    multiRemove: async (keys: string[]) => {
      for (const key of keys) storage.delete(key);
    },
  },
}));

const api = vi.hoisted(() => ({
  movedListener: null as null | (() => void),
  getProfile: vi.fn(async (_id: string) => ({ ownedCatIds: [3] })),
}));

vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter: vi.fn(),
  setDeviceMovedListener: (l: null | (() => void)) => {
    api.movedListener = l;
  },
  getProfile: api.getProfile,
}));

const redeem = vi.hoisted(() => vi.fn());
vi.mock('@/lib/keepSafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keepSafe')>();
  return { ...actual, redeemRestore: redeem };
});

import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { RESTORE_PENDING_MOVE_KEY, readPendingMove } from '@/lib/restoreWaiting';

const wrapper = ({ children }: { children: React.ReactNode }) => <DeviceProvider>{children}</DeviceProvider>;

const pending = (ageMs: number) =>
  window.localStorage.setItem(
    RESTORE_PENDING_MOVE_KEY,
    JSON.stringify({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true, at: Date.now() - ageMs }),
  );

beforeEach(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
  });
  storage.clear();
  storage.set('cat-spotter/device-id', 'dev-starter');
  storage.set('cat-spotter/device-secret', 'starter-secret-starter-secret');
  storage.set('cat-spotter/username', 'Nikos');
  storage.set('cat-spotter/owned-cat-ids', '[1]');
  vi.clearAllMocks();
  redeem.mockReset();
});

describe('a reload mid-move (I1)', () => {
  it('(a) a pending move under 60 s: the replay answers, the phone adopts the restored id and never shows "moved"', async () => {
    pending(5_000);
    redeem.mockImplementation(async () => {
      // As customFetch would, if anything answered device_moved meanwhile.
      api.movedListener?.();
      return { deviceId: 'dev-lili', username: 'Lili' };
    });
    const seen: (string | null)[] = [];
    const { result } = renderHook(
      () => {
        const d = useDevice();
        seen.push(d.deviceId);
        return d;
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(redeem).toHaveBeenCalledTimes(1);
    expect(redeem).toHaveBeenCalledWith(
      'dev-starter',
      { token: 'handle-9', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true },
      expect.anything(),
    );
    expect(result.current.deviceId).toBe('dev-lili');
    expect(result.current.username).toBe('Lili');
    expect(result.current.moved).toBe(false);
    expect(result.current.keepSafeOffer).toBe('done');
    // The old id never became visible, so nothing was sent as it.
    expect(seen).not.toContain('dev-starter');
    await waitFor(() => expect(api.getProfile).toHaveBeenCalled());
    expect(api.getProfile.mock.calls.every(([id]) => id === 'dev-lili')).toBe(true);
    expect(storage.get('cat-spotter/device-id')).toBe('dev-lili');
    expect(storage.get('cat-spotter/username')).toBe('Lili');
    // The starter's owned cats are gone; the list is the restored spotter's, from the server.
    await waitFor(() => expect(result.current.ownedCatIds).toEqual([3]));
    expect(readPendingMove()).toBeNull();
  });

  it('(b) a pending move older than 60 s: cleared, nothing sent, a normal start', async () => {
    pending(61_000);
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).not.toHaveBeenCalled();
    expect(result.current.deviceId).toBe('dev-starter');
    expect(result.current.username).toBe('Nikos');
    expect(window.localStorage.getItem(RESTORE_PENDING_MOVE_KEY)).toBeNull();
  });

  it('a refused replay: cleared, a normal start, and our own move never shows "moved"', async () => {
    pending(5_000);
    redeem.mockImplementation(async () => {
      api.movedListener?.();
      throw new Error('403 device_moved');
    });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(result.current.deviceId).toBe('dev-starter');
    expect(result.current.username).toBe('Nikos');
    expect(result.current.moved).toBe(false);
    expect(readPendingMove()).toBeNull();
  });

  it('a device_moved after the resume is still shown', async () => {
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).not.toHaveBeenCalled();
    api.movedListener?.();
    await waitFor(() => expect(result.current.moved).toBe(true));
  });
});
