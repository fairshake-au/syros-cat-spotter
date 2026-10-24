import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRANSLATIONS } from '../i18n';
import { catDisplayName, catListName, catNameInSentence } from '../catDisplayName';

const t = (k: string) => (k === 'noNameYet' ? 'No name yet' : k);

describe('catDisplayName', () => {
  it('says "No name yet" while the name is pending, never the SYR number', () => {
    expect(catDisplayName({ name: 'SYR-0007', namePending: true }, t)).toBe('No name yet');
  });
  it('shows the name otherwise, including from an older server', () => {
    expect(catDisplayName({ name: 'Agatha', namePending: false }, t)).toBe('Agatha');
    expect(catDisplayName({ name: 'Agatha' }, t)).toBe('Agatha');
  });
});

describe('catNameInSentence (ruling R29)', () => {
  it('uses the SYR number for a cat nobody has named, never "No name yet"', () => {
    expect(catNameInSentence({ name: 'SYR-0042', namePending: true })).toBe('SYR-0042');
  });
  it('uses the name otherwise', () => {
    expect(catNameInSentence({ name: 'Agatha', namePending: false })).toBe('Agatha');
    expect(catNameInSentence({ name: 'Agatha' })).toBe('Agatha');
  });
});

describe('catListName', () => {
  it('puts the SYR number beside "No name yet"', () => {
    expect(catListName({ name: 'SYR-0042', namePending: true }, t)).toBe('No name yet \u00b7 SYR-0042');
  });
  it('is the name for a named cat', () => {
    expect(catListName({ name: 'Agatha' }, t)).toBe('Agatha');
  });
});

describe('"No name yet" in Greek', () => {
  it('is spelt the same in the app and on the team pages', () => {
    const team = readFileSync(
      join(__dirname, '..', '..', '..', 'api-server', 'src', 'lib', 'teamPages', 'strings', 'el.ts'),
      'utf8',
    );
    const m = /"cat\.noNameYet": "([^"]+)"/.exec(team);
    expect(m?.[1]).toBe(TRANSLATIONS.el.noNameYet);
    expect(TRANSLATIONS.el.noNameYet).toBe('Χωρίς όνομα ακόμη');
  });
});
