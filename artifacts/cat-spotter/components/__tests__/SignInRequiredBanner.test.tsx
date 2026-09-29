// @vitest-environment jsdom
/**
 * SYC-121: the tap-to-sign-in prompt shown when a sync hits the pre-launch
 * gate's own 401. Covers the UI half of the requirement — the queue-pause
 * and retry logic are unit-tested against OfflineContext directly.
 */
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ accent: '#123', accentForeground: '#fff' }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const { usePathname } = vi.hoisted(() => ({
  usePathname: vi.fn().mockReturnValue('/'),
}));
vi.mock('expo-router', () => ({ usePathname }));

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const { useOffline, openURL } = vi.hoisted(() => ({
  useOffline: vi.fn(),
  openURL: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline }));

vi.mock('react-native', async () => {
  const actual = await vi.importActual('react-native-web');
  return { ...actual, Linking: { openURL } };
});

import { SignInRequiredBanner } from '../SignInRequiredBanner';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SignInRequiredBanner', () => {
  it('renders nothing when needsSignIn is false', () => {
    useOffline.mockReturnValue({ needsSignIn: false });
    const { container } = render(<SignInRequiredBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the prompt and opens the sign-in page on tap when needsSignIn is true', () => {
    useOffline.mockReturnValue({ needsSignIn: true });
    const { getByText } = render(<SignInRequiredBanner />);

    expect(getByText('signInRequiredTitle')).toBeTruthy();
    fireEvent.click(getByText('signInRequiredTitle'));

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL.mock.calls[0][0]).toMatch(/\/_gate\/login\?next=%2F$/);
  });

  it('carries the current path as ?next= so sign-in returns where the user was', () => {
    usePathname.mockReturnValue('/cat/42');
    useOffline.mockReturnValue({ needsSignIn: true });
    const { getByText } = render(<SignInRequiredBanner />);

    fireEvent.click(getByText('signInRequiredTitle'));

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL.mock.calls[0][0]).toMatch(
      /\/_gate\/login\?next=%2Fcat%2F42$/,
    );
  });
});
