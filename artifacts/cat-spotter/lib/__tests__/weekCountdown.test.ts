import { describe, expect, it } from 'vitest';
import { weekCountdown } from '../weekCountdown';

const ENDS = '2026-10-26T00:00:00+02:00'; // Monday 00:00 Athens (winter time)

describe('weekCountdown', () => {
  it('counts Athens calendar days from endsAt', () => {
    expect(weekCountdown(ENDS, new Date('2026-10-22T19:00:00+03:00'))).toEqual({ unit: 'days', n: 3 });
    expect(weekCountdown(ENDS, new Date('2026-10-19T00:00:00+03:00'))).toEqual({ unit: 'days', n: 6 });
  });
  it('is Saturday late night = 1 day, not hours', () => {
    expect(weekCountdown(ENDS, new Date('2026-10-24T23:30:00+03:00'))).toEqual({ unit: 'days', n: 1 });
  });
  it('switches to hours on Sunday', () => {
    expect(weekCountdown(ENDS, new Date('2026-10-25T19:00:00+02:00'))).toEqual({ unit: 'hours', n: 5 });
    expect(weekCountdown(ENDS, new Date('2026-10-25T23:59:30+02:00'))).toEqual({ unit: 'hours', n: 1 });
  });
  it('is null once the week has closed', () => {
    expect(weekCountdown(ENDS, new Date('2026-10-26T00:00:00+02:00'))).toBeNull();
  });
});
