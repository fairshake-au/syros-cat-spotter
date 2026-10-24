// @vitest-environment jsdom
/**
 * SYC-508 (couldnt-load-try-again.md §3.1): the cat-alogue hook tells
 * "couldn't load" from "no cats".
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  online: true,
  failRead: false,
  holdRead: null as null | Promise<void>,
  fetch: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      if (h.holdRead) await h.holdRead;
      if (h.failRead) throw new Error('storage broken');
      return h.storage.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => void h.storage.set(k, v),
    removeItem: async (k: string) => void h.storage.delete(k),
  },
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: h.online }) }));
vi.mock('@/lib/catalogue', async () => {
  const real = await vi.importActual<typeof import('@/lib/catalogue')>('@/lib/catalogue');
  return { ...real, fetchWholeCatalogue: (...args: unknown[]) => h.fetch(...args) };
});

import { CATS_CACHE_KEY } from '@/lib/catalogue';
import { useCatsWithCache } from '../useCatsWithCache';

const tigris = { id: 1, name: 'Tigris' };

function wrapper() {
  // No delay before the one retry, so the failure tests run fast.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  h.storage.clear();
  h.online = true;
  h.failRead = false;
  h.holdRead = null;
  h.fetch.mockReset();
});

describe('useCatsWithCache', () => {
  it('loaded: cats, no failure', async () => {
    h.fetch.mockResolvedValue([tigris]);
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cats).toEqual([tigris]));
    expect(result.current.loadFailed).toBe(false);
  });

  it('loaded and really empty: no failure, and the empty list is not saved', async () => {
    h.fetch.mockResolvedValue([]);
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cats).toEqual([]);
    expect(result.current.loadFailed).toBe(false);
    expect(h.storage.has(CATS_CACHE_KEY)).toBe(false);
  });

  it('failed with nothing saved: loadFailed (after the one retry)', async () => {
    h.fetch.mockRejectedValue(new Error('timed out'));
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(false);
  });

  it('failed with a saved empty list: still loadFailed, never "no cats"', async () => {
    h.storage.set(CATS_CACHE_KEY, '[]');
    h.fetch.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
  });

  it('failed with saved cats: shows them, no failure', async () => {
    h.storage.set(CATS_CACHE_KEY, JSON.stringify([tigris]));
    h.fetch.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cats).toEqual([tigris]));
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    expect(result.current.loadFailed).toBe(false);
  });

  it('offline with nothing saved: loadFailed once the saved copy has been read, not before', async () => {
    h.online = false;
    let release: () => void = () => {};
    h.holdRead = new Promise<void>((r) => (release = r));
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.isLoading).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('a saved-copy read that throws counts as nothing saved', async () => {
    h.online = false;
    h.failRead = true;
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
  });

  it('Try again sends the request even when the phone says offline, and settles', async () => {
    h.online = false;
    const { result } = renderHook(() => useCatsWithCache(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    h.fetch.mockResolvedValue([tigris]);
    await act(async () => {
      await result.current.retry();
    });
    expect(h.fetch).toHaveBeenCalled();
    await waitFor(() => expect(result.current.cats).toEqual([tigris]));
    expect(result.current.loadFailed).toBe(false);
  });
});
