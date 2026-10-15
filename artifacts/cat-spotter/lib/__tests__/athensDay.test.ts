import { describe, expect, it } from 'vitest';
import { athensDay, athensDaysBetween } from '../athensDay';

// SYC-36 (feeding-nudge.md §9.1 test 9): days turn at Syros midnight, through
// both daylight-saving changes.

const at = (iso: string) => Date.parse(iso);

describe('athensDay', () => {
  it('23:58 and 00:05 Athens are different days (summer, UTC+3)', () => {
    expect(athensDay(at('2026-07-10T20:58:00Z'))).toBe('2026-07-10');
    expect(athensDay(at('2026-07-10T21:05:00Z'))).toBe('2026-07-11');
  });

  it('across the night the clocks go back (25 Oct 2026)', () => {
    // 24 Oct 23:58 is UTC+3; 25 Oct 00:05 is still UTC+3 (the change is at 04:00).
    expect(athensDay(at('2026-10-24T20:58:00Z'))).toBe('2026-10-24');
    expect(athensDay(at('2026-10-24T21:05:00Z'))).toBe('2026-10-25');
    // 25 Oct 23:58 is UTC+2.
    expect(athensDay(at('2026-10-25T21:58:00Z'))).toBe('2026-10-25');
    expect(athensDay(at('2026-10-25T22:05:00Z'))).toBe('2026-10-26');
  });

  it('across the night the clocks go forward (28 Mar 2027)', () => {
    expect(athensDay(at('2027-03-27T21:58:00Z'))).toBe('2027-03-27');
    expect(athensDay(at('2027-03-27T22:05:00Z'))).toBe('2027-03-28');
    expect(athensDay(at('2027-03-28T20:58:00Z'))).toBe('2027-03-28');
    expect(athensDay(at('2027-03-28T21:05:00Z'))).toBe('2027-03-29');
  });
});

describe('athensDaysBetween', () => {
  it('counts calendar days, whatever the day length', () => {
    expect(athensDaysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(athensDaysBetween('2026-07-01', '2026-07-21')).toBe(20);
    expect(athensDaysBetween('2026-07-10', '2026-07-10')).toBe(0);
    expect(athensDaysBetween('2026-07-11', '2026-07-10')).toBe(-1);
  });
});
