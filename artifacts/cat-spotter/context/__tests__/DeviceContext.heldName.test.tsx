// @vitest-environment jsdom
/** SYC-506: a name held on the phone is kept apart from the saved one. */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

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
}));

import { DeviceProvider, IDENTITY_KEYS, useDevice } from '@/context/DeviceContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DeviceProvider>{children}</DeviceProvider>
);

async function ready() {
  const hook = renderHook(() => useDevice(), { wrapper });
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  return hook;
}

describe('held name (SYC-506)', () => {
  beforeEach(() => store.clear());

  it('holding a name keeps username (the saved name) null, and survives a restart', async () => {
    const { result, unmount } = await ready();
    act(() => result.current.holdUsername('SunnyTabby'));
    expect(result.current.heldUsername).toBe('SunnyTabby');
    expect(result.current.username).toBeNull();
    unmount();
    const again = await ready();
    expect(again.result.current.heldUsername).toBe('SunnyTabby');
    expect(again.result.current.username).toBeNull();
  });

  it('saving a name clears the held one', async () => {
    const { result } = await ready();
    act(() => result.current.holdUsername('SunnyTabby'));
    act(() => result.current.setUsername('SunnyTabby47'));
    expect(result.current.username).toBe('SunnyTabby47');
    expect(result.current.heldUsername).toBeNull();
    await waitFor(() => expect(store.has('cat-spotter/held-username')).toBe(false));
  });

  it('a saved name on the phone wins over a stale held one', async () => {
    store.set('cat-spotter/username', 'Saved');
    store.set('cat-spotter/held-username', 'Stale');
    const { result } = await ready();
    expect(result.current.username).toBe('Saved');
    expect(result.current.heldUsername).toBeNull();
  });

  it('the rename note is stored, read back, and cleared', async () => {
    const { result, unmount } = await ready();
    act(() => result.current.setNameNote({ from: 'Alex', to: 'Alex47', reason: 'taken' }));
    unmount();
    const again = await ready();
    expect(again.result.current.nameNote).toEqual({ from: 'Alex', to: 'Alex47', reason: 'taken' });
    act(() => again.result.current.setNameNote(null));
    expect(again.result.current.nameNote).toBeNull();
    await waitFor(() => expect(store.has('cat-spotter/name-note')).toBe(false));
  });

  it('a corrupt note is ignored', async () => {
    store.set('cat-spotter/name-note', '{"from":1}');
    const { result } = await ready();
    expect(result.current.nameNote).toBeNull();
  });

  it('restore, start again and delete-my-data all forget the held name and note', async () => {
    expect(IDENTITY_KEYS).toContain('cat-spotter/held-username');
    expect(IDENTITY_KEYS).toContain('cat-spotter/name-note');

    const { result } = await ready();
    act(() => result.current.holdUsername('Held'));
    act(() => result.current.setNameNote({ from: 'a', to: 'b', reason: 'refused' }));
    await act(() => result.current.adoptRestoredIdentity('dev-restored', 'Restored'));
    expect(result.current.heldUsername).toBeNull();
    expect(result.current.nameNote).toBeNull();
    expect(store.has('cat-spotter/held-username')).toBe(false);

    act(() => result.current.holdUsername('Held2'));
    await act(() => result.current.startAgain());
    expect(result.current.heldUsername).toBeNull();
    expect(store.has('cat-spotter/held-username')).toBe(false);

    act(() => result.current.holdUsername('Held3'));
    await act(() => result.current.resetIdentity());
    expect(result.current.heldUsername).toBeNull();
    expect(store.has('cat-spotter/held-username')).toBe(false);
  });
});
