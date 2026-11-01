import { describe, expect, it } from 'vitest';
import { TRANSLATIONS, type Language } from '../i18n';
import { dateWord, weekdayWord } from '../newsDay';
import { newsLineText } from '../newsLine';

// SYC-221 PR 3 (news-in-your-language.md §3.2-3.4, tests 5-7): the bell words
// cat news itself. The expected strings below are the same ones
// artifacts/api-server/src/lib/newsWords.test.ts pins for the push body, so the
// app and the server cannot drift apart. Days are fixed YYYY-MM-DD strings (no
// wall clock). 2026-10-27 is a Tuesday; 2026-11-01 is a Sunday and a first.

const NB = ' '; // French no-break space before ":"
const NN = ' '; // French narrow no-break space before "!"

const tFor = (lang: Language) => (key: string) => TRANSLATIONS[lang][key] ?? key;
const line = (lang: Language, n: Parameters<typeof newsLineText>[0]) => newsLineText(n, tFor(lang), lang);

const base = { catName: 'Mimi' };

describe('newsLineText: each kind in each language', () => {
  const cases: Array<[string, Parameters<typeof newsLineText>[0], Record<Language, string>]> = [
    ['sterilised', { ...base, wording: 'sterilised', wordingDay: null }, {
      en: 'Mimi has been sterilised!',
      el: 'Η γάτα Mimi στειρώθηκε!',
      fr: `Mimi${NB}: stérilisation faite${NN}!`,
    }],
    ['spotted_again', { ...base, wording: 'spotted_again', wordingDay: null }, {
      en: 'Mimi was spotted again!',
      el: 'Η γάτα Mimi εντοπίστηκε ξανά!',
      fr: `Mimi${NB}: vu à nouveau${NN}!`,
    }],
    ['seen_weekday', { ...base, wording: 'seen_weekday', wordingDay: '2026-10-27' }, {
      en: 'Mimi was seen on Tuesday',
      el: 'Η γάτα Mimi εντοπίστηκε την Τρίτη',
      fr: `Mimi${NB}: vu mardi`,
    }],
    ['seen_date', { ...base, wording: 'seen_date', wordingDay: '2026-10-03' }, {
      en: 'Mimi was seen on 3 October',
      el: 'Η γάτα Mimi εντοπίστηκε στις 3 Οκτωβρίου',
      fr: `Mimi${NB}: vu le 3 octobre`,
    }],
    ['new_cat', { ...base, wording: 'new_cat', wordingDay: null }, {
      en: 'Mimi was just discovered on Syros!',
      el: 'Νέα γάτα στη Σύρο: Mimi!',
      fr: `Nouveau chat à Syros${NB}: Mimi${NN}!`,
    }],
  ];
  for (const [kind, n, expected] of cases) {
    for (const lang of ['en', 'el', 'fr'] as const) {
      it(`${kind} in ${lang}`, () => {
        expect(line(lang, n)).toBe(expected[lang]);
      });
    }
  }

  it('uses the cat name as it is now (a merged cat shows the survivor)', () => {
    expect(line('en', { catName: 'Agatha', wording: 'spotted_again', wordingDay: null })).toBe('Agatha was spotted again!');
  });

  it('keeps a name with "$&" as typed', () => {
    expect(line('en', { catName: 'A$&B', wording: 'new_cat', wordingDay: null })).toBe('A$&B was just discovered on Syros!');
  });
});

describe('newsLineText: no wording means the stored message', () => {
  it('returns null for staff text, old rows, unknown kinds and missing parts', () => {
    expect(line('en', { ...base, wording: null, wordingDay: null })).toBeNull();
    expect(line('en', { ...base })).toBeNull();
    expect(line('fr', { ...base, wording: 'something_new' as never, wordingDay: null })).toBeNull();
    expect(line('en', { catName: null, wording: 'sterilised', wordingDay: null })).toBeNull();
    expect(line('en', { ...base, wording: 'seen_weekday', wordingDay: null })).toBeNull();
    expect(line('el', { ...base, wording: 'seen_date', wordingDay: null })).toBeNull();
  });
});

describe('day words (fixed lists, no clock, no Intl)', () => {
  it('names every weekday in Greek with the accusative article', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    expect(days.map((d) => weekdayWord(d, 'el'))).toEqual([
      'την Κυριακή', 'τη Δευτέρα', 'την Τρίτη', 'την Τετάρτη', 'την Πέμπτη', 'την Παρασκευή', 'το Σάββατο',
    ]);
    expect(days.map((d) => weekdayWord(d, 'fr'))).toEqual(['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']);
    expect(weekdayWord('2026-11-01', 'en')).toBe('Sunday');
  });

  it('writes the 1st as 1er in French only, with Greek genitive months', () => {
    expect(dateWord('2026-11-01', 'fr')).toBe('1er novembre');
    expect(dateWord('2026-11-01', 'en')).toBe('1 November');
    expect(dateWord('2026-11-01', 'el')).toBe('1 Νοεμβρίου');
    expect(dateWord('2026-12-31', 'el')).toBe('31 Δεκεμβρίου');
    expect(dateWord('2026-02-02', 'fr')).toBe('2 février');
  });

  it('is the same on the last day of a year and a leap day', () => {
    expect(weekdayWord('2028-02-29', 'en')).toBe('Tuesday');
    expect(weekdayWord('2026-12-31', 'fr')).toBe('jeudi');
  });
});
