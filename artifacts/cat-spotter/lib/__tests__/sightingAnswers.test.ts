import { describe, expect, it } from 'vitest';
import { ApiError } from '@workspace/api-client-react';
import {
  answersRequest,
  classifyAnswersError,
  NO_ANSWERS,
  NOTE_MAX_LENGTH,
} from '../sightingAnswers';

const DEVICE = 'device-1';

describe('answersRequest', () => {
  it('sends nothing when every question was skipped', () => {
    expect(answersRequest(DEVICE, NO_ANSWERS)).toBeNull();
  });

  it('treats a blank note as skipped', () => {
    expect(answersRequest(DEVICE, { ...NO_ANSWERS, note: '   \n ' })).toBeNull();
  });

  it.each([
    ['left', 'clipped_left'],
    ['right', 'clipped_right'],
    ['unsure', 'clipped_unsure'],
    [null, 'clipped_unsure'],
  ] as const)('sends a clipped tip seen on ear %s as %s', (earSide, earTip) => {
    expect(
      answersRequest(DEVICE, { ...NO_ANSWERS, earTip: 'clipped', earSide }),
    ).toEqual({ deviceId: DEVICE, earTip });
  });

  it.each(['looks_whole', 'cant_tell'] as const)('sends "%s" as it is', (earTip) => {
    expect(answersRequest(DEVICE, { ...NO_ANSWERS, earTip })).toEqual({
      deviceId: DEVICE,
      earTip,
    });
  });

  it('ignores a leftover ear side when the answer is not "clipped"', () => {
    expect(
      answersRequest(DEVICE, { ...NO_ANSWERS, earTip: 'looks_whole', earSide: 'left' }),
    ).toEqual({ deviceId: DEVICE, earTip: 'looks_whole' });
  });

  it('sends food and water and a trimmed note together', () => {
    expect(
      answersRequest(DEVICE, {
        ...NO_ANSWERS,
        foodAndWater: 'no',
        note: '  limping on back left  ',
      }),
    ).toEqual({ deviceId: DEVICE, foodAndWater: 'no', note: 'limping on back left' });
  });

  it('never sends a note longer than the server accepts', () => {
    const body = answersRequest(DEVICE, { ...NO_ANSWERS, note: 'x'.repeat(600) });
    expect(body!.note).toHaveLength(NOTE_MAX_LENGTH);
  });
});

describe('answersRequest and "Are these the same cat?" (SYC-59 PR 5.2)', () => {
  it.each(['same', 'different', 'not_sure'] as const)('sends "%s" on its own', (duplicate) => {
    expect(answersRequest(DEVICE, { ...NO_ANSWERS, duplicate })).toEqual({ deviceId: DEVICE, duplicate });
  });

  it('sends it with the other answers', () => {
    expect(answersRequest(DEVICE, { ...NO_ANSWERS, foodAndWater: 'yes', duplicate: 'same' })).toEqual({
      deviceId: DEVICE,
      foodAndWater: 'yes',
      duplicate: 'same',
    });
  });

  it('leaves it out when it was not answered', () => {
    expect(answersRequest(DEVICE, { ...NO_ANSWERS, foodAndWater: 'yes' })).toEqual({ deviceId: DEVICE, foodAndWater: 'yes' });
  });
});

describe('classifyAnswersError', () => {
  function apiError(status: number, data: unknown) {
    return new ApiError(new Response(JSON.stringify(data), { status }), data, {
      method: 'POST',
      url: '/api/sightings/1/answers',
    });
  }

  it('no answer from the server (no signal) offers a retry', () => {
    expect(classifyAnswersError(new TypeError('Failed to fetch'))).toBe('retry');
  });

  it('a server error offers a retry', () => {
    expect(classifyAnswersError(apiError(500, { error: 'x' }))).toBe('retry');
  });

  it('ALREADY_ANSWERED means the answers are already in: carry on', () => {
    expect(
      classifyAnswersError(apiError(409, { error: 'x', code: 'ALREADY_ANSWERED' })),
    ).toBe('done');
  });

  it.each([
    [422, 'ANSWERS_CLOSED'],
    [422, 'NO_DUPLICATE_QUESTION'],
    [409, 'NOT_RESOLVED'],
    [400, undefined],
  ])('a %s %s cannot be fixed by retrying', (status, code) => {
    expect(classifyAnswersError(apiError(status, { error: 'x', code }))).toBe('closed');
  });
});
