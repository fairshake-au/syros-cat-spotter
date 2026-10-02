import { describe, expect, it } from 'vitest';
import { BADGE_IDS, LANGUAGES, TRANSLATIONS, type Language } from '../i18n';

const LANG_CODES = Object.keys(TRANSLATIONS) as Language[];

function placeholders(value: string): string[] {
  return [...new Set(value.match(/\{[^{}]+\}/g) ?? [])].sort();
}

/** Vouvoiement markers: vous/votre/vos, and the -ez imperatives the app used. */
const VOUS = /(^|[^\p{L}])(vous|votre|vos|veuillez|essayez|réessayez|activez|confirmez|choisissez|vérifiez|indiquez|repérez|enregistrez|découvrez|gagnez|soyez|donnez|utilisez|appuyez|déplacez|regardez|touchez|restez|laissez|photographiez|admirez)([^\p{L}]|$)/iu;

describe('i18n dictionaries', () => {
  it('French uses tu throughout the app (Samuel, 2 Oct 2026)', () => {
    const vous = Object.entries(TRANSLATIONS.fr).filter(([, v]) => VOUS.test(v));
    expect(vous.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });

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

  it('uses the same placeholders for each key in every language', () => {
    for (const key of Object.keys(TRANSLATIONS.en)) {
      const expected = placeholders(TRANSLATIONS.en[key]);
      for (const code of LANG_CODES) {
        expect(placeholders(TRANSLATIONS[code][key]), `${code}.${key}`).toEqual(expected);
      }
    }
  });

  it('uses the requested product name for the welcome title in every language', () => {
    for (const code of LANG_CODES) {
      expect(TRANSLATIONS[code].welcomeTitle, `welcomeTitle in ${code}`).toBe(
        'Syros Cat Spotters',
      );
    }
  });

  // The pun is spelled the British way to match catspotters.com, which is the
  // source of truth for it. This locks the rule, not the copy: any English
  // string reintroducing American "catalog" fails, but the wording stays free
  // to change.
  it('spells catalogue the British way in English', () => {
    const offenders = Object.entries(TRANSLATIONS.en)
      .filter(([, value]) => /catalog(?!ue)/i.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});
