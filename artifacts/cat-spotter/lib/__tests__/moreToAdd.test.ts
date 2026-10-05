import { describe, expect, it } from 'vitest';
import { addLaterRequest, earTipAnswerLabel, moreToAddHeadline } from '../moreToAdd';
import { NO_ANSWERS } from '../sightingAnswers';
import { TRANSLATIONS } from '../i18n';

const t = (key: string) => TRANSLATIONS.en[key] ?? key;
const DEVICE = 'device-1';

describe('addLaterRequest', () => {
  it('sends nothing when nothing was answered', () => {
    expect(addLaterRequest(DEVICE, NO_ANSWERS, { state: 'open' })).toBeNull();
  });

  it('a first ear-tip answer is sent plainly', () => {
    expect(
      addLaterRequest(DEVICE, { ...NO_ANSWERS, earTip: 'clipped', earSide: 'left' }, { state: 'open' }),
    ).toEqual({ deviceId: DEVICE, earTip: 'clipped_left' });
  });

  it('a new ear-tip answer after an earlier one is sent as a change', () => {
    expect(
      addLaterRequest(
        DEVICE,
        { ...NO_ANSWERS, earTip: 'looks_whole' },
        { state: 'answered', current: 'clipped_left' },
      ),
    ).toEqual({ deviceId: DEVICE, earTip: 'looks_whole', changeEarTip: true });
  });

  it('never asks to change an answer Syros Cats have checked', () => {
    const body = addLaterRequest(
      DEVICE,
      { ...NO_ANSWERS, earTip: 'clipped', foodAndWater: 'yes' },
      { state: 'checked' },
    );
    expect(body).toEqual({ deviceId: DEVICE, foodAndWater: 'yes' });
  });

  it('other answers go without the change flag', () => {
    expect(
      addLaterRequest(
        DEVICE,
        { ...NO_ANSWERS, note: 'limping' },
        { state: 'answered', current: 'cant_tell' },
      ),
    ).toEqual({ deviceId: DEVICE, note: 'limping' });
  });
});

describe('earTipAnswerLabel', () => {
  it.each([
    ['clipped_left', 'Yes, clipped · Left'],
    ['clipped_right', 'Yes, clipped · Right'],
    ['clipped_unsure', 'Yes, clipped'],
    ['looks_whole', 'No, looks whole'],
    ['cant_tell', 'Can’t tell'],
  ] as const)('%s reads as "%s"', (answer, label) => {
    expect(earTipAnswerLabel(answer, t)).toBe(label);
  });
});

describe('moreToAddHeadline', () => {
  it('names the date for one sighting', () => {
    const line = moreToAddHeadline('Agatha', ['2026-10-03T10:00:00.000Z'], t, (d) => d.toISOString().slice(0, 10));
    expect(line).toBe('You spotted Agatha on 2026-10-03.');
  });

  it('counts several', () => {
    const line = moreToAddHeadline(
      'Agatha',
      ['2026-10-03T10:00:00.000Z', '2026-09-20T10:00:00.000Z'],
      t,
      (d) => d.toISOString(),
    );
    expect(line).toBe('You spotted Agatha 2 times in the last month.');
  });
});
