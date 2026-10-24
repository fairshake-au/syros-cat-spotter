import type { Language } from '@/lib/i18n';

/**
 * SYC-624 C1: one date style for the cat page, in Syros time.
 *
 * The server sends bare days (YYYY-MM-DD) already cut in Syros time, and full
 * ISO instants for exact moments. Neither is ever read in the phone's own
 * zone, so a visitor in Auckland or California sees the same day as someone
 * on Syros. Every formatter passes `timeZone` explicitly, so none depends on
 * the process or device zone.
 */

const LOCALES: Record<Language, string> = { en: 'en-GB', el: 'el-GR', fr: 'fr-FR' };
const SYROS_ZONE = 'Europe/Athens';
const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A bad value (empty, garbage) shows nothing rather than crashing the page. */
function fmt(locale: string, options: Intl.DateTimeFormatOptions, date: Date): string {
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(locale, options).format(date);
}

function bareDayToUtc(day: string): Date {
  const m = BARE_DAY.exec(day);
  if (!m) return new Date(day);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** A bare `YYYY-MM-DD`, formatted from its parts so no phone zone can shift it. */
export function formatDay(day: string, language: Language): string {
  return fmt(
    LOCALES[language],
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
    bareDayToUtc(day),
  );
}

/** A full ISO instant, shown as the day it was in Syros. */
export function formatInstant(iso: string, language: Language): string {
  return fmt(
    LOCALES[language],
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: SYROS_ZONE },
    new Date(iso),
  );
}

/** Month and year of a bare day (an instant is read in Syros time). */
export function formatMonthYear(day: string, language: Language): string {
  const isBare = BARE_DAY.test(day);
  return fmt(
    LOCALES[language],
    { month: 'short', year: 'numeric', timeZone: isBare ? 'UTC' : SYROS_ZONE },
    isBare ? bareDayToUtc(day) : new Date(day),
  );
}

/** A bare day goes through `formatDay`, anything else through `formatInstant`. */
export function formatPublicDate(value: string, language: Language): string {
  return BARE_DAY.test(value) ? formatDay(value, language) : formatInstant(value, language);
}
