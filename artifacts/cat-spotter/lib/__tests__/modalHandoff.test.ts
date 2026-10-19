/**
 * SYC-44 PR 6.2 (review finding 3): on iOS the reason sheet opens only once
 * the full-screen photo has faded out; elsewhere at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODAL_HANDOFF_MS, afterModalCloses } from '../modalHandoff';

afterEach(() => {
  vi.useRealTimers();
});

describe('afterModalCloses', () => {
  it('opens at once on the web and Android', () => {
    for (const os of ['web', 'android']) {
      const open = vi.fn();
      afterModalCloses(open, os);
      expect(open).toHaveBeenCalledTimes(1);
    }
  });

  it('waits for the first modal to go on iOS', () => {
    vi.useFakeTimers();
    const open = vi.fn();
    afterModalCloses(open, 'ios');
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MODAL_HANDOFF_MS);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
