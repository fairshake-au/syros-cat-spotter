// @vitest-environment jsdom
/**
 * SYC-524: onboarding is Welcome → Keep your distance (SYC-35) → Name. The
 * "How it works" screen and its location prompt are gone, so onboarding never
 * touches expo-location. The safety screen has no Skip. Back from the name
 * step returns to it.
 *
 * Welcome and the name step are stubbed (they pull in the API client and
 * device storage); the safety screen is real, so its progress dots are
 * checked as rendered.
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
      <Text onPress={onBack}>STUB_NAME_BACK</Text>
    ),
  };
});

// SYC-3: Welcome's "Already a spotter? Get your spots back" screen.
vi.mock('../keepSafe/RestoreRequestScreen', async () => {
  const { Text } = await import('react-native');
  return {
    RestoreRequestScreen: ({ onBack }: { onBack: () => void }) => (
      <Text onPress={onBack}>STUB_RESTORE_REQUEST</Text>
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

describe('onboarding step order (SYC-524)', () => {
  it('is three steps: welcome, safety, name', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'safety', 'name']);
    expect(ONBOARDING_DOT_COUNT).toBe(3);
    expect(stepIndex('name')).toBe(stepIndex('safety') + 1);
  });

  it('walks Welcome → safety → name, with matching dots and no location prompt', () => {
    const { getByText, queryByText, container } = render(<OnboardingFlow />);

    fireEvent.click(getByText('STUB_WELCOME'));
    expect(getByText(en.howSafetyTitle)).toBeTruthy();
    expect(dots(container)).toEqual({ total: 3, active: 1 });
    // The safety screen offers no Skip of its own.
    expect(queryByText(en.skip)).toBeNull();

    fireEvent.click(getByText(en.continue));
    expect(getByText('STUB_NAME_BACK')).toBeTruthy();
    expect(queryByText(en.howSafetyTitle)).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('Back from the name step returns to the safety screen', () => {
    const { getByText } = render(<OnboardingFlow />);
    fireEvent.click(getByText('STUB_WELCOME'));
    fireEvent.click(getByText(en.continue));

    fireEvent.click(getByText('STUB_NAME_BACK'));
    expect(getByText(en.howSafetyTitle)).toBeTruthy();
  });
});
