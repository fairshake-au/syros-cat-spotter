/**
 * SYC-143: a stat tile label that doesn't fit its tile first loses its
 * letter-spacing, then shrinks, down to a floor. Only a label that still
 * doesn't fit at the floor may break inside a word.
 */
import { describe, expect, it } from 'vitest';
import { LABEL_FIT_STEPS, pickLabelFitStep } from './labelFit';

describe('LABEL_FIT_STEPS', () => {
  it('starts at the design size and spacing, and never grows', () => {
    expect(LABEL_FIT_STEPS[0]).toEqual({ fontSize: 12, letterSpacing: 12 * 0.12 });
    for (let i = 1; i < LABEL_FIT_STEPS.length; i++) {
      expect(LABEL_FIT_STEPS[i]!.fontSize).toBeLessThanOrEqual(LABEL_FIT_STEPS[i - 1]!.fontSize);
      expect(LABEL_FIT_STEPS[i]!.letterSpacing).toBeLessThanOrEqual(
        LABEL_FIT_STEPS[i - 1]!.letterSpacing,
      );
    }
  });

  it('drops the letter-spacing before it drops the size', () => {
    const firstSmaller = LABEL_FIT_STEPS.findIndex((s) => s.fontSize < 12);
    expect(LABEL_FIT_STEPS[firstSmaller - 1]!.letterSpacing).toBe(0);
  });

  it('never goes below 9px', () => {
    expect(Math.min(...LABEL_FIT_STEPS.map((s) => s.fontSize))).toBe(9);
  });
});

describe('pickLabelFitStep', () => {
  it('keeps the design size when it fits', () => {
    expect(pickLabelFitStep(() => true)).toBe(0);
  });

  it('picks the first step that fits', () => {
    const idx = pickLabelFitStep((s) => s.fontSize <= 10);
    expect(LABEL_FIT_STEPS[idx]!.fontSize).toBe(10);
    expect(LABEL_FIT_STEPS[idx - 1]!.fontSize).toBeGreaterThan(10);
  });

  it('returns the last step when nothing fits', () => {
    expect(pickLabelFitStep(() => false)).toBe(LABEL_FIT_STEPS.length - 1);
  });
});
