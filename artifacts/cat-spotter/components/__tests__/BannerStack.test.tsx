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
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

// SYC-134: HomeScreenNudgeBanner is exercised in detail in
// HomeScreenNudgeBanner.test.tsx. Here it's real (not stubbed away, unlike
// OwnershipNoticeBanner above) so this file can prove it renders as a
// sibling of the top stack, not inside it — DeviceContext is a vi.fn() so
// individual tests can opt it into showing.
const { useDevice } = vi.hoisted(() => ({ useDevice: vi.fn() }));
vi.mock('@/context/DeviceContext', () => ({ useDevice }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn().mockResolvedValue(null), setItem: vi.fn() },
}));

const { useOffline, openURL } = vi.hoisted(() => ({
  useOffline: vi.fn(),
  openURL: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/context/OfflineContext', () => ({ useOffline }));
// SYC-42: the cat-report reminder banner reads the report queue.
vi.mock('@/context/ReportQueueContext', () => ({
  useReportQueue: () => ({ reminderVisible: false, dismissReminder: () => undefined, syncNow: async () => undefined }),
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual('react-native-web');
  return { ...actual, Linking: { openURL } };
});

// SYC-128: react-native-web reports onLayout through a ResizeObserver,
// which jsdom lacks. This stand-in records what's observed so a test can
// fire a layout change by hand. It has to exist before BannerStack first
// renders: react-native-web creates its one observer lazily, on first use.
const resizeObserver = vi.hoisted(() => {
  const state = {
    callback: null as null | ((entries: { target: Element }[]) => void),
    observed: new Set<Element>(),
  };
  (globalThis as any).ResizeObserver = class {
    constructor(cb: (entries: { target: Element }[]) => void) {
      state.callback = cb;
    }
    observe(el: Element) {
      state.observed.add(el);
    }
    unobserve(el: Element) {
      state.observed.delete(el);
    }
    disconnect() {
      state.observed.clear();
    }
  };
  return state;
});

import { BannerStack } from '../BannerStack';
import { getBannerAreaHeight, setBannerAreaHeight } from '@/lib/bannerArea';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setBannerAreaHeight(0);
});

describe('BannerStack', () => {
  it('renders both the sign-in and review-ready banners when both are due at once', () => {
    const dismissReviewPrompt = vi.fn();
    useDevice.mockReturnValue({ username: null, isReady: false });
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

  // SYC-134 review, 30 Sep 2026 (Samuel): the Home Screen nudge became a
  // floating card centred on the screen, not a top banner, so it moved out
  // of the top stack's column — this pins that it's a sibling, not a
  // descendant, of that positioned container (position isn't itself
  // unit-testable in jsdom, but "not inside the stack" is).
  it('renders the Home Screen nudge outside the top stack, not inside it', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    useOffline.mockReturnValue({
      needsSignIn: false,
      reviewPromptVisible: false,
      reviewReadyCount: 0,
      pending: [],
      dismissReviewPrompt: vi.fn(),
    });
    // SYC-134 review round 3: the nudge is now scoped to iPhone/iPad
    // Safari only — jsdom's default UA doesn't match, so it must be set
    // explicitly for this structural check to see it render at all.
    Object.defineProperty(window.navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      configurable: true,
    });

    const { findByText, container } = render(<BannerStack />);
    const nudgeText = await findByText('homeScreenNudgeText');

    // The top stack is the one positioned container from the test above.
    const topStack = container.querySelector('[class*="r-position-"]');
    expect(topStack).toBeTruthy();
    expect(topStack!.contains(nudgeText)).toBe(false);
  });

  // SYC-128: the banners used to float over the top of every screen, so on
  // desktop web (no safe-area inset) they covered the Home greeting. The
  // stack now reports its own height, and Home reserves that much room.
  it('reports the banner area height while banners show, and zero once it unmounts', async () => {
    useDevice.mockReturnValue({ username: null, isReady: false });
    useOffline.mockReturnValue({
      needsSignIn: true,
      reviewPromptVisible: true,
      reviewReadyCount: 1,
      pending: [{ localId: 'A', status: 'review', sightingId: 1, isCatPhoto: true, candidates: [] }],
      dismissReviewPrompt: vi.fn(),
    });

    const { container, unmount } = render(<BannerStack />);
    const topStack = container.querySelector('[class*="r-position-"]') as HTMLElement;
    expect(topStack).toBeTruthy();
    expect(resizeObserver.observed.has(topStack)).toBe(true);

    // Two 44px banners and the 8px gap between them.
    Object.defineProperty(topStack, 'offsetHeight', { value: 96, configurable: true });
    resizeObserver.callback!([{ target: topStack }]);
    await waitFor(() => expect(getBannerAreaHeight()).toBe(96));

    unmount();
    expect(getBannerAreaHeight()).toBe(0);
  });
});
