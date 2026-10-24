import { describe, expect, it } from 'vitest';
import type { Sighting } from '@workspace/api-client-react';
import { TRANSLATIONS } from '@/lib/i18n';
import { homeActionFor, seenQuietLine, visiblePhotoCount } from '@/lib/catPageFacts';

const t = (k: string) => TRANSLATIONS.en[k] ?? k;
const line = (n?: number, s?: number, f?: number) =>
  seenQuietLine(t, { sightingsCount: n, spottersCount: s, followersCount: f });

describe('seenQuietLine (the Seen row\'s quiet second line)', () => {
  it('many sightings, many spotters, with fans', () =>
    expect(line(14, 6, 9)).toBe('Spotted 14 times by 6 spotters · 9 fans'));
  it('one spotter, no fans', () => expect(line(14, 1, 0)).toBe('Spotted 14 times by 1 spotter'));
  it('once, one fan', () => expect(line(1, 1, 1)).toBe('Spotted once · 1 fan'));
  it('no spotters left (data deleted)', () => expect(line(5, 0, 2)).toBe('Spotted 5 times · 2 fans'));
  it('never spotted, no fans: nothing', () => expect(line(0, 0, 0)).toBeNull());
  it('never spotted but has fans: just the fans', () => expect(line(0, 0, 3)).toBe('3 fans'));
  it('an older server (no new fields) says only how many times, never a fans phrase', () =>
    expect(line(14, undefined, undefined)).toBe('Spotted 14 times'));
  it('nothing known at all: nothing', () => expect(line()).toBeNull());
});

describe('visiblePhotoCount', () => {
  const base = { catId: 7, spotterCode: 'AB12', spotterUsername: null, spotterNickname: null, createdAt: '2026-09-01' };
  it('counts covers and extras that people can see, not hidden or removed', () => {
    const sightings = [
      { ...base, photoUrl: '/p/1', extraPhotos: [{ role: 'face', photoUrl: '/p/2' }, { role: 'ears', photoUrl: '/p/3' }] },
      { ...base, photoUrl: '/p/4', photoHidden: true },
      { ...base, photoUrl: '/p/5', photoRemoved: true },
    ] as unknown as Sighting[];
    expect(visiblePhotoCount(sightings)).toBe(3);
  });
  it('a sighting with no photo at all counts nothing', () =>
    expect(visiblePhotoCount([{ ...base, photoUrl: null }] as unknown as Sighting[])).toBe(0));
});

describe('homeActionFor (the 🏠 card)', () => {
  const street = { isOwner: false, canClaim: false, claimCooldown: false, lifeStatus: 'street', hasHome: false } as const;
  it('the owner gets no card', () => expect(homeActionFor({ ...street, isOwner: true, hasHome: true })).toBeNull());
  it('a cat in care or one that has died gets no card', () => {
    expect(homeActionFor({ ...street, lifeStatus: 'in_care' })).toBeNull();
    expect(homeActionFor({ ...street, lifeStatus: 'deceased' })).toBeNull();
  });
  it('a phone in the cooldown gets no card', () =>
    expect(homeActionFor({ ...street, claimCooldown: true })).toBeNull());
  it('a phone that may claim opens the claim sheet', () =>
    expect(homeActionFor({ ...street, canClaim: true })).toBe('claim'));
  it('a homed cat, for anyone but the owner, asks in homed mode', () =>
    expect(homeActionFor({ ...street, lifeStatus: 'homed', hasHome: true })).toBe('askHomed'));
  it('a street cat this phone cannot claim yet asks in street mode', () =>
    expect(homeActionFor(street)).toBe('askStreet'));
});
