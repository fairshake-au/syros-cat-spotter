import { describe, expect, it } from 'vitest';
import { BADGE_IDS, LANGUAGES, TRANSLATIONS, type Language } from '../i18n';

const LANG_CODES = Object.keys(TRANSLATIONS) as Language[];

describe('i18n dictionaries', () => {
  it('has a dictionary for every declared language', () => {
    expect(LANG_CODES.sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  it('all languages define the exact same set of keys', () => {
    const enKeys = Object.keys(TRANSLATIONS.en).sort();
    for (const code of LANG_CODES) {
      const keys = Object.keys(TRANSLATIONS[code]).sort();
      const missing = enKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !enKeys.includes(k));
      expect({ language: code, missing, extra }).toEqual({
        language: code,
        missing: [],
        extra: [],
      });
    }
  });

  it('every badge has a label and description in every language', () => {
    for (const code of LANG_CODES) {
      const dict = TRANSLATIONS[code];
      for (const badge of BADGE_IDS) {
        expect(dict[`badge_${badge}`], `badge_${badge} in ${code}`).toBeTruthy();
        expect(dict[`badge_${badge}_desc`], `badge_${badge}_desc in ${code}`).toBeTruthy();
      }
    }
  });

  it('no translation value is empty', () => {
    for (const code of LANG_CODES) {
      for (const [key, value] of Object.entries(TRANSLATIONS[code])) {
        expect(value.trim(), `${code}.${key}`).not.toBe('');
      }
    }
  });
});
