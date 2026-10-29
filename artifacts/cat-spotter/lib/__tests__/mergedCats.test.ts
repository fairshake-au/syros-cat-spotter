/**
 * SYC-59 PR 4.3 (which-cat-is-which.md §4.2, D4, D10): the app's side of two
 * records of the same cat becoming one.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, type AppNotification } from '@workspace/api-client-react';
import { TRANSLATIONS, type Language } from '../i18n';
import { bellTap, mergeLineText, mergedIntoNote, mergedSurvivorId } from '../mergedCats';

const LANGS: Language[] = ['en', 'el', 'fr'];
const tIn = (lang: Language) => (k: string) => TRANSLATIONS[lang][k] ?? k;

const KEYS = ['mergedIntoRecord', 'mergedLine', 'duplicatePointsLine', 'mergedRefused'];

function row(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1,
    catId: null,
    catUpdateId: null,
    catName: null,
    catPhotoUrl: null,
    updateType: 'general',
    message: 'Mimi and Agatha turned out to be the same cat. You now follow Agatha.',
    place: null,
    weekPoints: null,
    kind: 'merged',
    survivorCatId: 12,
    survivorCatName: 'Agatha',
    mergedCatName: 'Mimi',
    read: false,
    createdAt: '2026-10-27T10:00:00.000Z',
    ...over,
  };
}

describe('the words, in every language', () => {
  it('every new line exists in English, Greek and French, with the same placeholders', () => {
    for (const key of KEYS) {
      const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
      const en = TRANSLATIONS.en[key];
      expect(en, `en ${key}`).toBeTruthy();
      for (const lang of LANGS) {
        const text = TRANSLATIONS[lang][key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        expect(placeholders(text!), `${lang} ${key}`).toBe(placeholders(en!));
      }
    }
  });

  it('the cat page note is the spec words in English', () => {
    expect(mergedIntoNote(tIn('en'), { id: 3, name: 'Mimi' }, 'Agatha')).toBe(
      'Mimi is now part of Agatha’s record',
    );
  });

  it('the note names both cats in Greek and French, and no placeholder is left', () => {
    for (const lang of ['el', 'fr'] as const) {
      const text = mergedIntoNote(tIn(lang), { id: 3, name: 'Mimi' }, 'Agatha')!;
      expect(text).toContain('Mimi');
      expect(text).toContain('Agatha');
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it('no note for an ordinary page, or from a server that does not send mergedFrom', () => {
    expect(mergedIntoNote(tIn('en'), undefined, 'Agatha')).toBeNull();
  });

  it('a merged line and a duplicate-points line are worded from the two names, in the spotter\'s language', () => {
    expect(mergeLineText(row(), tIn('en'))).toBe(
      'Mimi and Agatha turned out to be the same cat. You now follow Agatha.',
    );
    expect(mergeLineText(row({ kind: 'duplicate_points' }), tIn('en'))).toBe(
      'You spotted that Mimi and Agatha are the same cat. Syros Cats agreed. +10 points.',
    );
    for (const lang of ['el', 'fr'] as const) {
      for (const kind of ['merged', 'duplicate_points'] as const) {
        const text = mergeLineText(row({ kind }), tIn(lang))!;
        expect(text).toContain('Mimi');
        expect(text).toContain('Agatha');
        expect(text).not.toMatch(/[{}]/);
        expect(text).not.toContain('turned out');
      }
    }
  });

  it('a name holding "$&" or braces is shown as typed', () => {
    expect(mergeLineText(row({ mergedCatName: 'Mi$&mi', survivorCatName: '{to}' }), tIn('en'))).toBe(
      'Mi$&mi and {to} turned out to be the same cat. You now follow {to}.',
    );
  });

  it('anything the app cannot word falls back (null): cat news, a weekly result, an unknown kind, a line from before the names were stored', () => {
    const t = tIn('en');
    expect(mergeLineText(row({ kind: 'cat' }), t)).toBeNull();
    expect(mergeLineText(row({ kind: 'week_result' }), t)).toBeNull();
    expect(mergeLineText(row({ kind: undefined }), t)).toBeNull();
    expect(mergeLineText({ ...row(), kind: 'something_new' as never }, t)).toBeNull();
    expect(mergeLineText(row({ survivorCatName: undefined, mergedCatName: undefined }), t)).toBeNull();
  });
});

describe('where a bell line goes', () => {
  it('a merged line opens the cat that stays, not the Spotters board', () => {
    expect(bellTap(row())).toEqual({ to: 'survivor', catId: 12 });
  });

  it('a duplicate-points line opens the cat that stays too', () => {
    expect(bellTap(row({ kind: 'duplicate_points' }))).toEqual({ to: 'survivor', catId: 12 });
  });

  it('cat news opens that cat, with its update', () => {
    expect(bellTap(row({ kind: 'cat', catId: 4, catUpdateId: 9, survivorCatId: undefined }))).toEqual({
      to: 'cat',
      catId: 4,
      updateId: 9,
    });
  });

  it('a weekly result, and a merge line with no cat to open (written before the columns), still ask for the celebration', () => {
    expect(bellTap(row({ kind: 'week_result', survivorCatId: undefined }))).toEqual({ to: 'weekly' });
    expect(bellTap(row({ kind: undefined, survivorCatId: undefined, survivorCatName: undefined }))).toEqual({ to: 'weekly' });
    expect(bellTap(row({ survivorCatId: null }))).toEqual({ to: 'weekly' });
    // The surviving cat no longer exists (the server found no name): nothing to open.
    expect(bellTap(row({ survivorCatName: null }))).toEqual({ to: 'weekly' });
  });
});

describe('an old build reads the new rows', () => {
  // The bell row as the build before this one declared it: it knows none of
  // kind, survivorCatId, survivorCatName or mergedCatName, and zod drops what
  // it does not know.
  const OldAppNotification = z.object({
    id: z.number(),
    catId: z.number().nullable(),
    catUpdateId: z.number().nullable(),
    catName: z.string().nullable(),
    catPhotoUrl: z.string().nullable(),
    updateType: z.enum(['sighting', 'desexed', 'adopted', 'general']),
    message: z.string(),
    place: z.number().nullish(),
    weekPoints: z.number().nullish(),
    read: z.boolean(),
    createdAt: z.string(),
  });

  it('parses a merged row, keeps its English message and sees no cat (so it shows the line like a weekly result)', () => {
    const parsed = OldAppNotification.parse(row());
    expect(parsed.catId).toBeNull();
    expect(parsed.message).toContain('turned out to be the same cat');
    expect(parsed).not.toHaveProperty('survivorCatId');
  });

  it('parses a cat-news row that now also says kind: "cat"', () => {
    const news = row({ kind: 'cat', catId: 4, catUpdateId: 9, catName: 'Agatha', updateType: 'sighting', message: 'Seen' });
    expect(OldAppNotification.parse(news).catId).toBe(4);
  });

  it('this build reads a row from an older server (no kind at all) as before', () => {
    const { kind: _kind, survivorCatId: _s, survivorCatName: _n, mergedCatName: _m, ...old } = row();
    const asOld = old as AppNotification;
    expect(mergeLineText(asOld, tIn('en'))).toBeNull();
    expect(bellTap(asOld)).toEqual({ to: 'weekly' });
    expect(bellTap({ ...asOld, catId: 4, catUpdateId: 9 })).toEqual({ to: 'cat', catId: 4, updateId: 9 });
  });
});

describe('409 MERGED', () => {
  const err = (status: number, data: unknown) =>
    new ApiError(new Response(null, { status }), data, { method: 'POST', url: '/api/cats/3/name' });

  it('names the cat it is part of now', () => {
    expect(mergedSurvivorId(err(409, { code: 'MERGED', catId: 12 }))).toBe(12);
  });

  it('is nothing else: other 409s, a MERGED with no cat, a network error', () => {
    expect(mergedSurvivorId(err(409, { code: 'NAME_TAKEN' }))).toBeNull();
    expect(mergedSurvivorId(err(409, { code: 'MERGED' }))).toBeNull();
    expect(mergedSurvivorId(err(500, { code: 'MERGED', catId: 12 }))).toBeNull();
    expect(mergedSurvivorId(new TypeError('Network request failed'))).toBeNull();
  });
});
