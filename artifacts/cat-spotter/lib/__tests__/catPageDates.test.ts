/**
 * SYC-624 C1. Zone independence is proved two ways:
 *  1. the "timeZone passed" tests below spy on Intl.DateTimeFormat;
 *  2. the whole file is also run with the process in real zones:
 *       TZ=Pacific/Auckland pnpm exec vitest run lib/__tests__/catPageDates.test.ts
 *       TZ=America/Los_Angeles pnpm exec vitest run lib/__tests__/catPageDates.test.ts
 *     (package scripts: `pnpm run test:zones`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDay, formatInstant, formatMonthYear, formatPublicDate } from '../catPageDates';

afterEach(() => vi.restoreAllMocks());

function spyOnZones(run: () => void): unknown[] {
  const Real = Intl.DateTimeFormat;
  const zones: unknown[] = [];
  const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    this: unknown,
    locale?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    zones.push(options?.timeZone);
    return new Real(locale, options);
  } as unknown as typeof Intl.DateTimeFormat);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return zones;
}

describe('catPageDates (SYC-624 C1)', () => {
  it('formatDay reads the bare day as written, whatever zone the process is in', () => {
    expect(formatDay('2026-10-21', 'en')).toBe('21 Oct 2026');
    expect(formatDay('2026-01-01', 'en')).toBe('1 Jan 2026');
    expect(formatDay('2026-12-31', 'en')).toBe('31 Dec 2026');
    expect(formatPublicDate('2026-10-21', 'en')).toBe('21 Oct 2026');
  });

  it('formatDay and bare-day month/year pass timeZone UTC; instants pass Europe/Athens', () => {
    expect(spyOnZones(() => formatDay('2026-10-21', 'en'))).toEqual(['UTC']);
    expect(spyOnZones(() => formatMonthYear('2026-10-21', 'en'))).toEqual(['UTC']);
    expect(spyOnZones(() => formatPublicDate('2026-10-21', 'en'))).toEqual(['UTC']);
    expect(spyOnZones(() => formatInstant('2026-10-22T22:30:00.000Z', 'en'))).toEqual([
      'Europe/Athens',
    ]);
    expect(spyOnZones(() => formatPublicDate('2026-10-22T22:30:00.000Z', 'en'))).toEqual([
      'Europe/Athens',
    ]);
    expect(spyOnZones(() => formatMonthYear('2026-10-22T22:30:00.000Z', 'en'))).toEqual([
      'Europe/Athens',
    ]);
  });

  it('formatInstant shows the day it was in Syros', () => {
    expect(formatInstant('2026-10-22T22:30:00.000Z', 'en')).toBe('23 Oct 2026');
    expect(formatInstant('2026-10-22T20:30:00.000Z', 'en')).toBe('22 Oct 2026');
  });

  it('formatMonthYear', () => {
    expect(formatMonthYear('2026-03-14', 'en')).toBe('Mar 2026');
    expect(formatMonthYear('2026-03-14T23:30:00.000Z', 'en')).toBe('Mar 2026');
    expect(formatMonthYear('2026-02-28T23:30:00.000Z', 'en')).toBe('Mar 2026');
  });

  it('Greek and French are pinned to exact strings', () => {
    expect(formatDay('2026-10-21', 'el')).toBe('21 Οκτ 2026');
    expect(formatDay('2026-10-21', 'fr')).toBe('21 oct. 2026');
    expect(formatInstant('2026-10-21T10:00:00.000Z', 'el')).toBe('21 Οκτ 2026');
    expect(formatInstant('2026-10-21T10:00:00.000Z', 'fr')).toBe('21 oct. 2026');
    expect(formatMonthYear('2026-10-21', 'el')).toContain('2026');
    expect(formatMonthYear('2026-10-21', 'fr')).toContain('2026');
  });

  it('a malformed or empty value gives an empty string, never a throw', () => {
    for (const bad of ['', 'garbage', '2026-13-45x']) {
      expect(formatDay(bad, 'en')).toBe('');
      expect(formatInstant(bad, 'en')).toBe('');
      expect(formatMonthYear(bad, 'en')).toBe('');
      expect(formatPublicDate(bad, 'en')).toBe('');
    }
  });
});
