// @vitest-environment jsdom
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYC-137: after a delete and reinstall the id and secret come back from the
// Keychain, but the saved name does not. The app asks the server for it.

const h = vi.hoisted(() => ({
  identity: { id: 'dev-kept', secret: 'kept-secret-kept-secret', recoveredFromSecure: true },
  storage: new Map<string, string>(),
  getClaimedUsername: vi.fn(),
}));

vi.mock('@/lib/identityStore', () => ({
  ID_KEY: 'cat-spotter/device-id',
  SECRET_KEY: 'cat-spotter/device-secret',
  readIdentity: async () => h.identity,
  readStoredId: async () => h.identity.id,
  removeIdentity: async () => {},
  writeId: async () => {},
  writeSecret: async () => {},
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.storage.set(k, v),
    removeItem: async (k: string) => void h.storage.delete(k),
    multiRemove: async (ks: string[]) => void ks.forEach((k) => h.storage.delete(k)),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter: vi.fn(),
  setDeviceMovedListener: vi.fn(),
  getProfile: vi.fn(async () => ({ ownedCatIds: [] })),
  getClaimedUsername: h.getClaimedUsername,
}));

import { DeviceProvider, useDevice } from '@/context/DeviceContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <DeviceProvider>{children}</DeviceProvider>;

beforeEach(() => {
  h.storage.clear();
  h.identity = { id: 'dev-kept', secret: 'kept-secret-kept-secret', recoveredFromSecure: true };
  h.getClaimedUsername.mockReset();
});

describe('name after a reinstall that kept the Keychain', () => {
  it('asks the server for the name and adopts it', async () => {
    h.getClaimedUsername.mockResolvedValue({ username: 'Lili' });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.username).toBe('Lili'));
    expect(h.getClaimedUsername).toHaveBeenCalledWith('dev-kept');
    expect(h.storage.get('cat-spotter/username')).toBe('Lili');
  });

  it('offline: the person just picks a name, nothing breaks', async () => {
    h.getClaimedUsername.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await waitFor(() => expect(h.getClaimedUsername).toHaveBeenCalled());
    expect(result.current.username).toBeNull();
  });

  it('does not ask when the phone already has its name, or the id was not read from secure storage', async () => {
    h.storage.set('cat-spotter/username', 'Nikos');
    const named = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(named.result.current.username).toBe('Nikos'));
    h.storage.clear();
    h.identity = { ...h.identity, recoveredFromSecure: false };
    const plain = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(plain.result.current.isReady).toBe(true));
    expect(h.getClaimedUsername).not.toHaveBeenCalled();
  });
});
