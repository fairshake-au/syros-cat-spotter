import { describe, it, expect } from 'vitest';
import { daysLeft } from '../campaignDates';

/**
 * The campaign's `endsAt` is date-only by default ("2026-12-31"), which means
 * "through the end of that day in Syros". Parsing it as UTC midnight made the
 * final local day read "0 days left" from ~02:00 Athens onward.
 */
describe('daysLeft', () => {
  it('returns null for an unparseable date', () => {
    expect(daysLeft('not a date', new Date('2026-07-26T12:00:00Z'))).toBeNull();
  });

  it('counts whole days ahead', () => {
    // 10 days before the end of 2026-12-31 Athens time.
    expect(daysLeft('2026-12-31', new Date('2026-12-21T12:00:00Z'))).toBe(11);
  });

  // The bug: on the campaign's final local day, morning Athens time.
  it('still shows a day left on the final local morning', () => {
    // 2026-12-31 08:00 Athens = 06:00Z (winter, UTC+2). Campaign closes at
    // 23:59:59.999 Athens the same day, so there is still time on the clock.
    expect(daysLeft('2026-12-31', new Date('2026-12-31T06:00:00Z'))).toBe(1);
  });

  it('still shows a day left late on the final local evening', () => {
    // 2026-12-31 23:00 Athens = 21:00Z. Not over yet.
    expect(daysLeft('2026-12-31', new Date('2026-12-31T21:00:00Z'))).toBe(1);
  });

  it('reads 0 once the local day has actually ended', () => {
    // 2027-01-01 00:30 Athens = 2026-12-31T22:30Z. Now it is over.
    expect(daysLeft('2026-12-31', new Date('2026-12-31T22:30:00Z'))).toBe(0);
  });

  it('never goes negative for a long-finished campaign', () => {
    expect(daysLeft('2020-01-01', new Date('2026-07-26T12:00:00Z'))).toBe(0);
  });

  // Summer end date exercises the +03 offset rather than +02.
  it('handles a summer (DST) end date', () => {
    // 2026-07-31 23:00 Athens = 20:00Z (UTC+3). Still open.
    expect(daysLeft('2026-07-31', new Date('2026-07-31T20:00:00Z'))).toBe(1);
    // 2026-08-01 00:30 Athens = 2026-07-31T21:30Z. Closed.
    expect(daysLeft('2026-07-31', new Date('2026-07-31T21:30:00Z'))).toBe(0);
  });

  it('still accepts a full ISO datetime', () => {
    expect(
      daysLeft('2026-12-31T12:00:00Z', new Date('2026-12-30T12:00:00Z')),
    ).toBe(1);
  });
});
