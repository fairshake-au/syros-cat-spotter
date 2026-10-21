import type { Language } from '@/lib/i18n';

/**
 * SYC-155: the app's starting language, from the phone or browser.
 * The first tag whose language part is one the app speaks wins (`fr-BE` is
 * French, `el-CY` Greek); anything else, or nothing, is English.
 */
export function pickLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (primary === 'el' || primary === 'fr' || primary === 'en') return primary;
  }
  return 'en';
}

/**
 * The phone's or browser's languages, most preferred first. The web gives the
 * browser's whole list; iPhone and Android give the phone's main language via
 * Intl (no native module, spec Decision 1). Never throws: no answer is [].
 */
export function deviceLanguageTags(): string[] {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.languages?.length) return [...nav.languages];
    if (nav?.language) return [nav.language];
  } catch {
    // fall through to Intl
  }
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale ? [locale] : [];
  } catch {
    return [];
  }
}
