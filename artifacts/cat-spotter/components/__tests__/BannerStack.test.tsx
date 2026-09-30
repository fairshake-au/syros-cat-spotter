// @vitest-environment jsdom
/**
 * SYC-121 review fix: SignInRequiredBanner and ReviewReadyBanner used to
 * render at the identical absolute rect, told apart only by zIndex
 * (SignInRequiredBanner had one, ReviewReadyBanner didn't) — so when both
 * `needsSignIn` and `reviewPromptVisible` were true at once (a plausible
 * case: one queued item finishes syncing while another hits the sign-in
 * gate), the review-ready banner was completely hidden underneath.
 *
 * BannerStack now stacks every visible banner in one column, so this
 * covers the case that was silently broken: with both flags true, both
 * banners render and are both reachable (their own tap handlers fire).
 */
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    accent: '#123',
    accentForeground: '#fff',
    primary: '#456',
    primaryForeground: '#fff',
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const { usePathname, useRouter } = vi.hoisted(() => ({
  usePathname: vi.fn().mockReturnValue('/'),
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
}));
vi.mock('expo-router', () => ({ usePathname, useRouter }));

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// OwnershipNoticeBanner pulls in AsyncStorage, the API client and
// DeviceContext — irrelevant to the stacking behaviour under test here, so
// it's stubbed out to keep this test focused on the two banners the review
// finding was actually about.
vi.mock('@/components/OwnershipNoticeBanner', () => ({
  OwnershipNoticeBanner: () => null,
}));

// SYC-134: HomeScreenNudgeBanner is exercised on its own in
// HomeScreenNudgeBanner.test.tsx. Here it only needs to render null without
// throwing — no claimed username means it hides itself — so DeviceContext
// and AsyncStorage just need real-enough stubs to not blow up on mount.
vi.mock('@/context/DeviceContext', () => ({
  useDevice: () => ({ username: null, isReady: false }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn() },
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

import { BannerStack } from '../BannerStack';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BannerStack', () => {
  it('renders both the sign-in and review-ready banners when both are due at once', () => {
    const dismissReviewPrompt = vi.fn();
    useOffline.mockReturnValue({
      needsSignIn: true,
      reviewPromptVisible: true,
      reviewReadyCount: 1,
      pending: [{ localId: 'A', status: 'review', sightingId: 1, isCatPhoto: true, candidates: [] }],
      dismissReviewPrompt,
    });
    usePathname.mockReturnValue('/');

    const { getByText } = render(<BannerStack />);

    // Neither is hidden behind the other: both are present in the DOM...
    const signIn = getByText('signInRequiredTitle');
    const reviewReady = getByText('reviewReadyOne');
    expect(signIn).toBeTruthy();
    expect(reviewReady).toBeTruthy();

    // ...and each is independently reachable (tapping one doesn't route
    // through or get swallowed by the other).
    fireEvent.click(signIn);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(dismissReviewPrompt).not.toHaveBeenCalled();

    fireEvent.click(reviewReady);
    expect(dismissReviewPrompt).toHaveBeenCalledTimes(1);

    // Structural proof this is a real stack, not two banners each still
    // claiming the same absolute rect: the two banner "buttons" share one
    // parent (BannerStack's own positioned container) rather than each
    // being independently positioned. Only that shared container may carry
    // its own `position` styling.
    const signInRoot = signIn.closest('[tabindex="0"]');
    const reviewReadyRoot = reviewReady.closest('[tabindex="0"]');
    expect(signInRoot).toBeTruthy();
    expect(reviewReadyRoot).toBeTruthy();
    expect(signInRoot!.parentElement).toBe(reviewReadyRoot!.parentElement);
    expect(signInRoot!.className).not.toMatch(/r-position-/);
    expect(reviewReadyRoot!.className).not.toMatch(/r-position-/);
    expect(signInRoot!.parentElement!.className).toMatch(/r-position-/);
  });
});
