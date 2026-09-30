// @vitest-environment jsdom
/**
 * SYC-134 review round 2: the tiny shared "is any modal open" flag the
 * floating Home Screen nudge card checks before rendering.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerModalOpen,
  useAnyModalOpen,
  __resetModalVisibilityForTests,
} from '../modalVisibility';

afterEach(() => {
  __resetModalVisibilityForTests();
});

describe('modalVisibility', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useAnyModalOpen());
    expect(result.current).toBe(false);
  });

  it('reports open while a modal is registered, and closed after release', () => {
    const { result } = renderHook(() => useAnyModalOpen());

    let release: () => void = () => {};
    act(() => {
      release = registerModalOpen();
    });
    expect(result.current).toBe(true);

    act(() => {
      release();
    });
    expect(result.current).toBe(false);
  });

  it('stays open until every overlapping modal has released (a counter, not a boolean)', () => {
    const { result } = renderHook(() => useAnyModalOpen());

    let releaseA: () => void = () => {};
    let releaseB: () => void = () => {};
    act(() => {
      releaseA = registerModalOpen();
      releaseB = registerModalOpen();
    });
    expect(result.current).toBe(true);

    act(() => {
      releaseA();
    });
    // The second modal is still open.
    expect(result.current).toBe(true);

    act(() => {
      releaseB();
    });
    expect(result.current).toBe(false);
  });

  it('ignores a double-invoked release (e.g. StrictMode-style double cleanup)', () => {
    const { result } = renderHook(() => useAnyModalOpen());

    let release: () => void = () => {};
    act(() => {
      release = registerModalOpen();
    });
    act(() => {
      release();
      release(); // should not double-decrement below zero
    });
    expect(result.current).toBe(false);

    // A fresh open still works correctly afterwards.
    act(() => {
      registerModalOpen();
    });
    expect(result.current).toBe(true);
  });
});
