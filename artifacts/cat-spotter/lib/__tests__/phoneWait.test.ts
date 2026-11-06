import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { reportPhoneWait, startPhoneWait } from '../phoneWait';

function clockOf(...times: number[]): () => number {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

describe('startPhoneWait', () => {
  it('gives whole ms between start and stop', () => {
    const stop = startPhoneWait(clockOf(1000, 3500));
    expect(stop()).toBe(2500);
  });

  it('rounds to whole ms', () => {
    const stop = startPhoneWait(clockOf(1000, 3500.6));
    expect(stop()).toBe(2501);
  });

  it('gives null past 600000 ms', () => {
    const stop = startPhoneWait(clockOf(0, 700000));
    expect(stop()).toBeNull();
  });

  it('gives null for a negative wait', () => {
    const stop = startPhoneWait(clockOf(5000, 4000));
    expect(stop()).toBeNull();
  });
});

describe('reportPhoneWait', () => {
  it('posts the id, device and wait', () => {
    const post = vi.fn().mockResolvedValue(undefined);
    reportPhoneWait(post, 7, 'dev', 2500);
    expect(post).toHaveBeenCalledWith(7, { deviceId: 'dev', waitMs: 2500 });
  });

  it('does nothing when the wait is null', () => {
    const post = vi.fn();
    reportPhoneWait(post, 7, 'dev', null);
    expect(post).not.toHaveBeenCalled();
  });

  it('swallows a rejecting post', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const post = vi.fn().mockRejectedValue(new Error('down'));
    expect(() => reportPhoneWait(post, 7, 'dev', 10)).not.toThrow();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('swallows a post that throws at once', () => {
    const post = vi.fn(() => {
      throw new Error('sync');
    });
    expect(() => reportPhoneWait(post, 7, 'dev', 10)).not.toThrow();
  });
});

describe('where it is wired', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, p), 'utf8');

  it('the offline replay never imports phoneWait', () => {
    expect(read('../../context/OfflineContext.tsx')).not.toMatch(/phoneWait/);
  });

  it('the save path in spot.tsx never reports', () => {
    const src = read('../../app/(tabs)/spot.tsx');
    const start = src.indexOf('save: () =>');
    const end = src.indexOf('offerSaveForLater', start);
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, end)).not.toMatch(/PhoneWait/);
  });

  it('spot.tsx reports only for a sent, non-failed-check answer', () => {
    const src = read('../../app/(tabs)/spot.tsx');
    expect(src).toMatch(/startPhoneWait\(\)/);
    expect(src).toMatch(/await createSighting\([\s\S]{0,400}phoneWaitMs = stopPhoneWait\(\)/);
    expect(src).toMatch(
      /outcome\.kind === 'sent' && waitOutcome\.kind !== 'couldntCheck'[\s\S]{0,200}reportPhoneWait/,
    );
  });

  it('review.tsx times the recheck', () => {
    const src = read('../../app/review.tsx');
    expect(src).toMatch(/startPhoneWait\(\)/);
    expect(src).toMatch(/res\.matchCheck === "done"[\s\S]{0,120}reportPhoneWait\(recordPhoneWait[^\n]*stopPhoneWait\(\)/);
  });
});
