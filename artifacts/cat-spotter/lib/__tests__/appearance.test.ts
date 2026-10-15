/**
 * SYC-2 PR 2.1 (coat-markings-and-health.md §3, §5.2, §9; plan tests T-words
 * and T-no-health-words): the colour and marking words in every language,
 * the display line, and no health words.
 */
import { describe, expect, it } from 'vitest';
import { CatCoatItem, CatMarkingsItem } from '@workspace/api-client-react';
import { COAT_LABEL_KEYS, MARK_LABEL_KEYS, appearanceLabelKeys, appearanceLine } from '../appearance';
import { TRANSLATIONS, type Language } from '../i18n';

const LANGS = Object.keys(TRANSLATIONS) as Language[];
const COATS = Object.values(CatCoatItem);
const MARKS = Object.values(CatMarkingsItem);

/** Exactly what LanguageContext's t() does with a missing key: the key. */
function tFor(lang: Language) {
  return (key: string) => TRANSLATIONS[lang][key] ?? key;
}

/** Every key SYC-2 added: colours, chips, public marks, Slice 4's questions. */
const APPEARANCE_KEYS = Object.keys(TRANSLATIONS.en).filter((k) =>
  /^(coat_|mark_|markShown_|catLooks)/.test(k),
);

describe('T-words: every code has a word in every language', () => {
  it('the eight colours, the eleven chips and the four public marks exist in en, el and fr', () => {
    const expected = [
      ...COATS.map((c) => `coat_${c}`),
      'coat_not_sure',
      ...MARKS.map((m) => `mark_${m}`),
      'markShown_short_tail',
      'markShown_missing_eye',
      'markShown_three_legs',
      'markShown_odd_eyes',
    ];
    expect(expected).toHaveLength(8 + 11 + 4);
    for (const lang of LANGS) {
      for (const key of expected) {
        expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('every code the payload can carry maps to a key that exists in every language', () => {
    // The maps are keyed by the generated enums, so a new code fails the
    // typecheck; this checks the words behind them at run time too.
    // In the vocabulary's order too: the line is drawn in this order.
    expect(Object.keys(COAT_LABEL_KEYS)).toEqual([...COATS]);
    expect(Object.keys(MARK_LABEL_KEYS)).toEqual([...MARKS]);
    for (const lang of LANGS) {
      for (const key of [...Object.values(COAT_LABEL_KEYS), ...Object.values(MARK_LABEL_KEYS)]) {
        expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('the public shows "One eye" for missing_eye, and the chip word for the other three (spec §5.2)', () => {
    expect(appearanceLine({ markings: ['missing_eye'] }, tFor('en'))).toBe('One eye');
    expect(appearanceLine({ markings: ['three_legs'] }, tFor('en'))).toBe('Three legs');
    expect(appearanceLine({ markings: ['short_tail'] }, tFor('en'))).toBe('Short or missing tail');
    expect(appearanceLine({ markings: ['odd_eyes'] }, tFor('en'))).toBe('Eyes of different colours');
  });

  it('nothing renders a raw code, in any language', () => {
    for (const lang of LANGS) {
      for (const code of COATS) {
        const line = appearanceLine({ coat: [code] }, tFor(lang))!;
        expect(line, `${lang}: ${code}`).not.toBe(code);
        expect(line, `${lang}: ${code}`).not.toMatch(/_|coat_|mark/);
      }
      for (const code of MARKS) {
        const line = appearanceLine({ markings: [code] }, tFor(lang))!;
        expect(line, `${lang}: ${code}`).not.toBe(code);
        expect(line, `${lang}: ${code}`).not.toMatch(/_|coat_|mark/);
      }
    }
  });

  it('an unknown code (a newer server) is left out, not shown raw', () => {
    const cat = { coat: ['ginger', 'lilac'], markings: ['white_paws', 'spotty_nose'] } as never;
    expect(appearanceLine(cat, tFor('en'))).toBe('Ginger · White paws');
  });
});

describe('the display line (Decision E1)', () => {
  it('colours first, then marks, each in the spec order, joined with " · "', () => {
    const cat = { coat: ['tabby', 'ginger'], markings: ['missing_eye', 'white_paws'] } as const;
    expect(appearanceLine({ coat: [...cat.coat], markings: [...cat.markings] }, tFor('en'))).toBe(
      'Ginger · Tabby · White paws · One eye',
    );
    expect(appearanceLine({ coat: [...cat.coat], markings: [...cat.markings] }, tFor('el'))).toBe(
      'Πορτοκαλί · Τιγρέ · Λευκά πόδια · Ένα μάτι',
    );
    expect(appearanceLine({ coat: [...cat.coat], markings: [...cat.markings] }, tFor('fr'))).toBe(
      'Roux · Tigré · Pattes blanches · Un seul œil',
    );
  });

  it('one colour and no marks is just the colour', () => {
    expect(appearanceLine({ coat: ['black'], markings: [] }, tFor('en'))).toBe('Black');
  });

  it('marks with no colour show the marks', () => {
    expect(appearanceLine({ coat: [], markings: ['kinked_tail'] }, tFor('en'))).toBe('Kinked tail');
  });

  it('nothing known shows nothing', () => {
    expect(appearanceLine({ coat: [], markings: [] }, tFor('en'))).toBeNull();
    expect(appearanceLabelKeys({ coat: [], markings: [] })).toEqual([]);
  });

  it('a cat without the fields (an older server or cache) shows nothing', () => {
    expect(appearanceLine({}, tFor('en'))).toBeNull();
  });

  it('a code repeated is shown once', () => {
    expect(appearanceLine({ coat: ['grey', 'grey'], markings: ['long_fur', 'long_fur'] }, tFor('en'))).toBe(
      'Grey · Long fur',
    );
  });
});

/** Accents off, lower case, so "Υγιής" and "υγιης" match alike. */
function plain(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Spec §9: public copy never says healthy, sick, diseased or unvaccinated. */
const HEALTH_WORDS: RegExp[] = [
  /healthy/,
  /\bsick/,
  /diseas/,
  /unvaccinated/,
  /υγι/,
  /αρρωστ/,
  /ασθεν/,
  /ανεμβολιαστ/,
  /bonne sante/,
  /\bsain(e)?\b/,
  /malade/,
  /non[\s-]vaccine/,
];

describe('T-no-health-words: the appearance words say nothing about health', () => {
  it('the patterns catch the words in every language', () => {
    for (const s of ['Healthy', 'sick', 'Diseased', 'unvaccinated', 'Υγιής', 'άρρωστη', 'ασθένεια', 'ανεμβολίαστη', 'en bonne santé', 'malade', 'non vacciné']) {
      expect(HEALTH_WORDS.some((re) => re.test(plain(s))), s).toBe(true);
    }
  });

  it('no appearance string, in any language, uses one', () => {
    expect(APPEARANCE_KEYS.length).toBe(8 + 11 + 4 + 11);
    for (const lang of LANGS) {
      for (const key of APPEARANCE_KEYS) {
        const value = plain(TRANSLATIONS[lang][key]!);
        expect(HEALTH_WORDS.filter((re) => re.test(value)).map(String), `${lang}.${key}`).toEqual([]);
      }
    }
  });

  it('the questions name the cat, never a pronoun (spec §9)', () => {
    for (const key of APPEARANCE_KEYS.filter((k) => k.startsWith('catLooks'))) {
      expect(TRANSLATIONS.en[key], key).not.toMatch(/\b(he|she|her|him|his|hers)\b/i);
    }
  });
});
