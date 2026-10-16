import { describe, expect, it } from 'vitest';
import { shouldOpenPhotoTips } from '../photoTipsSeen';

describe('shouldOpenPhotoTips', () => {
  const base = { seen: false, hasPhoto: false, seenThisSession: false };

  it('opens on a first visit to the camera', () => {
    expect(shouldOpenPhotoTips(base)).toBe(true);
  });
  it('does not open once the phone has seen it', () => {
    expect(shouldOpenPhotoTips({ ...base, seen: true })).toBe(false);
  });
  it('does not open when a photo is already on screen', () => {
    expect(shouldOpenPhotoTips({ ...base, hasPhoto: true })).toBe(false);
  });
  it('does not open when it was dismissed this session, even if the stored mark has not landed yet', () => {
    expect(shouldOpenPhotoTips({ ...base, seenThisSession: true })).toBe(false);
  });
});
