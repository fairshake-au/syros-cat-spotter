// @vitest-environment jsdom
/** SYC-506: the background save of a name chosen offline. */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store, net } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  net: { online: true },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
    multiRemove: vi.fn(async (ks: string[]) => ks.forEach((k) => store.delete(k))),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter: vi.fn(),
  getProfile: vi.fn(async () => ({ ownedCatIds: [] })),
  setDeviceMovedListener: () => undefined,
  claimUsername: vi.fn(),
  getClaimedUsername: vi.fn(),
}));

vi.mock('@/context/OfflineContext', () => ({
  useOffline: () => ({ isOnline: net.online }),
}));

import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { HELD_NAME_RETRY_MS, useHeldNameSaver } from '@/hooks/useHeldNameSaver';
import {
  resetUsernameClaimStateForTests,
  usernameClaimOpen,
  waitForUsernameClaimToSettle,
} from '@/hooks/useUsernameClaim';
import type { HeldNameDeps } from '@/lib/heldNameSave';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DeviceProvider>{children}</DeviceProvider>
);

function fakeServer(over: Partial<HeldNameDeps> = {}): HeldNameDeps {
  return {
    read: vi.fn(async () => ({ username: null })),
    claim: vi.fn(async (_id, { username }) => ({ username })),
    numbered: (name) => `${name}47`,
    suggest: () => 'WhiskerPaw',
    ...over,
  };
}

async function start(deps: HeldNameDeps) {
  const hook = renderHook(
    () => {
      useHeldNameSaver(deps);
      return useDevice();
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  return hook;
}

describe('useHeldNameSaver (SYC-506)', () => {
  beforeEach(() => {
    store.clear();
    net.online = true;
    resetUsernameClaimStateForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('saves a held name once online: it becomes the saved name', async () => {
    store.set('cat-spotter/held-username', 'SunnyTabby');
    const deps = fakeServer();
    const { result } = await start(deps);
    await waitFor(() => expect(result.current.username).toBe('SunnyTabby'));
    expect(result.current.heldUsername).toBeNull();
    expect(result.current.nameNote).toBeNull();
    expect(store.get('cat-spotter/username')).toBe('SunnyTabby');
  });

  it('does nothing offline, and saves when the connection returns', async () => {
    store.set('cat-spotter/held-username', 'SunnyTabby');
    net.online = false;
    const deps = fakeServer();
    const { result, rerender } = await start(deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.read).not.toHaveBeenCalled();
    expect(result.current.username).toBeNull();
    net.online = true;
    rerender();
    await waitFor(() => expect(result.current.username).toBe('SunnyTabby'));
  });

  it('a taken name is saved with a number and leaves a note', async () => {
    store.set('cat-spotter/held-username', 'SunnyTabby');
    const deps = fakeServer({
      claim: vi.fn(async (_id, { username }) => {
        if (username === 'SunnyTabby') throw Object.assign(new Error('taken'), { status: 409 });
        return { username };
      }),
    });
    const { result } = await start(deps);
    await waitFor(() => expect(result.current.username).toBe('SunnyTabby47'));
    expect(result.current.nameNote).toEqual({ from: 'SunnyTabby', to: 'SunnyTabby47', reason: 'taken' });
  });

  it('keeps the held name after a failed try and tries again a minute later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    store.set('cat-spotter/held-username', 'SunnyTabby');
    let up = false;
    const deps = fakeServer({
      read: vi.fn(async () => {
        if (!up) throw new Error('unreachable');
        return { username: null };
      }),
    });
    const { result } = await start(deps);
    await waitFor(() => expect(deps.read).toHaveBeenCalledTimes(1));
    expect(result.current.heldUsername).toBe('SunnyTabby');
    expect(result.current.username).toBeNull();
    up = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HELD_NAME_RETRY_MS);
    });
    await waitFor(() => expect(result.current.username).toBe('SunnyTabby'));
  });

  it('restore waits for an open save, and a save that ends after a restore is not applied', async () => {
    store.set('cat-spotter/held-username', 'SunnyTabby');
    let answer!: (v: { username: string }) => void;
    const deps = fakeServer({
      claim: vi.fn(() => new Promise<{ username: string }>((r) => { answer = r; })),
    });
    const { result } = await start(deps);
    await waitFor(() => expect(deps.claim).toHaveBeenCalled());
    expect(usernameClaimOpen()).toBe(true);

    let settled = false;
    void waitForUsernameClaimToSettle().then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    // The spotter restores another identity while the claim is still open
    // (in the app, restore waits; this forces the late answer case).
    await act(() => result.current.adoptRestoredIdentity('dev-restored', 'Restored'));
    await act(async () => answer({ username: 'SunnyTabby' }));
    await waitFor(() => expect(settled).toBe(true));
    expect(result.current.username).toBe('Restored');
    expect(store.get('cat-spotter/username')).toBe('Restored');
  });

  it('does not run when the phone already has a saved name', async () => {
    store.set('cat-spotter/username', 'Saved');
    const deps = fakeServer();
    await start(deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.read).not.toHaveBeenCalled();
  });
});
