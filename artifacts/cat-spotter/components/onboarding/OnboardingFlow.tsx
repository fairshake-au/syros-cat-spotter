import React, { useState } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { HowItWorksStep } from './HowItWorksStep';
import { SafetyStep } from './SafetyStep';
import { LanguageUsernameStep } from './LanguageUsernameStep';
import type { OnboardingStep } from './steps';

/**
 * First-run flow: Welcome → How it works (+ location permission) → Keep your
 * distance (SYC-35) → Language & username. The order lives in ./steps.
 *
 * Skip on "How it works" only skips the location prompt: it lands on the
 * keep-your-distance screen, which has no Skip, so the safety guidance is
 * never passed unseen. Back from Language & username returns to it.
 *
 * There is no separate "onboarding complete" flag. Claiming a username is the
 * durable end of the flow (it persists to AsyncStorage via DeviceContext and is
 * what the root gate checks), so the intermediate step is plain local state.
 * A cold start mid-flow simply begins again at Welcome, which costs a few taps.
 */
export function OnboardingFlow() {
  const [step, setStep] = useState<OnboardingStep>('welcome');

  switch (step) {
    case 'welcome':
      return <WelcomeStep onNext={() => setStep('how')} />;
    case 'how':
      return (
        <HowItWorksStep onNext={() => setStep('safety')} onSkip={() => setStep('safety')} />
      );
    case 'safety':
      return <SafetyStep onNext={() => setStep('language')} />;
    case 'language':
      return <LanguageUsernameStep onBack={() => setStep('safety')} />;
  }
}
