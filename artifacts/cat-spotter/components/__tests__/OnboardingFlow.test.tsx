// @vitest-environment jsdom
/**
 * SYC-35: onboarding is Welcome → How it works → Keep your distance →
 * Language & username. The safety screen can't be skipped silently: Skip on
 * "How it works" (which only skips the location prompt) lands on it, and it
 * has no Skip of its own. Back from Language & username returns to it.
 *
 * Welcome and Language & username are stubbed (they pull in the API client
 * and device storage); "How it works" and the safety screen are real, so
 * their progress dots are checked as rendered.
 */
import React from 'react';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '@/lib/i18n';

const en = TRANSLATIONS.en;

vi.mock('@/context/LanguageContext', async () => {
  const { TRANSLATIONS: T } = await import('@/lib/i18n');
  return { useLanguage: () => ({ language: 'en', t: (key: string) => T.en[key] ?? key }) };
});

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#000',
    mutedForeground: '#666',
    card: '#fff',
    border: '#ddd',
    primary: '#123',
    primaryForeground: '#fff',
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const { requestPermission } = vi.hoisted(() => ({
  requestPermission: vi.fn(() => Promise.resolve({ status: 'granted' })),
}));
vi.mock('expo-location', () => ({ requestForegroundPermissionsAsync: requestPermission }));

vi.mock('@/components/purropolis', async () => {
  const { Text } = await import('react-native');
  return {
    Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Text role="button" onPress={onPress}>
        {children}
      </Text>
    ),
  };
});

vi.mock('../onboarding/WelcomeStep', async () => {
  const { Text } = await import('react-native');
  return {
    WelcomeStep: ({ onNext }: { onNext: () => void }) => (
      <Text onPress={onNext}>STUB_WELCOME</Text>
    ),
  };
});

vi.mock('../onboarding/LanguageUsernameStep', async () => {
  const { Text } = await import('react-native');
  return {
    LanguageUsernameStep: ({ onBack }: { onBack: () => void }) => (
      <Text onPress={onBack}>STUB_LANGUAGE_BACK</Text>
    ),
  };
});

import { OnboardingFlow } from '../onboarding/OnboardingFlow';
import { ONBOARDING_STEPS, ONBOARDING_DOT_COUNT, stepIndex } from '../onboarding/steps';

/** Reads the rendered progress dots: how many, and which one is the wide pill. */
function dots(container: HTMLElement) {
  const row = container.querySelector('[data-testid="step-dots"]');
  if (!row) return null;
  const pips = Array.from(row.children) as HTMLElement[];
  return { total: pips.length, active: pips.findIndex((p) => p.style.width === '22px') };
}

afterEach(() => {
  cleanup();
  requestPermission.mockClear();
});

describe('onboarding step order (SYC-35)', () => {
  it('lists the safety screen straight after How it works and before Language & username', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'how', 'safety', 'language']);
    expect(ONBOARDING_DOT_COUNT).toBe(4);
    expect(stepIndex('safety')).toBe(stepIndex('how') + 1);
    expect(stepIndex('language')).toBe(stepIndex('safety') + 1);
  });

  it('walks Welcome → How it works → safety → Language & username, with matching dots', async () => {
    const { getByText, queryByText, container } = render(<OnboardingFlow />);

    fireEvent.click(getByText('STUB_WELCOME'));
    expect(getByText(en.howTitle)).toBeTruthy();
    // Screen 2 is back to how it was: no safety box on it.
    expect(queryByText(en.howSafetyTitle)).toBeNull();
    expect(dots(container)).toEqual({ total: 4, active: 1 });

    fireEvent.click(getByText(en.howAllowContinue));
    await waitFor(() => expect(getByText(en.howSafetyTitle)).toBeTruthy());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(dots(container)).toEqual({ total: 4, active: 2 });

    fireEvent.click(getByText(en.continue));
    expect(getByText('STUB_LANGUAGE_BACK')).toBeTruthy();
    expect(queryByText(en.howSafetyTitle)).toBeNull();
  });

  it('Skip on How it works lands on the safety screen, not past it', () => {
    const { getByText, queryByText, container } = render(<OnboardingFlow />);
    fireEvent.click(getByText('STUB_WELCOME'));

    fireEvent.click(getByText(en.skip));
    expect(getByText(en.howSafetyTitle)).toBeTruthy();
    expect(queryByText('STUB_LANGUAGE_BACK')).toBeNull();
    // Skip still skips only the location prompt, as before.
    expect(requestPermission).not.toHaveBeenCalled();
    // And the safety screen offers no Skip of its own.
    expect(queryByText(en.skip)).toBeNull();
    expect(dots(container)).toEqual({ total: 4, active: 2 });
  });

  it('Back from Language & username returns to the safety screen', () => {
    const { getByText } = render(<OnboardingFlow />);
    fireEvent.click(getByText('STUB_WELCOME'));
    fireEvent.click(getByText(en.skip));
    fireEvent.click(getByText(en.continue));

    fireEvent.click(getByText('STUB_LANGUAGE_BACK'));
    expect(getByText(en.howSafetyTitle)).toBeTruthy();
  });
});
