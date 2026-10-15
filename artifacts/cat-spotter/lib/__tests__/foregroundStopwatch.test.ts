import { describe, expect, it } from 'vitest';
import { ForegroundStopwatch } from '../foregroundStopwatch';

// SYC-48 (starter-facts.md §9.1 test 3): a fact counts as seen after 3
// seconds on screen; time with the app in the background doesn't count.

describe('ForegroundStopwatch', () => {
  it('counts time on screen', () => {
    const w = new ForegroundStopwatch(1000);
    expect(w.elapsed(4000)).toBe(3000);
  });

  it('leaves out time in the background', () => {
    const w = new ForegroundStopwatch(0);
    w.pause(1000);
    w.resume(10_000);
    expect(w.elapsed(12_000)).toBe(3000);
  });

  it('started in the background counts nothing until resumed', () => {
    const w = new ForegroundStopwatch(0, false);
    expect(w.elapsed(5000)).toBe(0);
    w.resume(5000);
    expect(w.elapsed(6000)).toBe(1000);
  });

  it('a double pause or resume changes nothing', () => {
    const w = new ForegroundStopwatch(0);
    w.pause(1000);
    w.pause(2000);
    w.resume(3000);
    w.resume(4000);
    expect(w.elapsed(5000)).toBe(3000);
  });
});
