import { describe, expect, it } from 'vitest';
import { areaLabel, areaSearchText, cardPlace, GREEK_AREA_NAMES } from './areaNames';
import { TRANSLATIONS } from './i18n';

// SYC-810: the area on a cat, as the app shows it.

// The 21 keys in artifacts/api-server/src/lib/areas/seedAreas.ts.
const SEED_KEYS = [
  'ermoupoli', 'vaporia', 'kini', 'galissas', 'finikas', 'posidonia', 'azolimnos',
  'ano-syros', 'vari', 'fabrika', 'manna', 'mega-gialos', 'chroussa', 'kampos',
  'chalandriani', 'syringas', 'aetos', 'lia', 'grammata', 'pagos', 'episkopio',
];

const t = (key: string): string => TRANSLATIONS.en[key] ?? key;
const KINI = { areaKey: 'kini', areaName: 'Kini', lat: 37.4436, lng: 24.8889 };

describe('areaLabel', () => {
  it('kini in Greek shows the Greek name', () => {
    expect(areaLabel(KINI, 'el')).toBe('Κίνι');
  });

  it('shows the server name in English and French', () => {
    expect(areaLabel(KINI, 'en')).toBe('Kini');
    expect(areaLabel(KINI, 'fr')).toBe('Kini');
  });

  it("a key not on the list falls back to the server's name", () => {
    expect(areaLabel({ areaKey: 'new-place', areaName: 'New Place' }, 'el')).toBe('New Place');
  });

  it('has no label without an area', () => {
    expect(areaLabel({ areaKey: null, areaName: null }, 'el')).toBeNull();
    expect(areaLabel({}, 'en')).toBeNull();
  });
});

describe('cardPlace', () => {
  it('an area is shown as the area', () => {
    expect(cardPlace(KINI, 'en', t)).toEqual({ kind: 'area', text: 'Kini' });
    expect(cardPlace(KINI, 'el', t)).toEqual({ kind: 'area', text: 'Κίνι' });
  });

  it("no area on the island is 'island'", () => {
    const cat = { areaKey: null, areaName: null, lat: 37.5, lng: 24.99 };
    expect(cardPlace(cat, 'en', t)).toEqual({ kind: 'island', text: 'Somewhere on Syros' });
  });

  it("no area off the island is 'none'", () => {
    const cat = { areaKey: null, areaName: null, lat: 34.6123, lng: 21.1189 };
    expect(cardPlace(cat, 'en', t)).toEqual({ kind: 'none', text: null });
  });

  it("a cat with no areaName field is 'none'", () => {
    const cat = { lat: 37.4436, lng: 24.8889 };
    expect(cardPlace(cat, 'en', t)).toEqual({ kind: 'none', text: null });
  });
});

describe('areaSearchText', () => {
  it('holds the shown name and the server name', () => {
    expect(areaSearchText(KINI, 'el')).toBe('Κίνι Kini');
    expect(areaSearchText(KINI, 'en')).toBe('Kini');
  });

  it('is empty for a cat with no area', () => {
    expect(areaSearchText({}, 'en')).toBe('');
  });
});

describe('the Greek list', () => {
  it('covers all 21 seed keys', () => {
    expect(Object.keys(GREEK_AREA_NAMES).sort()).toEqual([...SEED_KEYS].sort());
  });
});

describe('the new strings', () => {
  it('exist in en, el and fr', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const key of ['catAreaSomewhere', 'filterNoHome', 'filterNoHomeEmpty']) {
        expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
    expect(TRANSLATIONS.en.catAreaSomewhere).toBe('Somewhere on Syros');
    expect(TRANSLATIONS.en.filterNoHome).toBe('No home');
    expect(TRANSLATIONS.en.filterNoHomeEmpty).toBe('No cats without a home here.');
  });
});
