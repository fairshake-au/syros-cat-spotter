import { describe, expect, it } from 'vitest';
import { answersRequest, NO_ANSWERS, NOTE_MAX_LENGTH } from '../sightingAnswers';

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
