// @vitest-environment jsdom
/**
 * SYC-134: the "Add to Home Screen" nudge, shown to web testers once
 * they've claimed a username, so a Safari storage wipe (after 7 days
 * without a visit) doesn't cost them their spots (SYC-3 Decision 1(a)).
 */
import React from 'react';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Flushes the AsyncStorage.getItem() microtask chain (and the state update
// it triggers) so a "still renders nothing" assertion checks the settled
// state, not just the instant right after render — otherwise an assertion
// like `waitFor(() => expect(innerHTML).toBe(''))` would trivially pass
// while snoozed is still `null` (loading) and never actually observe
// whether the checked-in guard fired.
async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

vi.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ accent: '#123', accentForeground: '#fff' }),
}));

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const { useDevice } = vi.hoisted(() => ({ useDevice: vi.fn() }));
vi.mock('@/context/DeviceContext', () => ({ useDevice }));

const { useOffline } = vi.hoisted(() => ({ useOffline: vi.fn() }));
vi.mock('@/context/OfflineContext', () => ({ useOffline }));

const { useAnyModalOpen } = vi.hoisted(() => ({ useAnyModalOpen: vi.fn() }));
vi.mock('@/lib/modalVisibility', () => ({ useAnyModalOpen }));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) =>
      Promise.resolve(storage.has(key) ? storage.get(key)! : null),
    ),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

// react-native-web's Platform.OS is 'web' by default in this jsdom
// environment, matching the deployed web build — no mock needed for the
// "native never renders this" case; that's covered via a dedicated test
// below that mocks Platform directly.

import { HomeScreenNudgeBanner } from '../HomeScreenNudgeBanner';

function setUserAgent(ua: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
}

function setStandalone(standalone: boolean) {
  Object.defineProperty(window.navigator, 'standalone', {
    value: standalone,
    configurable: true,
  });
}

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

