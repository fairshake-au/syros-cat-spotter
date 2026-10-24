import React, { useState } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { SafetyStep } from './SafetyStep';
import { NameStep } from './NameStep';
import { RestoreRequestScreen } from '@/components/keepSafe/RestoreRequestScreen';
import { useDevice } from '@/context/DeviceContext';
import type { OnboardingStep } from './steps';

/**
 * First-run flow (SYC-524): Welcome (with the language switch, SYC-155) →
 * Keep your distance (SYC-35) → Name. The order lives in ./steps. The
 * keep-your-distance screen has no Skip, so the safety guidance is never
 * passed unseen. Back from the name step returns to it. Onboarding no longer asks for location.
 *
 * There is no separate "onboarding complete" flag. Claiming a username, or,
 * offline, holding one on the phone (SYC-506), is the durable end of the flow
 * (it persists to AsyncStorage via DeviceContext and is what the root gate
 * checks), so the intermediate step is plain local state.
 * A cold start mid-flow simply begins again at Welcome, which costs a few taps.
 *
 * SYC-3: Welcome's "Already a spotter? Get your spots back" opens the restore
 * request (not a numbered step). SYC-524: "Don't lose your spots" is part of
 * the name screen (an offline start skips it and is offered it later).
 */
export function OnboardingFlow() {
  const { deviceId } = useDevice();
  const [step, setStep] = useState<OnboardingStep | 'restore'>('welcome');

  switch (step) {
    case 'welcome':
      return <WelcomeStep onNext={() => setStep('safety')} onRestore={() => setStep('restore')} />;
    case 'restore':
      return <RestoreRequestScreen onBack={() => setStep('welcome')} />;
    case 'safety':
      return <SafetyStep onNext={() => setStep('name')} />;
    case 'name':
      // SYC-524: a new identity (a restore link, "Delete my data") gets a
      // fresh name screen; the old one ignores its own late answers.
      return <NameStep key={deviceId ?? ''} onBack={() => setStep('safety')} />;
  }
}
