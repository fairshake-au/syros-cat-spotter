import { describe, expect, it } from 'vitest';
import { NEARBY_KM } from '@workspace/geo';
import {
  catalogueEmptyKey,
  catalogueMatches,
  effectiveFilter,
  homeHeroState,
  stripHeadingKey,
} from '../spotted';

describe('homeHeroState', () => {
  it('is unknown without a profile', () => {
    expect(homeHeroState(undefined)).toBe('unknown');
  });
  it('is unknown when the list is missing, even with a zero count', () => {
    expect(homeHeroState({ catsSpotted: 0 })).toBe('unknown');
  });
  it('is firstSpot for an empty list', () => {
    expect(homeHeroState({ catsSpotted: 0, spottedCatIds: [] })).toBe('firstSpot');
  });
  it('is progress once cats are spotted', () => {
    expect(homeHeroState({ catsSpotted: 2, spottedCatIds: [1, 2] })).toBe('progress');
  });
  it('is progress for an empty list with the count missing', () => {
    expect(homeHeroState({ spottedCatIds: [] })).toBe('progress');
  });
});

describe('stripHeadingKey', () => {
  it('says to collect when there are no coordinates', () => {
    expect(stripHeadingKey(false, [{ distanceKm: 0.1 }])).toBe('homeToCollectEyebrow');
  });
  it('says nearby at exactly NEARBY_KM', () => {
    expect(stripHeadingKey(true, [{ distanceKm: NEARBY_KM }])).toBe('homeNearbyEyebrow');
  });
  it('says to collect when none are near or distances are null', () => {
    expect(
      stripHeadingKey(true, [{ distanceKm: NEARBY_KM + 0.01 }, { distanceKm: null }]),
    ).toBe('homeToCollectEyebrow');
  });
  it('says to collect for an empty list', () => {
    expect(stripHeadingKey(true, [])).toBe('homeToCollectEyebrow');
  });
});

describe('effectiveFilter', () => {
  it('falls back to all for notSpotted without collection data', () => {
    expect(effectiveFilter('notSpotted', false)).toBe('all');
  });
  it('keeps notSpotted with collection data', () => {
    expect(effectiveFilter('notSpotted', true)).toBe('notSpotted');
  });
  it('leaves other filters alone', () => {
    expect(effectiveFilter('homed', false)).toBe('homed');
  });
});

describe('catalogueEmptyKey', () => {
  const base = { hasCoords: true, catCount: 5, search: '' };
  it('asks for location first', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'nearby', hasCoords: false })).toBe(
      'filterNeedsLocation',
    );
  });
  it('says noCats when there are no cats at all', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'notSpotted', catCount: 0 })).toBe('noCats');
  });
  it('says all done for notSpotted with no search', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'notSpotted' })).toBe('filterNotSpottedAllDone');
  });
  it('treats a whitespace-only search as no search', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'notSpotted', search: '   ' })).toBe(
      'filterNotSpottedAllDone',
    );
  });
  it('says noCatsSearch when a search is typed under notSpotted', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'notSpotted', search: 'zzz' })).toBe(
      'noCatsSearch',
    );
  });
  it('says noCatsSearch under all', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'all', search: 'zzz' })).toBe('noCatsSearch');
  });
});

describe('SYC-810: the No home filter', () => {
  const base = { hasCoords: true, catCount: 5, search: '' };

  it('noHome with nothing left and no search says filterNoHomeEmpty', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'noHome' })).toBe('filterNoHomeEmpty');
  });
  it('noHome with a whitespace-only search still says filterNoHomeEmpty', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'noHome', search: '  ' })).toBe('filterNoHomeEmpty');
  });
  it('noHome with a search keeps noCatsSearch', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'noHome', search: 'zzz' })).toBe('noCatsSearch');
  });
  it('noHome with no cats at all says noCats', () => {
    expect(catalogueEmptyKey({ ...base, filter: 'noHome', catCount: 0 })).toBe('noCats');
  });
  it('is not changed by effectiveFilter', () => {
    expect(effectiveFilter('noHome', false)).toBe('noHome');
  });
});

describe('SYC-810: catalogueMatches', () => {
  const spottedIds = new Set<number>();
  const kini = { id: 1, name: 'Agatha', description: '', areaKey: 'kini', areaName: 'Kini', hasHome: false };
  const kiniHomed = { ...kini, id: 2, name: 'Basil', hasHome: true };
  const old = { id: 3, name: 'Cleo', description: '' };
  const args = (over: Partial<Parameters<typeof catalogueMatches>[1]> = {}) => ({
    query: '',
    filter: 'all' as const,
    spottedIds,
    language: 'en' as const,
    ...over,
  });

  it('"Kini" and "Κίνι" both find a Kini cat in Greek', () => {
    expect(catalogueMatches(kini, args({ query: 'kini', language: 'el' }))).toBe(true);
    expect(catalogueMatches(kini, args({ query: 'κίνι', language: 'el' }))).toBe(true);
  });
  it('"Kini" finds a Kini cat in English, and not another area', () => {
    expect(catalogueMatches(kini, args({ query: 'kini' }))).toBe(true);
    expect(catalogueMatches({ ...kini, areaKey: 'vari', areaName: 'Vari' }, args({ query: 'kini' }))).toBe(false);
  });
  it('a cat with no area field is not found by an area search', () => {
    expect(catalogueMatches(old, args({ query: 'kini' }))).toBe(false);
  });
  it('still finds by name and id', () => {
    expect(catalogueMatches(kini, args({ query: 'agat' }))).toBe(true);
    expect(catalogueMatches(kini, args({ query: '1' }))).toBe(true);
  });
  it('a cached cat with no hasHome field is left out of No home', () => {
    expect(catalogueMatches(old, args({ filter: 'noHome' }))).toBe(false);
  });
  it('a cat with no home is in No home; a homed cat is not', () => {
    expect(catalogueMatches(kini, args({ filter: 'noHome' }))).toBe(true);
    expect(catalogueMatches(kiniHomed, args({ filter: 'noHome' }))).toBe(false);
  });
  it('a search typed without accents still finds the cat', () => {
    const greek = { language: 'el' as const };
    expect(catalogueMatches(kini, args({ ...greek, query: 'κινι' }))).toBe(true);
    expect(catalogueMatches(kini, args({ ...greek, query: 'κίνι' }))).toBe(true);
    expect(catalogueMatches({ ...kini, name: 'Zoë' }, args({ query: 'zoe' }))).toBe(true);
    expect(catalogueMatches(kini, args({ ...greek, query: 'βαρη' }))).toBe(false);
  });
  it('a cat in care or a cat who has died is not in No home', () => {
    for (const lifeStatus of ['in_care', 'deceased'] as const) {
      expect(catalogueMatches({ ...kini, lifeStatus }, args({ filter: 'noHome' }))).toBe(false);
    }
    expect(catalogueMatches({ ...kini, lifeStatus: 'street' as const }, args({ filter: 'noHome' }))).toBe(true);
  });
  it('"Kini" plus No home leaves out homed cats', () => {
    const a = args({ query: 'kini', filter: 'noHome' });
    expect([kini, kiniHomed, old].filter((c) => catalogueMatches(c, a)).map((c) => c.id)).toEqual([1]);
  });
  it('Has a home still shows only homed cats', () => {
    expect(catalogueMatches(kiniHomed, args({ filter: 'homed' }))).toBe(true);
    expect(catalogueMatches(kini, args({ filter: 'homed' }))).toBe(false);
  });
});
