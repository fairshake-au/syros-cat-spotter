import React, { useEffect } from 'react';
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
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl, setPrelaunchKey } from '@workspace/api-client-react';
import { AppearanceProvider } from '@/context/AppearanceContext';
import { LanguageProvider } from '@/context/LanguageContext';
import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { OfflineProvider, useOffline } from '@/context/OfflineContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { StartupErrorScreen } from '@/components/StartupErrorScreen';
import { BannerStack } from '@/components/BannerStack';
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
    </Stack>
  );
}

/** Shows the one-time landing screen until a username has been claimed. */
function OnboardingGate() {
  const { isReady, username, startupError } = useDevice();
  // SYC-136: a rejected promise inside DeviceProvider's setup effect isn't
  // caught by the top-level ErrorBoundary (render-only), so DeviceProvider
  // surfaces it here instead of leaving isReady false and this app stuck
  // on a blank screen forever.
  if (startupError) return <StartupErrorScreen />;
  if (!isReady) return null;
  if (!username) return <OnboardingFlow />;
  return (
    <>
      <OfflineTilesLoader />
      <RootLayoutNav />
      <BannerStack />
    </>
  );
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
                  <NotificationProvider>
                    <GestureHandlerRootView>
                      <KeyboardProvider>
                        <OnboardingGate />
                      </KeyboardProvider>
                    </GestureHandlerRootView>
                  </NotificationProvider>
                </OfflineProvider>
              </DeviceProvider>
            </LanguageProvider>
          </ErrorBoundary>
        </AppearanceProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
