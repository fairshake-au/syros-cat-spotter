// @vitest-environment jsdom
/**
 * SYC-136 review follow-up: if DeviceProvider's one-time id/secret setup
 * effect threw (e.g. no secure random source at all), the rejection had
 * no .catch, isReady never became true, and app/_layout.tsx's
 * OnboardingGate rendered `null` forever — a silent, permanent blank
 * screen that the top-level ErrorBoundary does *not* catch (it's a
 * rejected promise inside a useEffect, not a render error).
 *
 * This exercises the real fix end to end: DeviceProvider catches the
 * failure and exposes `startupError`; the `Gate` component below mirrors
 * OnboardingGate's actual branch (`if (startupError) return
 * <StartupErrorScreen />`) so this is testing the real wiring, not a
 * re-description of it.
 */
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#000',
    mutedForeground: '#666',
  }),
}));

const { getItem, setItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem },
}));

const { setDeviceSecretGetter, getProfile } = vi.hoisted(() => ({
  setDeviceSecretGetter: vi.fn(),
  getProfile: vi.fn(async () => ({ ownedCatIds: [] })),
}));

vi.mock('@workspace/api-client-react', () => ({
  setDeviceSecretGetter,
  getProfile,
  setDeviceMovedListener: () => undefined,
}));

import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { LanguageProvider } from '@/context/LanguageContext';
import { StartupErrorScreen } from '@/components/StartupErrorScreen';

/** Mirrors OnboardingGate's real branch (app/_layout.tsx). */
function Gate() {
  const { startupError, isReady } = useDevice();
  if (startupError) return <StartupErrorScreen />;
  if (!isReady) return <>not ready</>;
  return <>ready</>;
}

describe('DeviceProvider startup failure (SYC-136)', () => {
  let originalGetRandomValues: typeof crypto.getRandomValues;

  beforeEach(() => {
    vi.clearAllMocks();
    getItem.mockResolvedValue(null);
    originalGetRandomValues = crypto.getRandomValues;
    // Simulate a runtime with no secure random source at all — the same
    // condition getSecureRandomBytes() in DeviceContext.tsx throws on.
    Object.defineProperty(crypto, 'getRandomValues', {
      value: undefined,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: originalGetRandomValues,
      configurable: true,
    });
    cleanup();
  });

  it('shows the translated startup-error screen instead of hanging, and never falls back to Math.random', async () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <LanguageProvider>
        <DeviceProvider>
          <Gate />
        </DeviceProvider>
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByText('Cat Spotters can’t start on this browser'),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(
        'Try opening Cat Spotters in Chrome or Safari, or update your browser.',
      ),
    ).toBeTruthy();

    // The whole point of SYC-136: a missing secure source must fail
    // loudly, never quietly fall back to Math.random().
    expect(mathRandomSpy).not.toHaveBeenCalled();
    // ...and it must have been logged, not swallowed.
    expect(consoleErrorSpy).toHaveBeenCalled();

    mathRandomSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
