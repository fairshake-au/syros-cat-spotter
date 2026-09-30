/**
 * buildReviewParams (spec §3.4, review F7/F12): the review route carries
 * short names only, never a photograph, and building it never throws.
 */
import { describe, expect, it } from 'vitest';
import type { MatchCandidate } from '@workspace/api-client-react';
import {
  REASONING_MAX_LENGTH,
  buildReviewParams,
  parseReviewParams,
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
