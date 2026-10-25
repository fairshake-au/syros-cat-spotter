import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from './i18n';
import { spokenText } from './a11yText';

describe('SYC-509: spokenText drops emoji for screen readers', () => {
  it('removes trailing and leading emoji', () => {
    expect(spokenText('Have we met? 🐾')).toBe('Have we met?');
    expect(spokenText('A new furriend! 🎉')).toBe('A new furriend!');
    expect(spokenText('🔥 3-day streak')).toBe('3-day streak');
    expect(spokenText('Cat-alogue 🐱')).toBe('Cat-alogue');
  });

  it('keeps French spacing before ? and ! intact only where text remains', () => {
    expect(spokenText('On se connaît ? 🐾')).toBe('On se connaît?');
    expect(spokenText('Personnalise 🐾')).toBe('Personnalise');
  });

  it('leaves text without emoji alone, including Greek', () => {
    expect(spokenText('Έχουμε ξανασυναντηθεί;')).toBe('Έχουμε ξανασυναντηθεί;');
    expect(spokenText('Spotter 7A2C')).toBe('Spotter 7A2C');
  });

  it('strips every emoji in the translated titles it is used on', () => {
    for (const dict of Object.values(TRANSLATIONS)) {
      for (const key of ['catalogTitle', 'haveWeMetTitle', 'aNewFurriend', 'makeItYours', 'addToCatalogButton', 'captureHintPicker', 'welcomeSubtitle', 'notificationsTitle']) {
        expect(spokenText(dict[key])).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });
});
