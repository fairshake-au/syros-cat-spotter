import { describe, expect, it } from 'vitest';
import type { CareEvent, Cat, Sighting } from '@workspace/api-client-react';
import { mainPhotoCaption, spotterName } from '../photoCaption';

// SYC-44 PR 6.1: the full-screen view of a cat's main photo says when it was
// taken and by whom. The main photo is always some sighting's photo (a new
// cat's main photo is its first sighting's, and a hidden one's stand-in is
// the newest visible sighting's), so the caption comes from that sighting.

const t = (k: string) => k;

const sighting = (over: Partial<Sighting>): Sighting => ({
  catId: 1,
  spotterCode: 'ABCD',
  spotterUsername: null,
  spotterNickname: null,
  photoUrl: null,
  photoHidden: false,
  createdAt: '2026-10-01',
  ...over,
});

const cat = (over: Partial<Cat>) =>
  ({
    photoUrl: '/api/photos/main',
    discovererUsername: null,
    discovererNickname: null,
    discovererSpotterCode: 'DISC',
    ...over,
  }) as Cat;

const discovered: CareEvent[] = [{ type: 'discovered', message: 'Maria', at: '2026-09-02' }];

describe('spotterName', () => {
  it('prefers the username, then the nickname, then the spotter code, then "a spotter"', () => {
    expect(spotterName(sighting({ spotterUsername: 'u', spotterNickname: 'n' }), t)).toBe('u');
    expect(spotterName(sighting({ spotterNickname: 'n' }), t)).toBe('n');
    expect(spotterName(sighting({}), t)).toBe('spotter ABCD');
    expect(spotterName(sighting({ spotterCode: null }), t)).toBe('aSpotter');
  });
});

describe('mainPhotoCaption', () => {
  it('uses the sighting whose cover is the main photo', () => {
    const sightings = [
      sighting({ photoUrl: '/api/photos/other', createdAt: '2026-10-05' }),
      sighting({ photoUrl: '/api/photos/main', createdAt: '2026-10-01', spotterUsername: 'Eleni' }),
    ];
    expect(mainPhotoCaption(cat({}), sightings, discovered, t)).toEqual({ day: '2026-10-01', spotter: 'Eleni' });
  });

  it('or the sighting whose extra photo it is', () => {
    const sightings = [
      sighting({
        photoUrl: '/api/photos/cover',
        createdAt: '2026-10-03',
        spotterNickname: 'Nik',
        extraPhotos: [{ role: 'face', photoUrl: '/api/photos/main' }],
      }),
    ];
    expect(mainPhotoCaption(cat({}), sightings, discovered, t)).toEqual({ day: '2026-10-03', spotter: 'Nik' });
  });

  it('falls back to the discovery: its day and the discoverer', () => {
    expect(mainPhotoCaption(cat({ discovererNickname: 'Maria' }), [], discovered, t)).toEqual({
      day: '2026-09-02',
      spotter: 'Maria',
    });
    expect(mainPhotoCaption(cat({ discovererSpotterCode: null }), [], discovered, t)).toEqual({
      day: '2026-09-02',
      spotter: 'aSpotter',
    });
  });

  it('is null when there is no photo, or nothing says when it was taken', () => {
    expect(mainPhotoCaption(cat({ photoUrl: null }), [], discovered, t)).toBeNull();
    expect(mainPhotoCaption(cat({}), [], undefined, t)).toBeNull();
  });
});
