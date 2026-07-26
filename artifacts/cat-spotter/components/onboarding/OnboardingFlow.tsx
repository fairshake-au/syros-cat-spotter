import React, { useState } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { HowItWorksStep } from './HowItWorksStep';
import { LanguageUsernameStep } from './LanguageUsernameStep';

/**
 * First-run flow: Welcome → How it works (+ location permission) → Language &
 * username.
 *
 * There is no separate "onboarding complete" flag. Claiming a username is the
 * durable end of the flow (it persists to AsyncStorage via DeviceContext and is
 * what the root gate checks), so the intermediate step is plain local state.
 * A cold start mid-flow simply begins again at Welcome, which costs two taps.
 */
export function OnboardingFlow() {
  const [step, setStep] = useState(0);

  if (step === 0) return <WelcomeStep onNext={() => setStep(1)} />;
  if (step === 1) {
    return (
      <HowItWorksStep onNext={() => setStep(2)} onSkip={() => setStep(2)} />
    );
  }
  return <LanguageUsernameStep onBack={() => setStep(1)} />;
}
