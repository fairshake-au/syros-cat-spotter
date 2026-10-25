// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SYC-664 final review I1: "A reload mid-move" (spec, Technical notes). The app
 * stored a pending move just before redeem. If it opens again within 15 minutes, it
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
import { RESTORE_PENDING_MOVE_KEY, clearPendingMove, notePendingMove, readPendingMove } from '@/lib/restoreWaiting';
import { finishPendingMove } from '@/lib/pendingMove';

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
  it('(a) a pending move under 15 minutes: the replay answers, the phone adopts the restored id and never shows "moved"', async () => {
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
      // N-1: start-up only ever asks for the replay; it never makes a fresh move.
      { token: 'handle-9', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true, replayOnly: true },
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

  it('(b) a pending move older than 15 minutes: cleared, nothing sent, a normal start', async () => {
    pending(15 * 60_000 + 1_000);
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

  it('SYC-664 ship N-2: the replay limiter\'s 429 (too_many_tries) is retried like any 429, then adopts', async () => {
    pending(5_000);
    redeem
      .mockRejectedValueOnce(apiError(429, 'too_many_tries'))
      .mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(result.current.deviceId).toBe('dev-lili');
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
    // A minute inside the window, then the first (failing) try moves the clock
    // past it. With only 10 ms to spare the first try itself could miss the
    // window on a slow machine and never run (SYC-717).
    pending(15 * 60_000 - 60_000);
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    redeem.mockImplementation(async () => {
      skew = 120_000;
      throw offline();
    });
    try {
      const { result } = renderHook(() => useDevice(), { wrapper });
      await waitFor(() => expect(result.current.isReady).toBe(true));
      expect(redeem).toHaveBeenCalledTimes(1);
      expect(readPendingMove()).toBeNull();
    } finally {
      clock.mockRestore();
    }
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

describe('SYC-664 ship F2: finishing a pending move inside the session', () => {
  const started = async () => {
    const hook = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    return hook;
  };
  const noteKeep = () => notePendingMove({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true });

  it('a pending Keep move is asked for again as the current id, and the phone adopts the spotter that came back', async () => {
    const { result } = await started();
    noteKeep();
    redeem.mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.finishPendingMove();
    });
    expect(redeem).toHaveBeenCalledWith(
      'dev-starter',
      { token: 'handle-9', choice: 'choice-lili', abandonCurrent: true, replayOnly: true },
      expect.anything(),
    );
    expect(outcome).toEqual({ deviceId: 'dev-lili', username: 'Lili' });
    expect(result.current.deviceId).toBe('dev-lili');
    expect(result.current.username).toBe('Lili');
    expect(readPendingMove()).toBeNull();
  });

  it('nothing pending: sends nothing', async () => {
    const { result } = await started();
    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.finishPendingMove();
    });
    expect(outcome).toBeNull();
    expect(redeem).not.toHaveBeenCalled();
  });

  it('one at a time: a second try while one is in flight waits for it and sends nothing more', async () => {
    const { result } = await started();
    noteKeep();
    let answer!: (v: { deviceId: string; username: string | null }) => void;
    redeem.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    await act(async () => {
      a = result.current.finishPendingMove();
      b = result.current.finishPendingMove();
    });
    await act(async () => {
      answer({ deviceId: 'dev-lili', username: 'Lili' });
      await Promise.all([a, b]);
    });
    expect(redeem).toHaveBeenCalledTimes(1);
    await expect(b).resolves.toEqual({ deviceId: 'dev-lili', username: 'Lili' });
    expect(result.current.deviceId).toBe('dev-lili');
  });

  it('a network error or 429 keeps the move for the next try; a definite refusal clears it', async () => {
    const { result } = await started();
    noteKeep();
    redeem.mockRejectedValueOnce(offline());
    await act(async () => {
      await expect(result.current.finishPendingMove()).rejects.toBeTruthy();
    });
    expect(readPendingMove()).not.toBeNull();
    redeem.mockRejectedValueOnce(apiError(429, 'link_not_valid'));
    await act(async () => {
      await expect(result.current.finishPendingMove()).rejects.toBeTruthy();
    });
    expect(readPendingMove()).not.toBeNull();
    redeem.mockRejectedValueOnce(apiError(401, 'link_not_valid'));
    await act(async () => {
      await expect(result.current.finishPendingMove()).rejects.toBeTruthy();
    });
    expect(readPendingMove()).toBeNull();
    expect(result.current.deviceId).toBe('dev-starter');
  });
});

describe('SYC-664 ship N-1: background finishing is replay-only and drops stale answers', () => {
  const started = async () => {
    const hook = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    return hook;
  };

  it('the Nikos case: a "Move, delete Nikos" that never reached the server, backed out of, is not carried out when the phone comes back online', async () => {
    const { result } = await started();
    // The person chose "delete Nikos", the request failed before the server, and they backed out.
    notePendingMove({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true, deleteCurrent: true });
    redeem.mockRejectedValueOnce(apiError(401, 'link_not_valid'));
    await act(async () => {
      await result.current.finishPendingMove({ background: true }).catch(() => {});
    });
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(redeem.mock.calls[0]![1]).toMatchObject({ replayOnly: true });
    expect(readPendingMove()).toBeNull();
    expect(result.current.deviceId).toBe('dev-starter');
    expect(result.current.username).toBe('Nikos');
  });

  it('"Try again" (fullRedeem) may send the full move', async () => {
    const { result } = await started();
    notePendingMove({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true });
    redeem.mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
    await act(async () => {
      await result.current.finishPendingMove({ fullRedeem: true });
    });
    expect(redeem.mock.calls[0]![1]).not.toHaveProperty('replayOnly');
    expect(result.current.deviceId).toBe('dev-lili');
  });

  it('M-a: an answer that lands after the pending move was cleared is dropped, not adopted', async () => {
    const { result } = await started();
    notePendingMove({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true });
    redeem.mockImplementationOnce(async () => {
      clearPendingMove(); // e.g. "Start again" or a new code meanwhile
      return { deviceId: 'dev-lili', username: 'Lili' };
    });
    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.finishPendingMove({ background: true });
    });
    expect(outcome).toBeNull();
    expect(result.current.deviceId).toBe('dev-starter');
    expect(result.current.username).toBe('Nikos');
  });

  it('M-a: an answer for an id the phone no longer holds is dropped, not adopted', async () => {
    notePendingMove({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true });
    const adopt = vi.fn(async () => {});
    let current = 'dev-starter';
    redeem.mockImplementationOnce(async () => {
      current = 'dev-someone-new'; // the phone became a new spotter while the request was out
      return { deviceId: 'dev-lili', username: 'Lili' };
    });
    const outcome = await finishPendingMove('dev-starter', adopt, 1, { replayOnly: true, currentId: () => current });
    expect(outcome).toBeNull();
    expect(adopt).not.toHaveBeenCalled();
  });

  it('point 5: a background finish that adopts reloads the web app at "/"', async () => {
    const replace = vi.fn();
    const saved = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace } });
    try {
      const { result } = await started();
      notePendingMove({ handle: 'handle-9', choice: 'choice-lili', abandonCurrent: true });
      redeem.mockResolvedValueOnce({ deviceId: 'dev-lili', username: 'Lili' });
      await act(async () => {
        await result.current.finishPendingMove({ background: true });
      });
      expect(storage.get('cat-spotter/device-id')).toBe('dev-lili');
      expect(replace).toHaveBeenCalledWith('/');
    } finally {
      if (saved) Object.defineProperty(window, 'location', saved);
    }
  });
});
