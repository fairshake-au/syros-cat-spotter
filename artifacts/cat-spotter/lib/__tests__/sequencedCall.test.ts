import { describe, expect, it } from 'vitest';
import { createSequencedRunner } from '../sequencedCall';

describe('createSequencedRunner', () => {
  it('applies the result of a single call', async () => {
    const run = createSequencedRunner<string>();
    const result = await run(() => Promise.resolve('granted'));
    expect(result).toEqual({ applied: true, value: 'granted' });
  });

  it('applies the result of a single failing call', async () => {
    const run = createSequencedRunner<string>();
    const error = new Error('lookup failed');
    const result = await run(() => Promise.reject(error));
    expect(result).toEqual({ applied: true, error });
  });

  it('applies two calls made one after the other, in order', async () => {
    const run = createSequencedRunner<number>();
    const first = await run(() => Promise.resolve(1));
    const second = await run(() => Promise.resolve(2));
    expect(first).toEqual({ applied: true, value: 1 });
    expect(second).toEqual({ applied: true, value: 2 });
  });

  // The scenario this exists for: syncCameraPermission fires on mount (slow,
  // and about to fail) and again moments later on Android resume (fast, and
  // succeeds). The fast, more recent call must win even though the slow one
  // settles after it.
  it('fast success then slow failure must leave the success in place', async () => {
    const run = createSequencedRunner<string>();
    let rejectSlow: (err: unknown) => void = () => {};
    const slowLookup = () =>
      new Promise<string>((_resolve, reject) => {
        rejectSlow = reject;
      });
    const fastLookup = () => Promise.resolve('granted');

    // Call 1: slow, will eventually fail — started first, so it is the
    // stale one once call 2 starts.
    const slowPromise = run(slowLookup);
    // Call 2: fast, succeeds immediately — started second, so it is current.
    const fastPromise = run(fastLookup);

    const fast = await fastPromise;
    expect(fast).toEqual({ applied: true, value: 'granted' });

    // The slow call only settles now, after the fast one already applied.
    rejectSlow(new Error('permission lookup failed'));
    const slow = await slowPromise;
    expect(slow.applied).toBe(false);
  });

  // The mirror case: a stale SUCCESS must not overwrite a newer failure
  // either — staleness is about when the call started, not what it returned.
  it('fast failure then slow success must leave the failure in place', async () => {
    const run = createSequencedRunner<string>();
    let resolveSlow: (value: string) => void = () => {};
    const slowLookup = () =>
      new Promise<string>((resolve) => {
        resolveSlow = resolve;
      });
    const fastLookup = () => Promise.reject(new Error('lookup failed'));

    const slowPromise = run(slowLookup);
    const fastPromise = run(fastLookup);

    const fast = await fastPromise;
    expect(fast.applied).toBe(true);
    expect(fast.error).toBeInstanceOf(Error);

    resolveSlow('granted');
    const slow = await slowPromise;
    expect(slow.applied).toBe(false);
  });
});
