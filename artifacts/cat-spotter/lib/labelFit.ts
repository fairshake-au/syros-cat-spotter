/**
 * SYC-143: how a stat tile label steps down when it doesn't fit.
 *
 * The design size is 12px uppercase with 0.12em letter-spacing. Greek
 * words are longer than the English ones ("ΑΝΑΚΑΛΥΨΕΙΣ", "ΔΙΑΚΡΙΣΕΙΣ"), and
 * three tiles across a phone leave about 80px for the label, so the longest
 * word can be wider than its tile. Rather than break inside that word, the
 * label first loses its letter-spacing, then shrinks half a pixel at a
 * time, down to a 9px floor. Only a word that still doesn't fit at 9px may
 * break (better than being cut off).
 */

import { fontSizes, tracking } from '@/constants/theme';

export interface LabelFitStep {
  fontSize: number;
  letterSpacing: number;
}

const DESIGN_SIZE = fontSizes['2xs'];
const DESIGN_TRACKING = tracking.wider;
const MIN_SIZE = 9;

export const LABEL_FIT_STEPS: readonly LabelFitStep[] = (() => {
  const steps: LabelFitStep[] = [
    { fontSize: DESIGN_SIZE, letterSpacing: DESIGN_SIZE * DESIGN_TRACKING },
    { fontSize: DESIGN_SIZE, letterSpacing: (DESIGN_SIZE * DESIGN_TRACKING) / 2 },
    { fontSize: DESIGN_SIZE, letterSpacing: 0 },
  ];
  for (let size = DESIGN_SIZE - 0.5; size >= MIN_SIZE; size -= 0.5) {
    steps.push({ fontSize: size, letterSpacing: 0 });
  }
  return steps;
})();

/**
 * Index of the first step at which `fits` says the label fits; the last
 * step if none does.
 */
export function pickLabelFitStep(fits: (step: LabelFitStep) => boolean): number {
  for (let i = 0; i < LABEL_FIT_STEPS.length; i++) {
    if (fits(LABEL_FIT_STEPS[i]!)) return i;
  }
  return LABEL_FIT_STEPS.length - 1;
}
