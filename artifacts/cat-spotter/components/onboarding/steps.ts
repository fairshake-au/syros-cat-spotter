/**
 * The onboarding screens, in order. The progress dots count every entry
 * (Welcome shows none, but it holds the first dot), so adding a step here
 * updates every screen's dots at once. SYC-3's "Don't lose your spots" is
 * the last step: it shows once a username is claimed, from the root gate
 * (app/_layout.tsx), because claiming the name (or, offline, holding one on
 * the phone, SYC-506) is what moves the app past onboarding.
 */
export const ONBOARDING_STEPS = ['welcome', 'how', 'safety', 'language', 'keepSafe'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_DOT_COUNT = ONBOARDING_STEPS.length;

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}
