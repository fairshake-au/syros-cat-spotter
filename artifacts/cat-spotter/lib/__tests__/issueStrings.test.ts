/**
 * SYC-44 PR 6.2, T6-8 (spec §13 test 19) and part of T6-4: every "Report an
 * issue" string exists in English, Greek and French; the web wording says
 * "saved in this browser"; the `photo_private` hint is the narrow one (D2);
 * the confirm step keeps both halves in every language (spec §11).
 */
import { describe, expect, it } from 'vitest';
import { TRANSLATIONS, type Language } from '../i18n';
import { SAVED_ON_PHONE, savedWording } from '../savedWording';
import { displayUpperCase } from '../displayUpperCase';
import { CAT_REASONS, PHOTO_REASONS } from '../issueQueue';

const LANGS: Language[] = ['en', 'el', 'fr'];
const REASONS = [...new Set([...CAT_REASONS, ...PHOTO_REASONS])];
const HINTED = ['photo_private', 'photo_not_cat', 'wrong_cat', 'wrong_info'];

export const ISSUE_KEYS = [
  'reportIssue',
  'reportIssuePhoto',
  'issueHurtFirst',
  ...REASONS.map((r) => `issueReason_${r}`),
  ...HINTED.map((r) => `issueHint_${r}`),
  'issueNoteLabel',
  'issueNoteLabelWrongInfo',
  'issueSend',
  'issueConfirm',
  'issueConfirmHide',
  'issueDoneHidden',
  'issueDoneNotHidden',
  'issueDoneThanks',
  'issueDoneDied',
  'issueSaved',
  'issueSavedBrowserNote',
  'issueReminder',
  'issueSaveFailed',
  // Shared with the cat-in-trouble form, and shown by the sheet too.
  'reportCheckUnavailable',
  'reportCheckBlocked',
  'reportSending',
  'reportBusy',
  'reportFailed',
  'reportTryAgain',
  'reportDone',
  'cancel',
  'back',
];

describe('T6-8: the Report an issue strings', () => {
  it.each(ISSUE_KEYS)('%s is present and non-empty in en, el and fr', (key) => {
    for (const lang of LANGS) {
      expect(TRANSLATIONS[lang][key]?.trim(), `${lang}.${key}`).toBeTruthy();
    }
  });

  it('every reason has a label, all nine of them', () => {
    expect(REASONS).toHaveLength(9);
  });

  it('Greek and French are their own words, and French uses tu', () => {
    for (const key of ISSUE_KEYS) {
      expect(TRANSLATIONS.el[key], `el.${key}`).not.toBe(TRANSLATIONS.en[key]);
      expect(TRANSLATIONS.fr[key], `fr.${key}`).not.toBe(TRANSLATIONS.en[key]);
      expect(TRANSLATIONS.fr[key], `fr.${key}`).not.toMatch(/\b(vous|votre|vos|veuillez)\b/i);
    }
  });

  it('the web strings say "saved in this browser", never "on your phone"', () => {
    for (const lang of LANGS) {
      const { from, to } = SAVED_ON_PHONE[lang];
      const saved = TRANSLATIONS[lang].issueSaved;
      // The phone wording is the one the web rewrite looks for…
      expect(saved, `${lang}.issueSaved`).toContain(from);
      // …so on the web it reads "in this browser".
      const web = savedWording(saved, lang, true);
      expect(web).toContain(to);
      expect(web).not.toContain(from);
    }
    expect(savedWording(TRANSLATIONS.en.issueSaved, 'en', true)).toBe(
      'Saved in this browser. It will be sent when you have a connection.',
    );
  });

  it('French punctuation keeps its space without breaking the line before ? : » (seen wrapping in the browser check)', () => {
    for (const key of ISSUE_KEYS.filter((k) => k.startsWith('issue'))) {
      expect(TRANSLATIONS.fr[key], `fr.${key}`).not.toMatch(/ [?:»]|« /);
    }
  });

  it('shown in capitals, the Greek lines lose their accents (SYC-159)', () => {
    for (const key of ISSUE_KEYS) {
      expect(displayUpperCase(TRANSLATIONS.el[key])).not.toMatch(/[άέήίόύώΐΰ]/);
    }
  });
});

describe('T6-4 (strings): the hint and the first line', () => {
  it('the photo_private hint is exactly the narrow one (D2), with no doorway in any language', () => {
    expect(TRANSLATIONS.en.issueHint_photo_private).toBe(
      'faces, house numbers, number plates, inside a home or garden',
    );
    expect(TRANSLATIONS.en.issueHint_photo_private).not.toMatch(/door/i);
    expect(TRANSLATIONS.el.issueHint_photo_private).not.toMatch(/πόρτα|είσοδ|κατώφλι/i);
    expect(TRANSLATIONS.fr.issueHint_photo_private).not.toMatch(/porte|seuil|entrée/i);
  });

  it('the first line names "This cat needs help" in its own words, in every language', () => {
    expect(TRANSLATIONS.en.issueHurtFirst).toBe(
      'Is a cat hurt or in trouble right now? Use ‘This cat needs help’ instead.',
    );
    for (const lang of LANGS) {
      expect(TRANSLATIONS[lang].issueHurtFirst).toContain(TRANSLATIONS[lang].reportNeedsHelp);
    }
  });
});

describe('the confirm step keeps both halves: "everyone" and "until reviewed" (spec §11)', () => {
  it('English is the approved wording, word for word', () => {
    expect(TRANSLATIONS.en.issueConfirm).toBe(
      'Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it.',
    );
  });

  it('Greek says "from everyone" and "until Syros Cats review it"', () => {
    expect(TRANSLATIONS.el.issueConfirm).toMatch(/από όλους/);
    expect(TRANSLATIONS.el.issueConfirm).toMatch(/μέχρι να την εξετάσουν οι Syros Cats/);
  });

  it('French says "for everyone" and "until Syros Cats have examined it"', () => {
    expect(TRANSLATIONS.fr.issueConfirm).toMatch(/pour tout le monde/);
    expect(TRANSLATIONS.fr.issueConfirm).toMatch(/jusqu’à ce que Syros Cats l’aient examinée/);
  });

  it('the hidden confirmation is only ever about the photo being hidden, and "not hidden yet" says it is not', () => {
    expect(TRANSLATIONS.en.issueDoneNotHidden).toMatch(/not hidden yet/);
    expect(TRANSLATIONS.el.issueDoneNotHidden).toMatch(/δεν έχει κρυφτεί/);
    expect(TRANSLATIONS.fr.issueDoneNotHidden).toMatch(/pas encore masquée/);
    for (const lang of LANGS) {
      // The offline line never mentions hiding (spec §4.2).
      expect(TRANSLATIONS[lang].issueSaved).not.toMatch(/hidden|κρυ|masqu/i);
    }
  });
});
