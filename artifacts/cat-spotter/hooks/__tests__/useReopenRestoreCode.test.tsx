// @vitest-environment jsdom
/**
 * SYC-664: a phone with a name that reloads while its person is in Mail is sent
 * back to the code box once per app start, never in a loop.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTORE_WAITING_KEY } from '@/lib/restoreWaiting';

const { replace, nav } = vi.hoisted(() => ({ replace: vi.fn(), nav: { key: 'root' as string | undefined } }));
vi.mock('expo-router', () => ({ router: { replace }, useRootNavigationState: () => ({ key: nav.key }) }));

import { restoreReopenReady, useReopenRestoreCode } from '../useReopenRestoreCode';

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
  nav.key = 'root';
});

type P = { ready: boolean; named: boolean; path: string };
const run = (init: P) =>
  renderHook((p: P) => useReopenRestoreCode(p.ready, p.named, p.path), { initialProps: init });
const base: P = { ready: true, named: true, path: '/' };

describe('useReopenRestoreCode', () => {
  it('sends a named phone with a live note to /get-spots-back', () => {
    note();
    run(base);
    expect(replace).toHaveBeenCalledWith('/get-spots-back');
  });

  it('only once per app start, so Back from the code screen does not loop', () => {
    note();
    const { rerender } = run(base);
    rerender({ ...base, path: '/get-spots-back' });
    rerender({ ...base, path: '/' });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('waits until the gate is ready', () => {
    note();
    const { rerender } = run({ ...base, ready: false });
    expect(replace).not.toHaveBeenCalled();
    rerender(base);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('waits for the root navigator before replacing', () => {
    note();
    nav.key = undefined;
    const { rerender } = run(base);
    expect(replace).not.toHaveBeenCalled();
    nav.key = 'root';
    rerender(base);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('M8: a note with no request (a wrong try, or "I already have a code") reopens nothing', () => {
    window.localStorage.setItem(RESTORE_WAITING_KEY, JSON.stringify({ askedAt: Date.now(), requests: 0, wrongTries: 1 }));
    renderHook(() => useReopenRestoreCode(true, true, '/'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing without a live note, or with an expired one', () => {
    run(base);
    note(Date.now() - 16 * 60_000);
    run(base);
    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing when already on /get-spots-back or /restore', () => {
    note();
    run({ ...base, path: '/get-spots-back' });
    run({ ...base, path: '/restore' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('a note cleared between mount and the first ready render sends nobody', () => {
    note();
    const { rerender } = run({ ...base, ready: false });
    window.localStorage.removeItem(RESTORE_WAITING_KEY);
    rerender(base);
    expect(replace).not.toHaveBeenCalled();
  });

  it('a phone unnamed at its first ready render is never redirected after it gets a name', () => {
    note();
    const { rerender } = run({ ...base, named: false });
    rerender({ ...base, named: true });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('restoreReopenReady', () => {
  const ok = { isReady: true, isLanguageReady: true, startupError: false, doneVisible: false, moved: false, offerScreenShowing: false };
  it('is true only when the ordinary app is showing', () => {
    expect(restoreReopenReady(ok)).toBe(true);
    for (const k of ['isReady', 'isLanguageReady'] as const) expect(restoreReopenReady({ ...ok, [k]: false })).toBe(false);
    for (const k of ['startupError', 'doneVisible', 'moved', 'offerScreenShowing'] as const)
      expect(restoreReopenReady({ ...ok, [k]: true })).toBe(false);
  });
});
