/**
 * The onboarding screens, in order. The progress dots count every entry
 * (Welcome shows none, but it holds the first dot), so adding a step here
 * updates every screen's dots at once. SYC-3 adds its "Don't lose your spots"
 * step at the end of this list.
 */
export const ONBOARDING_STEPS = ['welcome', 'how', 'safety', 'language'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_DOT_COUNT = ONBOARDING_STEPS.length;

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}
