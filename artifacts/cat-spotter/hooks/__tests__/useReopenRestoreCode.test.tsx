// @vitest-environment jsdom
/**
 * SYC-664: a phone with a name that reloads while its person is in Mail is sent
 * back to the code box once per app start, never in a loop.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTORE_WAITING_KEY } from '@/lib/restoreWaiting';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('expo-router', () => ({ router: { replace } }));

import { useReopenRestoreCode } from '../useReopenRestoreCode';

function note(askedAt = Date.now()) {
  window.localStorage.setItem(RESTORE_WAITING_KEY, JSON.stringify({ askedAt, requests: 1, wrongTries: 0 }));
}

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
  replace.mockReset();
});

describe('useReopenRestoreCode', () => {
  it('sends a named phone with a live note to /get-spots-back', () => {
    note();
    renderHook(() => useReopenRestoreCode(true, '/'));
    expect(replace).toHaveBeenCalledWith('/get-spots-back');
  });

  it('only once per app start, so Back from the code screen does not loop', () => {
    note();
    const { rerender } = renderHook(({ p }) => useReopenRestoreCode(true, p), { initialProps: { p: '/' } });
    rerender({ p: '/get-spots-back' });
    rerender({ p: '/' });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('waits until the device is ready', () => {
    note();
    const { rerender } = renderHook(({ r }) => useReopenRestoreCode(r, '/'), { initialProps: { r: false } });
    expect(replace).not.toHaveBeenCalled();
    rerender({ r: true });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a live note, or with an expired one', () => {
    renderHook(() => useReopenRestoreCode(true, '/'));
    note(Date.now() - 16 * 60_000);
    renderHook(() => useReopenRestoreCode(true, '/'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing when already on /get-spots-back or /restore', () => {
    note();
    renderHook(() => useReopenRestoreCode(true, '/get-spots-back'));
    renderHook(() => useReopenRestoreCode(true, '/restore'));
    expect(replace).not.toHaveBeenCalled();
  });
});
