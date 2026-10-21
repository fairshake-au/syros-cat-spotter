// @vitest-environment jsdom
/**
 * SYC-133 review: app/_layout.tsx must remove the website's loading screen
 * when the fonts are ready, the same moment the native splash screen hides.
 * Without this call the loading screen would sit over the app forever, and
 * no other test notices (the review proved it by deleting the call).
 *
 * Every module _layout imports is replaced with a stub, as in
 * layoutPrelaunchKey.test.ts; only the effect under test runs.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/context/LanguageContext', () => ({
  LanguageProvider: stubComponent('LanguageProvider'),
  useLanguage: () => ({ isLanguageReady: true, t: (k: string) => k }),
}));
vi.mock('@/context/DeviceContext', () => ({
  DeviceProvider: stubComponent('DeviceProvider'),
  useDevice: () => ({}),
}));
vi.mock('@/context/OfflineContext', () => ({
  OfflineProvider: stubComponent('OfflineProvider'),
  useOffline: () => ({ isOnline: true }),
}));
vi.mock('@/context/NotificationContext', () => ({ NotificationProvider: stubComponent('NotificationProvider') }));
// SYC-42: the cat-report queue's provider.
vi.mock('@/context/ReportQueueContext', () => ({ ReportQueueProvider: stubComponent('ReportQueueProvider') }));
vi.mock('@/context/IssueQueueContext', () => ({ IssueQueueProvider: stubComponent('IssueQueueProvider') }));
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
vi.mock('@/components/BannerStack', () => ({ BannerStack: stubComponent('BannerStack') }));
vi.mock('@/components/TurnstileHost', () => ({ TurnstileHost: stubComponent('TurnstileHost') }));
// SYC-3: the keep-safe step and the "moved" screen.
vi.mock('@/components/keepSafe/KeepSafeScreen', () => ({ KeepSafeScreen: stubComponent('KeepSafeScreen') }));
vi.mock('@/components/keepSafe/MovedScreen', () => ({ MovedScreen: stubComponent('MovedScreen') }));

afterEach(cleanup);

describe('app/_layout.tsx and the web loading screen', () => {
  it('removes the loading screen once the fonts are ready', async () => {
    const { default: RootLayout } = await import('../../app/_layout');
    render(<RootLayout />);
    expect(hideWebLoadingScreen).toHaveBeenCalledTimes(1);
  });
});
