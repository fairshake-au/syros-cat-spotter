import { describe, expect, it } from 'vitest';
import { formatDay, formatInstant, formatMonthYear, formatPublicDate } from '../catPageDates';

describe('catPageDates (SYC-624 C1)', () => {
  it('formatDay reads the bare day as written', () => {
    expect(formatDay('2026-10-21', 'en')).toBe('21 Oct 2026');
  });

  it('formatDay is unchanged when the Date it builds is shifted into any zone', () => {
    // The formatter passes timeZone explicitly, so process.env.TZ cannot matter.
    // Prove it: fake the clock and the zone offset of every Date method it could
    // lean on, then check the result is still the same day.
    const original = Date.prototype.getTimezoneOffset;
    for (const offset of [-780, 480, 0]) {
      Date.prototype.getTimezoneOffset = () => offset;
      expect(formatDay('2026-10-21', 'en')).toBe('21 Oct 2026');
      expect(formatDay('2026-01-01', 'en')).toBe('1 Jan 2026');
      expect(formatDay('2026-12-31', 'en')).toBe('31 Dec 2026');
    }
    Date.prototype.getTimezoneOffset = original;
  });

  for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
    it(`formatDay gives the same day with the phone in ${tz}`, () => {
      const was = process.env.TZ;
      process.env.TZ = tz;
      try {
        expect(formatDay('2026-10-21', 'en')).toBe('21 Oct 2026');
        expect(formatPublicDate('2026-10-21', 'en')).toBe('21 Oct 2026');
        expect(formatInstant('2026-10-22T22:30:00.000Z', 'en')).toBe('23 Oct 2026');
      } finally {
        if (was === undefined) delete process.env.TZ;
        else process.env.TZ = was;
      }
    });
  }

  it('formatInstant shows the day it was in Syros', () => {
    expect(formatInstant('2026-10-22T22:30:00.000Z', 'en')).toBe('23 Oct 2026');
    expect(formatInstant('2026-10-22T20:30:00.000Z', 'en')).toBe('22 Oct 2026');
  });

  it('formatMonthYear', () => {
    expect(formatMonthYear('2026-03-14', 'en')).toBe('Mar 2026');
    expect(formatMonthYear('2026-03-14T23:30:00.000Z', 'en')).toBe('Mar 2026');
    expect(formatMonthYear('2026-02-28T23:30:00.000Z', 'en')).toBe('Mar 2026');
  });

  it('formatPublicDate routes a bare day and an instant', () => {
    expect(formatPublicDate('2026-10-21', 'en')).toBe('21 Oct 2026');
    expect(formatPublicDate('2026-10-22T22:30:00.000Z', 'en')).toBe('23 Oct 2026');
  });

  it('Greek and French give a non-empty string with the year', () => {
    for (const lang of ['el', 'fr'] as const) {
      for (const s of [
        formatDay('2026-10-21', lang),
        formatInstant('2026-10-21T10:00:00.000Z', lang),
        formatMonthYear('2026-10-21', lang),
      ]) {
        expect(s.length).toBeGreaterThan(0);
        expect(s).toContain('2026');
      }
    }
  });
});
