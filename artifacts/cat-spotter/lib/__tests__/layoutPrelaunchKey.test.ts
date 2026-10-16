/**
 * SYC-113 test 21: importing app/_layout.tsx sets the tester key before any
 * provider mounts, so the offline queue's first flush and the first
 * push-token registration already carry it.
 *
 * Every module _layout imports is replaced with a stub that records when it
 * renders; the real providers never run. The key must be set by the import
 * alone, with no render at all.
 */
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('@/context/LanguageContext', () => ({ LanguageProvider: stubComponent('LanguageProvider') }));
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

describe('app/_layout.tsx', () => {
  it('sets the tester key when the file loads, before any provider mounts', async () => {
    const layout = await import('../../app/_layout');
    expect(typeof layout.default).toBe('function');
    expect(events).toContain('setPrelaunchKey:tester-key');
    // Nothing has rendered: the key was set by the import alone.
    expect(events.filter((e) => e.startsWith('render:'))).toEqual([]);
    // And it sits beside setBaseUrl, as the plan asks.
    expect(events.indexOf('setPrelaunchKey:tester-key')).toBe(events.indexOf('setBaseUrl:https://apptest.example') + 1);
  });
});
