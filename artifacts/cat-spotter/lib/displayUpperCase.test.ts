/**
 * SYC-143: Greek written in capitals drops its accents ("ΔΙΑΚΡΙΣΕΙΣ", not
 * "ΔΙΑΚΡΊΣΕΙΣ"). Plain `toUpperCase()` keeps them, which reads as a mistake
 * to Greek readers. French capitals keep theirs ("DÉCOUVERTES").
 */
import { describe, expect, it } from 'vitest';
import { displayUpperCase } from './displayUpperCase';

describe('displayUpperCase', () => {
  it('drops the accent from Greek capitals (the Home stat tile labels)', () => {
    expect(displayUpperCase('Είδες')).toBe('ΕΙΔΕΣ');
    expect(displayUpperCase('Πρώτες ανακαλύψεις')).toBe('ΠΡΩΤΕΣ ΑΝΑΚΑΛΥΨΕΙΣ');
    expect(displayUpperCase('Διακρίσεις')).toBe('ΔΙΑΚΡΙΣΕΙΣ');
  });

  it('keeps a diaeresis, and adds one where the dropped accent split a vowel pair', () => {
    // "Τσάι" is two syllables; without the accent "ΤΣΑΙ" would read as one.
    expect(displayUpperCase('τσάι')).toBe('ΤΣΑΪ');
    expect(displayUpperCase('κοροϊδεύω')).toBe('ΚΟΡΟΪΔΕΥΩ');
    expect(displayUpperCase('Προϊόν')).toBe('ΠΡΟΪΟΝ');
    // A normal diphthong with the accent on its second letter stays plain.
    expect(displayUpperCase('είναι')).toBe('ΕΙΝΑΙ');
  });

  it('keeps the accent on the standalone word "ή" ("or")', () => {
    expect(displayUpperCase('γάτα ή σκύλος')).toBe('ΓΑΤΑ Ή ΣΚΥΛΟΣ');
  });

  it('leaves French and English accents alone', () => {
    expect(displayUpperCase('Repérés')).toBe('REPÉRÉS');
    expect(displayUpperCase('Découvertes')).toBe('DÉCOUVERTES');
    expect(displayUpperCase('First finds')).toBe('FIRST FINDS');
  });

  it('returns precomposed characters', () => {
    expect(displayUpperCase('Repérés')).toBe('REPÉRÉS'.normalize('NFC'));
    expect(displayUpperCase('τσάι').length).toBe(4);
  });
});
