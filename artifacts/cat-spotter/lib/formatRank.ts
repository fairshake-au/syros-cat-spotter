import type { Language } from './i18n';

// Rank as a word-ready ordinal: en 1st/2nd/3rd/4th, fr 1er/2e, el plain number.
export function formatRank(language: Language, n: number): string {
  if (language === 'el') return String(n);
  if (language === 'fr') return n === 1 ? '1er' : `${n}e`;
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
