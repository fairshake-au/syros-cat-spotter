import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useFonts } from 'expo-font';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import {
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl } from '@workspace/api-client-react';
import { LanguageProvider } from '@/context/LanguageContext';
import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { OfflineProvider, useOffline } from '@/context/OfflineContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { ReviewReadyBanner } from '@/components/ReviewReadyBanner';
import { OwnershipNoticeBanner } from '@/components/OwnershipNoticeBanner';
import { ensureOfflineTiles } from '@/lib/offlineTiles';

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

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
  const { isReady, username } = useDevice();
  if (!isReady) return null;
  if (!username) return <OnboardingFlow />;
  return (
    <>
      <OfflineTilesLoader />
      <RootLayoutNav />
      <ReviewReadyBanner />
      <OwnershipNoticeBanner />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
