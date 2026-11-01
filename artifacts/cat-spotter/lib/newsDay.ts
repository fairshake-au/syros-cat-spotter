import type { Language } from './i18n';

/**
 * SYC-221: the day in a piece of cat news, worded in the app's language from a
 * Syros calendar day ("YYYY-MM-DD"). Fixed lists, never Intl (Hermes), and no
 * clock: the day arrives already as a calendar day. Matches the server's
 * newsWords.ts word for word. Greek and French are drafts for native review
 * (SYC-4).
 */

// By getUTCDay() (0 = Sunday). Greek carries its article in the accusative
// ("την Τρίτη"), as "on Tuesday" needs; French has none.
const WEEKDAY: Record<Language, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  el: ['την Κυριακή', 'τη Δευτέρα', 'την Τρίτη', 'την Τετάρτη', 'την Πέμπτη', 'την Παρασκευή', 'το Σάββατο'], // SYC-4: draft
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'], // SYC-4: draft
};

// Greek months in the genitive ("3 Οκτωβρίου"), as a date needs.
const MONTH: Record<Language, readonly string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  el: ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'], // SYC-4: draft
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'], // SYC-4: draft
};

function ymdParts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** "Tuesday" / "την Τρίτη" / "mardi" for a Syros day. */
export function weekdayWord(day: string, lang: Language): string {
  const { y, m, d } = ymdParts(day);
  return WEEKDAY[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** "3 October" / "3 Οκτωβρίου" / "3 octobre" (French "1er" for the first). */
export function dateWord(day: string, lang: Language): string {
  const { m, d } = ymdParts(day);
  const n = lang === 'fr' && d === 1 ? '1er' : String(d);
  return `${n} ${MONTH[lang][m - 1]}`;
}
