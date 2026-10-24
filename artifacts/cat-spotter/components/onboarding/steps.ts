/**
 * The onboarding screens, in order. The progress dots count every entry
 * (Welcome shows none, but it holds the first dot), so adding a step here
 * updates every screen's dots at once. SYC-524 cut it to three: the "How it
 * works" screen is gone, and SYC-3's "Don't lose your spots" is no longer a
 * numbered step (it still shows from the root gate, app/_layout.tsx, once a
 * username is claimed, but without dots).
 */
export const ONBOARDING_STEPS = ['welcome', 'safety', 'name'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_DOT_COUNT = ONBOARDING_STEPS.length;

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}
