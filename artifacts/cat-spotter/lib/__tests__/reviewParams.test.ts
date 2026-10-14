/**
 * buildReviewParams (spec §3.4, review F7/F12): the review route carries
 * short names only, never a photograph, and building it never throws.
 */
import { describe, expect, it } from 'vitest';
import type { MatchCandidate } from '@workspace/api-client-react';
import {
  REASONING_MAX_LENGTH,
  ROUTE_POSITION_DECIMALS,
  buildReviewParams,
  parseReviewParams,
  roundForRoute,
} from '../reviewParams';

const bigPhoto = `data:image/jpeg;base64,${'A'.repeat(6_000_000)}`;
const barePhoto = 'A'.repeat(6_000_000);

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    catId: 3,
    name: 'Mitsos',
    photoUrl: '/api/photos/12',
    confidence: 0.8,
    reasoning: 'Same torn left ear and white socks.',
    ...overrides,
  };
}

describe('buildReviewParams', () => {
  it('carries the sighting, its candidates, and a short photo reference', () => {
    const params = buildReviewParams({
      sightingId: 42,
      isCatPhoto: true,
      candidates: [candidate()],
      photoRef: 'idb:review-42',
    });
    expect(parseReviewParams(params.data)).toEqual({
      sightingId: 42,
      isCatPhoto: true,
      candidates: [candidate()],
      localId: undefined,
      photoRef: 'idb:review-42',
    });
  });

  it('F7: never puts a data URL in the route, whatever it is handed', () => {
    const params = buildReviewParams({
      sightingId: 1,
      isCatPhoto: true,
      localId: bigPhoto,
      photoRef: bigPhoto,
      candidates: [
        candidate({ photoUrl: bigPhoto, name: 'data:,', reasoning: bigPhoto }),
      ],
    });
    expect(params.data).not.toMatch(/data:/i);
    expect(params.data.length).toBeLessThan(1_000);
  });

  it.each([
    ['a zero-width space', '​data:,'],
    ['a word joiner', '⁠data:,'],
    ['a quote mark', '"data:,'],
    ['a byte-order mark', '﻿data:,'],
    ['upper case after spaces', '  DATA:,'],
  ])('F7: drops a short data URL behind %s', (_label, value) => {
    const params = buildReviewParams({
      sightingId: 1,
      isCatPhoto: true,
      photoRef: value,
      candidates: [candidate({ name: value, photoUrl: value, reasoning: value })],
    });
    const parsed = parseReviewParams(params.data)!;
    expect(parsed.photoRef).toBeUndefined();
    expect(parsed.candidates[0]).toMatchObject({ name: '', photoUrl: '', reasoning: '' });
  });

  it('SYC-98 Fable review nit 8: keeps a null photoUrl as null, not \'\'', () => {
    // A candidate cat with no real photo yet carries photoUrl: null (same as
    // every other nullable photoUrl in the API). Coercing it to '' used to
    // make photoSource('') request the bare API origin instead of rendering
    // nothing, once null became a real value photoUrl could take.
    const params = buildReviewParams({
      sightingId: 1,
      isCatPhoto: true,
      candidates: [candidate({ photoUrl: null })],
    });
    expect(parseReviewParams(params.data)!.candidates[0].photoUrl).toBeNull();
  });

  it('keeps ordinary text that merely mentions data:, since only data URLs are dropped', () => {
    const reasoning = 'Same markings as the data: torn left ear, white socks.';
    const params = buildReviewParams({
      sightingId: 1,
      isCatPhoto: true,
      candidates: [candidate({ reasoning })],
    });
    expect(parseReviewParams(params.data)!.candidates[0].reasoning).toBe(reasoning);
  });

  it('drops photo-sized values even without a data-URL prefix', () => {
    const params = buildReviewParams({
      sightingId: 1,
      isCatPhoto: true,
      photoRef: barePhoto,
      candidates: [candidate({ name: barePhoto, photoUrl: barePhoto })],
    });
    expect(params.data.length).toBeLessThan(1_000);
    expect(parseReviewParams(params.data)?.photoRef).toBeUndefined();
  });

  it('trims each candidate’s reasoning, which is unbounded model text', () => {
    const params = buildReviewParams({
      sightingId: 1,
      isCatPhoto: true,
      candidates: [candidate({ reasoning: 'x'.repeat(50_000) })],
    });
    const [c] = parseReviewParams(params.data)!.candidates;
    expect(c.reasoning.length).toBe(REASONING_MAX_LENGTH);
  });

  it('never throws, even on nonsense — the sighting already exists and must stay reviewable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const inputs = [
      { sightingId: 5, candidates: null },
      { sightingId: 5, candidates: [null, 'x', circular] as unknown as MatchCandidate[] },
      { sightingId: 5, candidates: 'not a list' as unknown as MatchCandidate[] },
      {
        sightingId: 5,
        candidates: [
          {
            ...candidate(),
            get reasoning(): string {
              throw new Error('boom');
            },
          },
        ],
      },
    ];
    for (const input of inputs) {
      const params = buildReviewParams(input);
      expect(parseReviewParams(params.data)?.sightingId).toBe(5);
    }
  });
});

describe('parseReviewParams', () => {
  it('rejects a missing or malformed route', () => {
    expect(parseReviewParams(undefined)).toBeNull();
    expect(parseReviewParams('{')).toBeNull();
    expect(parseReviewParams('{"isCatPhoto":true}')).toBeNull();
  });
});

