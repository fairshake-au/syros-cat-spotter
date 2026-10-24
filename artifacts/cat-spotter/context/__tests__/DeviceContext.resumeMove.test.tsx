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

const { storage, failWrite } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  failWrite: { key: null as string | null },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (key === failWrite.key) throw new Error('storage full');
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

vi.mock('@workspace/api-client-react', async (importOriginal) => ({
  ApiError: (await importOriginal<typeof import('@workspace/api-client-react')>()).ApiError,
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

import { ApiError } from '@workspace/api-client-react';
import { DeviceProvider, RESUME_RETRY, useDevice } from '@/context/DeviceContext';
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
  failWrite.key = null;
  RESUME_RETRY.delayMs = 5;
});

const apiError = (status: number, error: string) =>
  new ApiError(new Response(null, { status }), { error }, { method: 'POST', url: '/api/restore/redeem' });
const offline = () => new TypeError('Failed to fetch');

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

  it('N1 (a) a network error, then a 503, then success on retry: adopts', async () => {
    pending(5_000);
    redeem
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(apiError(503, 'Please try again in a moment.'))
      .mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(3);
    expect(result.current.deviceId).toBe('dev-lili');
    expect(result.current.moved).toBe(false);
    expect(readPendingMove()).toBeNull();
  });

  it('N1 (b) a 4xx is a definite refusal: cleared, no retry, a normal start, never "moved"', async () => {
    pending(5_000);
    redeem.mockImplementation(async () => {
      api.movedListener?.();
      throw apiError(403, 'Device secret does not match');
    });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(result.current.deviceId).toBe('dev-starter');
    expect(result.current.username).toBe('Nikos');
    expect(result.current.moved).toBe(false);
    expect(readPendingMove()).toBeNull();
  });

  it('SYC-664 ship F1 (a): a 429 at start-up is not a refusal: the move is kept and tried again, then adopts', async () => {
    pending(5_000);
    redeem
      .mockRejectedValueOnce(apiError(429, 'link_not_valid'))
      .mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(result.current.deviceId).toBe('dev-lili');
    expect(result.current.moved).toBe(false);
  });

  it('SYC-664 ship F1 (a): only 429s at start-up: the move is kept for the next try', async () => {
    pending(5_000);
    redeem.mockRejectedValue(apiError(429, 'link_not_valid'));
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(RESUME_RETRY.attempts);
    expect(result.current.deviceId).toBe('dev-starter');
    expect(readPendingMove()).not.toBeNull();
  });

  it('N1 (c) always a network error, inside the window: the move is kept, and no "moved" screen while it is', async () => {
    pending(5_000);
    redeem.mockRejectedValue(offline());
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(RESUME_RETRY.attempts);
    expect(result.current.deviceId).toBe('dev-starter');
    expect(readPendingMove()).not.toBeNull();
    // The old id's device_moved, while our own move is pending, is not shown.
    api.movedListener?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.moved).toBe(false);
  });

  it('N1: retries stop once the window has passed, and the move is cleared', async () => {
    pending(59_990);
    redeem.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw offline();
    });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(readPendingMove()).toBeNull();
  });

  it('N2: if writing the restored identity fails, the pending move survives for the next start', async () => {
    pending(5_000);
    redeem.mockResolvedValue({ deviceId: 'dev-lili', username: 'Lili' });
    failWrite.key = 'cat-spotter/device-id';
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.startupError).not.toBeNull());
    expect(readPendingMove()).not.toBeNull();
  });

  it('a device_moved after the resume is still shown', async () => {
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).not.toHaveBeenCalled();
    api.movedListener?.();
    await waitFor(() => expect(result.current.moved).toBe(true));
  });
});
