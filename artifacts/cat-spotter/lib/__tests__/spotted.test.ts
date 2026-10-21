import { describe, expect, it } from 'vitest';
import { NEARBY_KM } from '@workspace/geo';
import {
  catalogueEmptyKey,
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