beforeEach(() => {
  storage.clear();
  setUserAgent(IPHONE_SAFARI);
  setStandalone(false);
  useOffline.mockReturnValue({ needsSignIn: false });
  useAnyModalOpen.mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HomeScreenNudgeBanner', () => {
  it('renders nothing before a username is claimed (mid-onboarding)', async () => {
    useDevice.mockReturnValue({ username: null, isReady: true });
    const { container } = render(<HomeScreenNudgeBanner />);
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while device state is still loading', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: false });
    const { container } = render(<HomeScreenNudgeBanner />);
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when already running standalone (added, never shown again)', async () => {
    setStandalone(true);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { container } = render(<HomeScreenNudgeBanner />);
    // Starts hidden (standalone defaults true until checked) and stays
    // hidden once the check confirms it — never a flash of the banner.
    expect(container.innerHTML).toBe('');
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  it('shows the nudge once a username is claimed and it is not standalone', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() =>
      expect(getByText('homeScreenNudgeText')).toBeTruthy(),
    );
  });

  // SYC-134 review, 30 Sep 2026: the sign-in-required prompt matters more
  // than a reminder to add a Home Screen icon — don't compete with it.
  it('stays hidden while the sign-in-required prompt is showing', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    useOffline.mockReturnValue({ needsSignIn: true });
    const { container } = render(<HomeScreenNudgeBanner />);
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  // SYC-134 review round 2, 30 Sep 2026: don't overlap a modal/bottom sheet
  // (e.g. ClaimCatSheet), which sets this flag via lib/modalVisibility.ts.
  it('stays hidden while a modal/bottom sheet is open', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    useAnyModalOpen.mockReturnValue(true);
    const { container } = render(<HomeScreenNudgeBanner />);
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  it('shows iPhone Safari instructions with the share icon', async () => {
    setUserAgent(IPHONE_SAFARI);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() =>
      expect(getByText('homeScreenNudgeInstructionsIosSafari')).toBeTruthy(),
    );
  });

  // SYC-134 review, 30 Sep 2026: the on-device check only covered iOS
  // Safari. Chrome (and other third-party browsers) on iOS may keep their
  // own storage, separate from Safari's, so a Home Screen icon added from
  // one of them could open as a stranger — the exact loss this banner
  // exists to prevent. Stay hidden there until checked for real.
  it('hides on iOS Chrome (unverified Home Screen storage sharing)', async () => {
    setUserAgent(IPHONE_CHROME);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { container } = render(<HomeScreenNudgeBanner />);
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  it('shows Android Chrome menu instructions when no install prompt has fired', async () => {
    setUserAgent(ANDROID_CHROME);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() =>
      expect(
        getByText('homeScreenNudgeInstructionsAndroidChromeMenu'),
      ).toBeTruthy(),
    );
  });

  it('shows an install button and triggers the captured beforeinstallprompt event on Android Chrome', async () => {
    setUserAgent(ANDROID_CHROME);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText, queryByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() =>
      expect(getByText('homeScreenNudgeText')).toBeTruthy(),
    );

    const promptFn = vi.fn();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    (event as unknown as { prompt: () => void }).prompt = promptFn;
    window.dispatchEvent(event);

    await waitFor(() =>
      expect(getByText('homeScreenNudgeAddButton')).toBeTruthy(),
    );
    expect(
      queryByText('homeScreenNudgeInstructionsAndroidChromeMenu'),
    ).toBeNull();

    fireEvent.click(getByText('homeScreenNudgeAddButton'));
    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  // SYC-134 review round 2, 30 Sep 2026: a `beforeinstallprompt` event can
  // only be prompted once — double-tapping the button (or a stray second
  // click) must not call `.prompt()` a second time on the same event.
  it('does not call .prompt() twice on a double tap of the install button', async () => {
    setUserAgent(ANDROID_CHROME);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() => expect(getByText('homeScreenNudgeText')).toBeTruthy());

    const promptFn = vi.fn();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    (event as unknown as { prompt: () => void }).prompt = promptFn;
    window.dispatchEvent(event);
    await waitFor(() =>
      expect(getByText('homeScreenNudgeAddButton')).toBeTruthy(),
    );

    const button = getByText('homeScreenNudgeAddButton');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  // SYC-134 review round 2, 30 Sep 2026: `appinstalled` is the authoritative
  // "actually installed" signal — unlike `standalone`/`display-mode`, which
  // only describe the current tab and wouldn't catch someone installing
  // from a still-open old tab.
  it('hides for good once the browser reports appinstalled', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText, container } = render(<HomeScreenNudgeBanner />);
    await waitFor(() => expect(getByText('homeScreenNudgeText')).toBeTruthy());

    window.dispatchEvent(new Event('appinstalled'));
    await flushEffects();
    expect(container.innerHTML).toBe('');
  });

  it('shows generic instructions on desktop / unrecognised browsers', async () => {
    setUserAgent(DESKTOP_CHROME);
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() =>
      expect(getByText('homeScreenNudgeInstructionsOther')).toBeTruthy(),
    );
  });

  it('is dismissible, and stays hidden within the 7-day snooze', async () => {
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText, container, rerender } = render(
      <HomeScreenNudgeBanner />,
    );
    await waitFor(() =>
      expect(getByText('homeScreenNudgeText')).toBeTruthy(),
    );

    // iPhone Safari copy has no install button, so the only Pressable is
    // the dismiss (x) control.
    const pressables = container.querySelectorAll('[tabindex="0"]');
    expect(pressables.length).toBe(1);
    fireEvent.click(pressables[0]!);
    await waitFor(() => expect(container.innerHTML).toBe(''));

    cleanup();
    const { container: container2 } = render(<HomeScreenNudgeBanner />);
    // Storage read has resolved and it's still hidden (dismissed <7 days
    // ago) — flush rather than waitFor, since the pre-storage-read state is
    // also empty and would make a bare waitFor pass without ever observing
    // the resolved snooze check.
    await flushEffects();
    expect(container2.innerHTML).toBe('');
  });

  it('shows again once 7 days have passed since dismissal', async () => {
    storage.set(
      'cat-spotter/home-screen-nudge-dismissed-at',
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    useDevice.mockReturnValue({ username: 'lili', isReady: true });
    const { getByText } = render(<HomeScreenNudgeBanner />);
    await waitFor(() =>
      expect(getByText('homeScreenNudgeText')).toBeTruthy(),
    );
  });
});

describe('HomeScreenNudgeBanner on native', () => {
  it('never renders on native, even with a claimed username', async () => {
    vi.resetModules();
    vi.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
      Pressable: 'Pressable',
      StyleSheet: { create: (s: unknown) => s },
      Text: 'Text',
      View: 'View',
    }));
    vi.doMock('@expo/vector-icons', () => ({ Feather: () => null }));
    vi.doMock('@/hooks/useColors', () => ({
      useColors: () => ({ accent: '#123', accentForeground: '#fff' }),
    }));
    vi.doMock('@/context/LanguageContext', () => ({
      useLanguage: () => ({ t: (key: string) => key }),
    }));
    vi.doMock('@/context/DeviceContext', () => ({
      useDevice: () => ({ username: 'lili', isReady: true }),
    }));
    vi.doMock('@/context/OfflineContext', () => ({
      useOffline: () => ({ needsSignIn: false }),
    }));
    vi.doMock('@/lib/modalVisibility', () => ({
      useAnyModalOpen: () => false,
    }));
    vi.doMock('react-native-safe-area-context', () => ({
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    }));
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: { getItem: vi.fn(), setItem: vi.fn() },
    }));

    const { HomeScreenNudgeBanner: NativeBanner } = await import(
      '../HomeScreenNudgeBanner'
    );
    const { container } = render(<NativeBanner />);
    expect(container.innerHTML).toBe('');

    vi.doUnmock('react-native');
    vi.resetModules();
  });
});
