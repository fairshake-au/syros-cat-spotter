// @vitest-environment jsdom
/**
 * SYC-130 (claiming-a-cat.md §6): the server's list of owned cats is the one
 * that counts whenever there is a connection. A cat the owner let go of, or
 * the team removed the owner from, must not keep owner controls on a phone
 * that remembered it.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async (_key: string, _value: string) => {}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter: vi.fn(),
  setDeviceMovedListener: () => undefined,
  getProfile,
}));

import { DeviceProvider, useDevice } from '@/context/DeviceContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DeviceProvider>{children}</DeviceProvider>
);

function store(values: Record<string, string>) {
  getItem.mockImplementation(async (key: string) => values[key] ?? null);
}

const SAVED = {
  'cat-spotter/device-id': 'dev-owner',
  'cat-spotter/device-secret': 'sec-owner',
  'cat-spotter/username': 'Eleni',
  'cat-spotter/owned-cat-ids': JSON.stringify([7, 9]),
};

function lastSavedOwned(): number[] | null {
  const calls = setItem.mock.calls.filter((c) => c[0] === 'cat-spotter/owned-cat-ids');
  return calls.length ? JSON.parse(calls[calls.length - 1]![1]) : null;
}

describe('DeviceProvider — owned cats come from the server (SYC-130)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts from the saved list while offline', async () => {
    store(SAVED);
    getProfile.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(result.current.ownedCatIds).toEqual([7, 9]);
  });

  it('online, a server profile without a cat removes it from the list and from storage', async () => {
    store(SAVED);
    getProfile.mockResolvedValue({ ownedCatIds: [9] });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.ownedCatIds).toEqual([9]));
    expect(lastSavedOwned()).toEqual([9]);
  });

  it('online, a server profile with no cats empties the list', async () => {
    store(SAVED);
    getProfile.mockResolvedValue({ ownedCatIds: [] });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.ownedCatIds).toEqual([]));
    expect(lastSavedOwned()).toEqual([]);
  });

  it('online, the server list is used as is, with cats this phone had not heard of', async () => {
    store(SAVED);
    getProfile.mockResolvedValue({ ownedCatIds: [9, 12] });
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.ownedCatIds).toEqual([9, 12]));
  });

  it('removeOwnedCat drops the cat at once and saves the shorter list', async () => {
    store(SAVED);
    getProfile.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useDevice(), { wrapper });
    await waitFor(() => expect(result.current.ownedCatIds).toEqual([7, 9]));
    act(() => result.current.removeOwnedCat(7));
    expect(result.current.ownedCatIds).toEqual([9]);
    expect(lastSavedOwned()).toEqual([9]);
  });
});
