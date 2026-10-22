/**
 * SYC-170 PR 1.2, T1-12: every new string exists in English, Greek and French,
 * and the web wording rewrites exactly the phrases it is meant to.
 */
import { describe, expect, it } from 'vitest';
import { getGuidance } from '@workspace/welfare-guidance';
import { TRANSLATIONS, type Language } from '../i18n';
import { SAVED_ON_PHONE, savedWording } from '../savedWording';
import { displayUpperCase } from '../displayUpperCase';

const NEW_KEYS = ['reportCheckUnavailable', 'turnstileTapLine', 'reportCheckBlocked'];
const LANGS: Language[] = ['en', 'el', 'fr'];

describe('T1-12: the safety-check strings', () => {
  it.each(NEW_KEYS)('%s is present and non-empty in en, el and fr', (key) => {
    for (const lang of LANGS) {
      expect(TRANSLATIONS[lang][key]?.trim(), `${lang}.${key}`).toBeTruthy();
    }
  });

  it('the English confirmation line is the one the plan gives', () => {
    expect(TRANSLATIONS.en.reportCheckUnavailable).toBe(
      'We couldn’t check you’re a real person. Your report is saved and we’ll try again.',
    );
  });

  it('Greek and French differ from English, and French uses tu', () => {
    for (const key of NEW_KEYS) {
      expect(TRANSLATIONS.el[key]).not.toBe(TRANSLATIONS.en[key]);
      expect(TRANSLATIONS.fr[key]).not.toBe(TRANSLATIONS.en[key]);
      expect(TRANSLATIONS.fr[key]).not.toMatch(/\b(vous|votre|vos|veuillez)\b/i);
    }
    expect(TRANSLATIONS.fr.turnstileTapLine).toMatch(/coche/i);
  });

  it('shown in capitals, the Greek lines lose their accents', () => {
    for (const key of NEW_KEYS) {
      expect(displayUpperCase(TRANSLATIONS.el[key])).not.toMatch(/[άέήίόύώΐΰ]/);
    }
  });
});

describe('"saved on your phone" reads "saved in this browser" on the web', () => {
  it('rewrites each language, and only on the web', () => {
    expect(savedWording('This report is saved on your phone and sends itself.', 'en', true)).toBe(
      'This report is saved in this browser and sends itself.',
    );
    expect(savedWording('saved on your phone', 'en', false)).toBe('saved on your phone');
    expect(savedWording('Ce signalement est enregistré sur ton téléphone', 'fr', true)).toBe(
      'Ce signalement est enregistré dans ce navigateur',
    );
    expect(savedWording('αποθηκευμένη στο κινητό σου', 'el', true)).toBe(
      'αποθηκευμένη σε αυτό το πρόγραμμα περιήγησης',
    );
  });

  it('matches the lines it is applied to: the waiting-report copy in all three languages', () => {
    for (const lang of LANGS) {
      const { from, to } = SAVED_ON_PHONE[lang];
      const lines = [
        TRANSLATIONS[lang].reportFailed,
        TRANSLATIONS[lang].reportBusy,
        getGuidance(lang).copy.confirmation.offline,
      ];
      for (const line of lines) {
        expect(line, `${lang}: ${line}`).toContain(from);
        expect(savedWording(line, lang, true)).toContain(to);
        expect(savedWording(line, lang, true)).not.toContain(from);
      }
    }
  });
});
