import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLanguageTags, pickLanguage } from './deviceLanguage';

describe('pickLanguage (SYC-155)', () => {
  it.each([
    [['el-GR'], 'el'],
    [['el'], 'el'],
    [['el-CY'], 'el'],
    [['fr-FR'], 'fr'],
    [['fr-BE'], 'fr'],
    [['FR-ch'], 'fr'],
    [['fr_CA'], 'fr'],
    [['en-AU'], 'en'],
    [['de-DE', 'fr-FR', 'en'], 'fr'],
    [['de-DE', 'it-IT'], 'en'],
    [[], 'en'],
    [['  el-gr '], 'el'],
  ] as const)('%j -> %s', (tags, expected) => {
    expect(pickLanguage(tags)).toBe(expected);
  });

  it('does not take a Greek region on another language for Greek', () => {
    expect(pickLanguage(['en-GR'])).toBe('en');
    expect(pickLanguage(['gr'])).toBe('en');
  });
});

describe('deviceLanguageTags', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser's whole list, in order", () => {
    vi.stubGlobal('navigator', { languages: ['de-DE', 'fr-FR'], language: 'de-DE' });
    expect(deviceLanguageTags()).toEqual(['de-DE', 'fr-FR']);
  });

  it('falls back to navigator.language, then Intl', () => {
    vi.stubGlobal('navigator', { languages: [], language: 'el-GR' });
    expect(deviceLanguageTags()).toEqual(['el-GR']);
    vi.stubGlobal('navigator', undefined);
    expect(deviceLanguageTags()).toEqual([Intl.DateTimeFormat().resolvedOptions().locale]);
  });
});
