// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYC-63 plan §6.2: what "Delete my data" wipes on the phone, and what it keeps.

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

const { setDeviceSecretGetter } = vi.hoisted(() => ({
  setDeviceSecretGetter: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter,
  setDeviceMovedListener: vi.fn(),
  getProfile: vi.fn(async () => ({ ownedCatIds: [7] })),
}));

import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { RESTORE_WAITING_KEY } from '@/lib/restoreWaiting';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DeviceProvider>{children}</DeviceProvider>
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
  vi.clearAllMocks();
});

describe('resetIdentity', () => {
  it('forgets the spotter, keeps preferences and the cat list, and makes a new identity', async () => {
    storage.set('cat-spotter/device-id', 'dev-old');
    storage.set('cat-spotter/device-secret', 'old-secret-old-secret');
    storage.set('cat-spotter/username', 'OldName');
    storage.set('cat-spotter/owned-cat-ids', '[7]');
    storage.set('cat-spotter/ownership-snapshot', '{"7":true}');
    storage.set('cat-spotter/language', 'el');
    storage.set('cat-spotter/appearance', 'dark');
    storage.set('cat-spotter/cats-cache', '[{"id":7}]');
    storage.set('cat-spotter/keep-safe-offer', 'done');

    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.username).toBe('OldName'));
    expect(result.current.deviceId).toBe('dev-old');

    await act(async () => {
      await result.current.resetIdentity();
    });

    expect(result.current.username).toBeNull();
    expect(result.current.ownedCatIds).toEqual([]);
    expect(result.current.deviceId).toMatch(/^dev-/);
    expect(result.current.deviceId).not.toBe('dev-old');
    expect(storage.get('cat-spotter/device-id')).toBe(result.current.deviceId);
    const newSecret = storage.get('cat-spotter/device-secret');
    expect(newSecret).toBeTruthy();
    expect(newSecret).not.toBe('old-secret-old-secret');
    expect(storage.has('cat-spotter/username')).toBe(false);
    expect(storage.has('cat-spotter/owned-cat-ids')).toBe(false);
    expect(storage.has('cat-spotter/ownership-snapshot')).toBe(false);
    // SYC-3: deletion removed the keep-safe address, so it's offered again.
    expect(storage.has('cat-spotter/keep-safe-offer')).toBe(false);
    expect(result.current.keepSafeOffer).toBeNull();
    // Preferences and the public cat list stay.
    expect(storage.get('cat-spotter/language')).toBe('el');
    expect(storage.get('cat-spotter/appearance')).toBe('dark');
    expect(storage.get('cat-spotter/cats-cache')).toBe('[{"id":7}]');
    // Requests from now on carry the new secret.
    const calls = setDeviceSecretGetter.mock.calls;
    expect(calls[calls.length - 1]![0]()).toBe(newSecret);
  });
});

// SYC-664: the "waiting for a code" note belongs to the spotter who asked for it.
describe('the waiting-for-a-code note (SYC-664)', () => {
  const plant = () =>
    window.localStorage.setItem(RESTORE_WAITING_KEY, JSON.stringify({ askedAt: Date.now(), requests: 1, wrongTries: 0 }));

  async function ready() {
    storage.set('cat-spotter/device-id', 'dev-old');
    storage.set('cat-spotter/device-secret', 'old-secret-old-secret');
    storage.set('cat-spotter/username', 'OldName');
    const r = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(r.result.current.username).toBe('OldName'));
    return r;
  }

  it('resetIdentity clears it', async () => {
    const { result } = await ready();
    plant();
    await act(async () => { await result.current.resetIdentity(); });
    expect(window.localStorage.getItem(RESTORE_WAITING_KEY)).toBeNull();
  });

  it('startAgain clears it', async () => {
    const { result } = await ready();
    plant();
    await act(async () => { await result.current.startAgain(); });
    expect(window.localStorage.getItem(RESTORE_WAITING_KEY)).toBeNull();
  });

  it('adoptRestoredIdentity clears it', async () => {
    const { result } = await ready();
    plant();
    await act(async () => { await result.current.adoptRestoredIdentity('dev-restored', 'Lili'); });
    expect(window.localStorage.getItem(RESTORE_WAITING_KEY)).toBeNull();
  });
});