describe('the sighting\'s saved location (SYC-119, plan P7)', () => {
  it('carries lat and lng so the picker can measure "nearby" from where the photo was taken', () => {
    const params = buildReviewParams({
      sightingId: 9,
      isCatPhoto: true,
      candidates: [],
      photoRef: 'idb:review-9',
      lat: 37.4448,
      lng: 24.9425,
    });
    const parsed = parseReviewParams(params.data);
    expect(parsed?.lat).toBe(37.4448);
    expect(parsed?.lng).toBe(24.9425);
    expect(params.data.length).toBeLessThan(200);
  });

  it.each([
    ['not numbers', '37.4', '24.9'],
    ['not finite', Number.NaN, Number.POSITIVE_INFINITY],
    ['out of range', 91, 24.9],
    ['only one of the two', 37.4, undefined],
  ])('drops a location that is %s', (_label, lat, lng) => {
    const params = buildReviewParams({
      sightingId: 9,
      isCatPhoto: true,
      candidates: [],
      lat: lat as unknown as number,
      lng: lng as unknown as number,
    });
    const parsed = parseReviewParams(params.data);
    expect(parsed?.lat).toBeUndefined();
    expect(parsed?.lng).toBeUndefined();
  });

  it('ignores a crafted location in the route that is not a pair of numbers', () => {
    expect(
      parseReviewParams('{"sightingId":1,"lat":"37","lng":24}')?.lat,
    ).toBeUndefined();
  });
});

describe('the route carries a rounded position only (SYC-258)', () => {
  // A photo's (or a pin's) exact position, to the metre.
  const PRECISE = { lat: 37.4412345, lng: 24.9412345 };
  const build = (lat: unknown, lng: unknown) =>
    buildReviewParams({
      sightingId: 9,
      isCatPhoto: true,
      candidates: [],
      lat: lat as number,
      lng: lng as number,
    });

  it('rounds the position to three decimals in the serialised route', () => {
    const params = build(PRECISE.lat, PRECISE.lng);
    expect(ROUTE_POSITION_DECIMALS).toBe(3);
    expect(params.data).not.toContain('37.4412345');
    expect(params.data).not.toMatch(/\d\.\d{4,}/);
    const parsed = parseReviewParams(params.data);
    expect(parsed?.lat).toBe(37.441);
    expect(parsed?.lng).toBe(24.941);
  });

  it("a pin equal to a photo's position does not leak it", () => {
    const params = build(PRECISE.lat, PRECISE.lng);
    // Whole string, not the lat key, so a new key name cannot slip past.
    expect(params.data).not.toMatch(/37\.44123|24\.94123/);
    expect(params.data).not.toMatch(/\d\.\d{4,}/);
  });

  it('rounding is stable (rounding the parsed value again changes nothing)', () => {
    const once = parseReviewParams(build(PRECISE.lat, PRECISE.lng).data);
    expect(roundForRoute(once!.lat!)).toBe(once!.lat);
    expect(roundForRoute(once!.lng!)).toBe(once!.lng);
    const twice = parseReviewParams(build(once!.lat, once!.lng).data);
    expect(twice).toEqual(once);
  });

  it('parseReviewParams rounds an exact position from an old address', () => {
    const parsed = parseReviewParams(
      '{"sightingId":1,"lat":37.4412345,"lng":24.9412345}',
    );
    expect(parsed?.lat).toBe(37.441);
    expect(parsed?.lng).toBe(24.941);
  });

  it('rounding never moves a point more than 80 m', () => {
    // The island rectangle from lib/offlineTiles.ts (not exported there).
    const ISLAND = { minLat: 37.36, maxLat: 37.53, minLon: 24.85, maxLon: 25.01 };
    let seed = 258;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const metres = (a: [number, number], b: [number, number]) => {
      const R = 6371008.8;
      const rad = (d: number) => (d * Math.PI) / 180;
      const dLat = rad(b[0] - a[0]);
      const dLng = rad(b[1] - a[1]);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    for (let i = 0; i < 500; i += 1) {
      const lat = ISLAND.minLat + rand() * (ISLAND.maxLat - ISLAND.minLat);
      const lng = ISLAND.minLon + rand() * (ISLAND.maxLon - ISLAND.minLon);
      const parsed = parseReviewParams(build(lat, lng).data);
      expect(parsed?.lat).toBeDefined();
      expect(metres([lat, lng], [parsed!.lat!, parsed!.lng!])).toBeLessThan(80);
    }
  });

  it.each([
    ['not numbers', '37.4', '24.9'],
    ['not finite', Number.NaN, Number.POSITIVE_INFINITY],
    ['out of range', 91, 24.9],
    ['out of range longitude', 37.4, 181],
    ['only one of the two', 37.4, undefined],
  ])('still drops a location that is %s', (_label, lat, lng) => {
    const params = build(lat, lng);
    expect(params.data).not.toMatch(/"lat"|"lng"/);
  });

  it('negative and zero coordinates round without "-0"', () => {
    const params = build(-0.0004, -0.0004);
    expect(params.data).toContain('"lat":0');
    expect(params.data).toContain('"lng":0');
    expect(params.data).not.toContain('-0');
    const parsed = parseReviewParams(params.data);
    expect(Object.is(parsed?.lat, 0)).toBe(true);
    expect(Object.is(parsed?.lng, 0)).toBe(true);
    const old = parseReviewParams('{"sightingId":1,"lat":-0.0004,"lng":-0}');
    expect(Object.is(old?.lat, 0)).toBe(true);
    expect(Object.is(old?.lng, 0)).toBe(true);
    expect(build(-33.8688, -70.1239).data).toContain('"lat":-33.869');
  });
});
