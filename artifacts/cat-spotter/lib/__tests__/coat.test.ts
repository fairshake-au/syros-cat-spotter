/**
 * SYC-398 PR A2 (coat-colours-and-pattern.md §2, §5, §6; plan Task A2.2):
 * the app reads the coat's two new fields, translates an old cached `coat`
 * for display only, and never filters on it.
 */
import { describe, expect, it } from 'vitest';
import { CatCoatColoursItem, CatCoatPattern } from '@workspace/api-client-react';
import { COLOURS, PATTERNS, coatLineKeys, displayParts, filterParts } from '../coat';
import { TRANSLATIONS, type Language } from '../i18n';

const LANGS = Object.keys(TRANSLATIONS) as Language[];

describe('the vocabulary matches the generated client', () => {
  it('the five colours and three patterns, in the spec order (§2)', () => {
    expect([...COLOURS]).toEqual(Object.values(CatCoatColoursItem));
    expect([...PATTERNS]).toEqual(Object.values(CatCoatPattern));
  });
});

describe('coatLineKeys: the new fields', () => {
  it('Brown and Ginger with Stripes give coat_brown, coat_ginger, pattern_stripes', () => {
    expect(coatLineKeys({ coat: ['ginger', 'tabby'], coatColours: ['brown', 'ginger'], coatPattern: 'stripes' })).toEqual([
      'coat_brown',
      'coat_ginger',
      'pattern_stripes',
    ]);
  });

  it('Plain gives no pattern word (the photo shows it)', () => {
    expect(coatLineKeys({ coatColours: ['black'], coatPattern: 'plain' })).toEqual(['coat_black']);
  });

  it('colours in the spec order, whatever order they arrive in', () => {
    expect(coatLineKeys({ coatColours: ['white', 'ginger', 'black'], coatPattern: 'patches' })).toEqual([
      'coat_black',
      'coat_ginger',
      'coat_white',
      'pattern_patches',
    ]);
  });

  it('the new fields win over the old one, even when both are there', () => {
    expect(coatLineKeys({ coat: ['tabby'], coatColours: ['brown'], coatPattern: 'stripes' })).toEqual([
      'coat_brown',
      'pattern_stripes',
    ]);
  });

  it('nothing known shows nothing; a pattern alone shows the pattern', () => {
    expect(coatLineKeys({ coat: [], coatColours: [], coatPattern: null })).toEqual([]);
    expect(coatLineKeys({ coat: ['tabby'], coatColours: [], coatPattern: 'stripes' })).toEqual(['pattern_stripes']);
  });

  it('an unknown code (a newer server) is left out, not shown raw', () => {
    expect(coatLineKeys({ coatColours: ['lilac', 'grey'] as never, coatPattern: 'spots' as never })).toEqual(['coat_grey']);
  });
});

describe('displayParts: an old cached cat, translated by the same table as the server (§6)', () => {
  it('old cached displays coat_ginger, pattern_stripes for ["ginger","tabby"]', () => {
    expect(coatLineKeys({ coat: ['ginger', 'tabby'] })).toEqual(['coat_ginger', 'pattern_stripes']);
  });

  it('old cached ["tabby","white"] displays only pattern_stripes (the tabby\'s own colour was never said)', () => {
    expect(coatLineKeys({ coat: ['tabby', 'white'] })).toEqual(['pattern_stripes']);
  });

  it('the rest of the table', () => {
    expect(displayParts({ coat: ['tabby'] })).toEqual({ colours: null, pattern: 'stripes' });
    expect(displayParts({ coat: ['black_and_white'] })).toEqual({ colours: ['black', 'white'], pattern: null });
    expect(displayParts({ coat: ['tortoiseshell_or_calico'] })).toEqual({ colours: ['black', 'ginger'], pattern: 'patches' });
    expect(displayParts({ coat: ['grey', 'white'] })).toEqual({ colours: ['grey', 'white'], pattern: null });
    // black_and_white still says both, beside a tabby.
    expect(displayParts({ coat: ['black_and_white', 'tabby'] })).toEqual({ colours: ['black', 'white'], pattern: 'stripes' });
    // Both striped and patchy is Patches (§2), in either order, as the server.
    expect(displayParts({ coat: ['tabby', 'tortoiseshell_or_calico'] }).pattern).toBe('patches');
    expect(displayParts({ coat: ['tortoiseshell_or_calico', 'tabby'] }).pattern).toBe('patches');
    expect(displayParts({ coat: [] })).toEqual({ colours: null, pattern: null });
    expect(displayParts({})).toEqual({ colours: null, pattern: null });
  });

  it('no old word is ever a key: every old code, alone and in pairs', () => {
    const OLD = ['black', 'white', 'ginger', 'grey', 'tabby', 'tortoiseshell_or_calico', 'black_and_white'] as const;
    const sets: string[][] = [...OLD.map((a) => [a]), ...OLD.flatMap((a, i) => OLD.slice(i + 1).map((b) => [a, b]))];
    for (const coat of sets) {
      for (const key of coatLineKeys({ coat: coat as never })) {
        expect(key, coat.join('+')).toMatch(/^(coat_(black|grey|brown|ginger|white)|pattern_(stripes|patches))$/);
      }
    }
  });
});

describe('filterParts: the old field never decides a filter', () => {
  it('filterParts of an old cached cat is null and null', () => {
    expect(filterParts({ coat: ['ginger', 'tabby'] })).toEqual({ colours: null, pattern: null });
    expect(filterParts({ coat: ['black'] })).toEqual({ colours: null, pattern: null });
  });

  it('the new fields, values only', () => {
    expect(filterParts({ coat: ['ginger', 'tabby'], coatColours: ['brown', 'ginger'], coatPattern: 'stripes' })).toEqual({
      colours: ['brown', 'ginger'],
      pattern: 'stripes',
    });
    expect(filterParts({ coat: [], coatColours: [], coatPattern: null })).toEqual({ colours: null, pattern: null });
  });
});

describe('every key exists in all three languages', () => {
  it('coat_* for the five colours and pattern_* for the three patterns', () => {
    const keys = [...COLOURS.map((c) => `coat_${c}`), ...PATTERNS.map((p) => `pattern_${p}`)];
    for (const lang of LANGS) {
      for (const key of keys) expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeTruthy();
    }
  });

  it('the old words are gone from every language', () => {
    for (const lang of LANGS) {
      for (const key of ['coat_tabby', 'coat_tortoiseshell_or_calico', 'coat_black_and_white']) {
        expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeUndefined();
      }
    }
  });
});
