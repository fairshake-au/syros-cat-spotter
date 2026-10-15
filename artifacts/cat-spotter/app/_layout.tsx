import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  getGetProfileQueryKey,
  setBaseUrl,
  setPrelaunchKey,
  useGetProfile,
} from '@workspace/api-client-react';
import { AppearanceProvider } from '@/context/AppearanceContext';
import { LanguageProvider } from '@/context/LanguageContext';
import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { OfflineProvider, useOffline } from '@/context/OfflineContext';
import { AppSettingsProvider } from '@/context/AppSettingsContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { ReportQueueProvider } from '@/context/ReportQueueContext';
import {
  DeleteMyDataProvider,
  useDeleteMyData,
} from '@/context/DeleteMyDataContext';
import { DeleteMyDataDone } from '@/components/DeleteMyDataDone';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { StartupErrorScreen } from '@/components/StartupErrorScreen';
import { BannerStack } from '@/components/BannerStack';
import { KeepSafeScreen } from '@/components/keepSafe/KeepSafeScreen';
import { MovedScreen } from '@/components/keepSafe/MovedScreen';
import { ensureOfflineTiles } from '@/lib/offlineTiles';
import { apiOrigin } from '@/lib/urls';
import { prelaunchKey } from '@/lib/prelaunch';
import { hideWebLoadingScreen } from '@/lib/webLoadingScreen';

setBaseUrl(apiOrigin());
// SYC-113: the tester key is set when this file loads, before any provider
// mounts, so the offline queue's first flush and the first push-token
// registration already carry it. It must not wait for DeviceProvider.
setPrelaunchKey(prelaunchKey());

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

/** Downloads the offline Syros map tiles on first launch, retries on reconnect. */
function OfflineTilesLoader() {
  const { isOnline } = useOffline();
  useEffect(() => {
    if (isOnline) {
      ensureOfflineTiles();
    }
  }, [isOnline]);
  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="cat/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="review" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="report" options={{ headerShown: false }} />
      <Stack.Screen name="restore" options={{ headerShown: false }} />
      <Stack.Screen name="keep-safe" options={{ headerShown: false }} />
      <Stack.Screen name="get-spots-back" options={{ headerShown: false }} />
      <Stack.Screen name="delete-my-data" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * SYC-3: "keep my spots safe" offered once more when a spotter who skipped it
 * at onboarding first has something to lose, their first badge
 * (email-capture.md §8.3). Declining is one tap, and it's never asked again.
 */
function FirstBadgeOffer({ children }: { children: React.ReactNode }) {
  const { deviceId, setKeepSafeOffer } = useDevice();
  const { isOnline } = useOffline();
  const profile = useGetProfile(deviceId ?? '', {
    query: { enabled: !!deviceId && isOnline, queryKey: getGetProfileQueryKey(deviceId ?? '') },
  });
  const badges = profile.data?.badges;
  if (Array.isArray(badges) && badges.length > 0) {
    return (
      <KeepSafeScreen
        surface="first_badge"
        onSaved={() => setKeepSafeOffer('done')}
        onSkip={() => setKeepSafeOffer('done')}
      />
    );
  }
  return <>{children}</>;
}

/**
 * Shows the one-time landing screen until a username has been claimed, then
 * (SYC-3) "Don't lose your spots" once, before the app.
 */
function OnboardingGate() {
  const { isReady, username, startupError, moved, keepSafeOffer, setKeepSafeOffer } = useDevice();
  const pathname = usePathname();
  // Whether this phone already had a spotter when the app opened: a spotter
  // from before this version sees "keep my spots safe" once as a one-time
  // offer; a new one sees it as the last onboarding step.
  const startedWithName = useRef<boolean | null>(null);
  if (isReady && startedWithName.current === null) startedWithName.current = Boolean(username);
  const { doneVisible } = useDeleteMyData();
  // SYC-136: a rejected promise inside DeviceProvider's setup effect isn't
  // caught by the top-level ErrorBoundary (render-only), so DeviceProvider
  // surfaces it here instead of leaving isReady false and this app stuck
  // on a blank screen forever.
  if (startupError) return <StartupErrorScreen />;
  if (!isReady) return null;
  // SYC-63: "Done" comes before the new spotter's first-run step.
  if (doneVisible) return <DeleteMyDataDone />;
  // SYC-3: this phone's spotter moved to a new phone.
  if (moved) return <MovedScreen />;
  // SYC-3: a restore link works on a phone that hasn't finished onboarding.
  if (pathname === '/restore') return <RootLayoutNav />;
  if (!username) return <OnboardingFlow />;
  if (keepSafeOffer === null) {
    const onboarding = startedWithName.current === false;
    return (
      <KeepSafeScreen
        surface={onboarding ? 'onboarding' : 'first_badge'}
        showDots={onboarding}
        onSaved={() => setKeepSafeOffer('done')}
        onSkip={() => setKeepSafeOffer(onboarding ? 'skipped-onboarding' : 'done')}
      />
    );
  }
  const app = (
    <>
      <OfflineTilesLoader />
      <RootLayoutNav />
      <BannerStack />
    </>
  );
  return keepSafeOffer === 'skipped-onboarding' ? <FirstBadgeOffer>{app}</FirstBadgeOffer> : app;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
      // SYC-133: the website's loading screen hides at the same moment.
      hideWebLoadingScreen();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider>
          <ErrorBoundary>
            <LanguageProvider>
              <DeviceProvider>
                <OfflineProvider>
                  <AppSettingsProvider>
                  <ReportQueueProvider>
                    <NotificationProvider>
                      <DeleteMyDataProvider>
                        <GestureHandlerRootView>
                          <KeyboardProvider>
                            <OnboardingGate />
                          </KeyboardProvider>
                        </GestureHandlerRootView>
                      </DeleteMyDataProvider>
                    </NotificationProvider>
                  </ReportQueueProvider>
                  </AppSettingsProvider>
                </OfflineProvider>
              </DeviceProvider>
            </LanguageProvider>
          </ErrorBoundary>
        </AppearanceProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
