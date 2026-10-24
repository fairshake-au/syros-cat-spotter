// @vitest-environment jsdom
/**
 * SYC-155/SYC-506 (review F5): the root gate in app/_layout.tsx.
 * - A name held on the phone (chosen offline) is past onboarding, and the
 *   background saver runs beside the app.
 * - "Don't lose your spots" never shows for a name the server hasn't saved.
 * - Nothing renders until the stored language is known (no flash of English).
 *
 * Harness copied from layoutWebLoadingScreen.test.tsx: every module _layout
 * imports is a stub that records its render.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hideWebLoadingScreen = vi.hoisted(() => vi.fn());
vi.mock('@/lib/webLoadingScreen', () => ({ hideWebLoadingScreen }));

const events = vi.hoisted(() => [] as string[]);

vi.mock('@workspace/api-client-react', () => ({
  setBaseUrl: (url: string | null) => events.push(`setBaseUrl:${url}`),
  setPrelaunchKey: (key: string | null) => events.push(`setPrelaunchKey:${key}`),
  // SYC-3: the root gate's first-badge offer reads the profile.
  useGetProfile: () => ({ data: undefined }),
  getGetProfileQueryKey: (id: string) => ['profile', id],
}));
vi.mock('@/lib/prelaunch', () => ({ prelaunchKey: () => 'tester-key' }));
vi.mock('@/lib/urls', () => ({ apiOrigin: () => 'https://apptest.example' }));
vi.mock('@/lib/offlineTiles', () => ({ ensureOfflineTiles: () => undefined }));

function stubComponent(name: string) {
  return (props: { children?: unknown }) => {
    events.push(`render:${name}`);
    return (props.children ?? null) as never;
  };
}

vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: stubComponent('GestureHandlerRootView') }));
vi.mock('react-native-keyboard-controller', () => ({ KeyboardProvider: stubComponent('KeyboardProvider') }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: stubComponent('SafeAreaProvider') }));
vi.mock('@/components/ErrorBoundary', () => ({ ErrorBoundary: stubComponent('ErrorBoundary') }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('@expo-google-fonts/inter', () => ({
  Inter_400Regular: 1,
  Inter_500Medium: 1,
  Inter_600SemiBold: 1,
  Inter_700Bold: 1,
  Inter_800ExtraBold: 1,
}));
vi.mock('@expo-google-fonts/space-mono', () => ({ SpaceMono_400Regular: 1, SpaceMono_700Bold: 1 }));
vi.mock('expo-router', () => ({
  Stack: Object.assign(stubComponent('Stack'), { Screen: stubComponent('Stack.Screen') }),
  usePathname: () => '/',
}));
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => Promise.resolve(true),
  hideAsync: () => Promise.resolve(true),
}));
vi.mock('@/context/AppearanceContext', () => ({ AppearanceProvider: stubComponent('AppearanceProvider') }));
const state = vi.hoisted(() => ({
  languageReady: true,
  device: {} as Record<string, unknown>,
}));
vi.mock('@/context/LanguageContext', () => ({
  LanguageProvider: stubComponent('LanguageProvider'),
  useLanguage: () => ({ isLanguageReady: state.languageReady, t: (k: string) => k }),
}));
vi.mock('@/context/DeviceContext', () => ({
  DeviceProvider: stubComponent('DeviceProvider'),
  useDevice: () => state.device,
}));
vi.mock('@/hooks/useHeldNameSaver', () => ({ HeldNameSaver: stubComponent('HeldNameSaver') }));
vi.mock('@/context/OfflineContext', () => ({
  OfflineProvider: stubComponent('OfflineProvider'),
  useOffline: () => ({ isOnline: true }),
}));
vi.mock('@/context/NotificationContext', () => ({ NotificationProvider: stubComponent('NotificationProvider') }));
// SYC-42: the cat-report queue's provider.
vi.mock('@/context/ReportQueueContext', () => ({ ReportQueueProvider: stubComponent('ReportQueueProvider') }));
vi.mock('@/context/IssueQueueContext', () => ({ IssueQueueProvider: stubComponent('IssueQueueProvider') }));
vi.mock('@/context/LocationContext', () => ({ LocationProvider: stubComponent('LocationProvider') }));
vi.mock('@/context/AppSettingsContext', () => ({ AppSettingsProvider: stubComponent('AppSettingsProvider') }));
vi.mock('@/context/DeleteMyDataContext', () => ({
  DeleteMyDataProvider: stubComponent('DeleteMyDataProvider'),
  useDeleteMyData: () => ({ doneVisible: false }),
}));
vi.mock('@/components/DeleteMyDataDone', () => ({ DeleteMyDataDone: stubComponent('DeleteMyDataDone') }));
vi.mock('@/components/onboarding/OnboardingFlow', () => ({ OnboardingFlow: stubComponent('OnboardingFlow') }));
// SYC-121 review fix: _layout.tsx now mounts one BannerStack instead of the
// three banners individually (see components/BannerStack.tsx) — stub the
// stack itself rather than each banner.
vi.mock('@/components/AppColumn', () => ({ AppColumn: stubComponent('AppColumn') }));
vi.mock('@/components/BannerStack', () => ({ BannerStack: stubComponent('BannerStack') }));
vi.mock('@/components/TurnstileHost', () => ({ TurnstileHost: stubComponent('TurnstileHost') }));
// SYC-3: the keep-safe step and the "moved" screen.
vi.mock('@/components/keepSafe/KeepSafeScreen', () => ({ KeepSafeScreen: stubComponent('KeepSafeScreen') }));
vi.mock('@/components/keepSafe/MovedScreen', () => ({ MovedScreen: stubComponent('MovedScreen') }));
vi.mock('@/components/keepSafe/FirstBadgeOffer', () => ({ FirstBadgeOffer: stubComponent('FirstBadgeOffer') }));


afterEach(cleanup);

const base = {
  isReady: true,
  startupError: null,
  moved: false,
  deviceId: 'dev-1',
  setKeepSafeOffer: () => {},
};

async function renderGate(device: Record<string, unknown>) {
  state.device = { ...base, ...device };
  events.length = 0;
  const { default: RootLayout } = await import('../../app/_layout');
  render(<RootLayout />);
  return events.filter((e) => e.startsWith('render:')).map((e) => e.slice(7));
}

describe('root gate (SYC-155, SYC-506)', () => {
  beforeEach(() => { state.languageReady = true; });

  it('no name at all: onboarding', async () => {
    const shown = await renderGate({ username: null, heldUsername: null, keepSafeOffer: null });
    expect(shown).toContain('OnboardingFlow');
    expect(shown).not.toContain('HeldNameSaver');
  });

  it('a held name: the app, with the saver, and no email offer', async () => {
    const shown = await renderGate({ username: null, heldUsername: 'SunnyTabby', keepSafeOffer: 'skipped-onboarding' });
    expect(shown).not.toContain('OnboardingFlow');
    expect(shown).not.toContain('KeepSafeScreen');
    expect(shown).toContain('HeldNameSaver');
    expect(shown).toContain('Stack');
  });

  it('a held name never gets the onboarding email offer, even with no offer state stored', async () => {
    const shown = await renderGate({ username: null, heldUsername: 'SunnyTabby', keepSafeOffer: null });
    expect(shown).not.toContain('KeepSafeScreen');
    expect(shown).not.toContain('OnboardingFlow');
  });

  it('a saved name with no offer state yet: the email offer, and no saver', async () => {
    const shown = await renderGate({ username: 'SunnyTabby', heldUsername: null, keepSafeOffer: null });
    expect(shown).toContain('KeepSafeScreen');
    expect(shown).not.toContain('HeldNameSaver');
  });

  it('the first-badge email offer waits for a saved name (SYC-502 + SYC-506)', async () => {
    let shown = await renderGate({ username: null, heldUsername: 'SunnyTabby', keepSafeOffer: 'skipped-onboarding' });
    expect(shown).not.toContain('FirstBadgeOffer');
    cleanup();
    shown = await renderGate({ username: 'SunnyTabby', heldUsername: null, keepSafeOffer: 'skipped-onboarding' });
    expect(shown).toContain('FirstBadgeOffer');
  });

  it('waits for the stored language before showing anything', async () => {
    state.languageReady = false;
    const shown = await renderGate({ username: null, heldUsername: null, keepSafeOffer: null });
    expect(shown).not.toContain('OnboardingFlow');
  });
});
