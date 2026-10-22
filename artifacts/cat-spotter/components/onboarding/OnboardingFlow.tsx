import React, { useState } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { HowItWorksStep } from './HowItWorksStep';
import { SafetyStep } from './SafetyStep';
import { LanguageUsernameStep } from './LanguageUsernameStep';
import { RestoreRequestScreen } from '@/components/keepSafe/RestoreRequestScreen';
import type { OnboardingStep } from './steps';

/**
 * First-run flow: Welcome (with the language switch, SYC-155) → How it works
 * (+ location permission) → Keep your distance (SYC-35) → Name. The order
 * lives in ./steps. The name step is still the LanguageUsernameStep component.
 *
 * Skip on "How it works" only skips the location prompt: it lands on the
 * keep-your-distance screen, which has no Skip, so the safety guidance is
 * never passed unseen. Back from the name step returns to it.
 *
 * There is no separate "onboarding complete" flag. Claiming a username, or,
 * offline, holding one on the phone (SYC-506), is the durable end of the flow
 * (it persists to AsyncStorage via DeviceContext and is what the root gate
 * checks), so the intermediate step is plain local state.
 * A cold start mid-flow simply begins again at Welcome, which costs a few taps.
 *
 * SYC-3: Welcome's "Already a spotter? Get your spots back" opens the restore
 * request (not a numbered step). The last step, "Don't lose your spots",
 * shows from the root gate once the name is claimed (an offline start skips it
 * and is offered it later).
 */
export function OnboardingFlow() {
  const [step, setStep] = useState<OnboardingStep | 'restore'>('welcome');

  switch (step) {
    case 'welcome':
      return <WelcomeStep onNext={() => setStep('how')} onRestore={() => setStep('restore')} />;
    case 'restore':
      return <RestoreRequestScreen onBack={() => setStep('welcome')} />;
    case 'keepSafe':
      return null;
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
