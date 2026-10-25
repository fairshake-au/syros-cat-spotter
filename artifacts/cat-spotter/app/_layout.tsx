import React, { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useFonts } from 'expo-font';
import { fontSources } from '@/lib/fontSources';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { setBaseUrl, setPrelaunchKey } from '@workspace/api-client-react';
import { AppearanceProvider } from '@/context/AppearanceContext';
import { CelebrationSettingsProvider } from '@/context/CelebrationSettingsContext';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { DeviceProvider, useDevice } from '@/context/DeviceContext';
import { OfflineProvider, useOffline } from '@/context/OfflineContext';
import { LocationProvider } from '@/context/LocationContext';
import { AppSettingsProvider } from '@/context/AppSettingsContext';
import { CelebrationProvider } from '@/context/CelebrationContext';
import { NotificationProvider } from '@/context/NotificationContext';
import { ReportQueueProvider } from '@/context/ReportQueueContext';
import { IssueQueueProvider } from '@/context/IssueQueueContext';
import { TurnstileHost } from '@/components/TurnstileHost';
import {
  DeleteMyDataProvider,
  useDeleteMyData,
} from '@/context/DeleteMyDataContext';
import { DeleteMyDataDone } from '@/components/DeleteMyDataDone';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { HeldNameSaver } from '@/hooks/useHeldNameSaver';
import { AppColumn } from '@/components/AppColumn';
import { StartupErrorScreen } from '@/components/StartupErrorScreen';
import { BannerStack } from '@/components/BannerStack';
import { KeepSafeScreen } from '@/components/keepSafe/KeepSafeScreen';
import { MovedScreen } from '@/components/keepSafe/MovedScreen';
import { FirstBadgeOffer } from '@/components/keepSafe/FirstBadgeOffer';
import { ensureOfflineTiles } from '@/lib/offlineTiles';
import { apiOrigin } from '@/lib/urls';
import { prelaunchKey } from '@/lib/prelaunch';
import { restoreReopenReady, useReopenRestoreCode } from '@/hooks/useReopenRestoreCode';
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
      <Stack.Screen name="settings" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * Shows the one-time landing screen until a username has been claimed, then
 * the app. A new spotter is offered "Don't lose your spots" on the name
 * screen (SYC-524) and once more at their first badge, on top of the app
 * (FirstBadgeOffer, SYC-502). A spotter from before this version sees the
 * full-screen offer (SYC-3) once, before the app.
 */
function OnboardingGate() {
  const { isReady, username, heldUsername, startupError, moved, keepSafeOffer, setKeepSafeOffer } = useDevice();
  // SYC-155: the first screen waits for the stored language, so a phone that
  // chose Greek or French never flashes English first.
  const { isLanguageReady } = useLanguage();
  const pathname = usePathname();
  // Whether this phone already had a spotter when the app opened: a spotter
  // from before this version sees "keep my spots safe" once as a one-time
  // offer; a new one never sees that screen (SYC-524).
  const startedWithName = useRef<boolean | null>(null);
  if (isReady && startedWithName.current === null) startedWithName.current = Boolean(username);
  // SYC-524: once the phone has no spotter at all ("Delete my data", "start
  // again"), any name that arrives later belongs to a new spotter.
  if (isReady && !username && !heldUsername) startedWithName.current = false;
  // SYC-524 backstop: the name screen writes 'skipped-onboarding' before it
  // saves anything, but a name can also arrive another way (recover-on-mount,
  // a late reconcile, a relaunch after a claim landed). A new spotter's name
  // with no offer state is treated as a skip, never as the old screen.
  const newSpotterWithoutOffer =
    isReady && keepSafeOffer === null && !!username && startedWithName.current === false;
  useEffect(() => {
    if (newSpotterWithoutOffer) setKeepSafeOffer('skipped-onboarding');
  }, [newSpotterWithoutOffer, setKeepSafeOffer]);
  const { doneVisible } = useDeleteMyData();
  // SYC-664: a named phone that reloaded while fetching its code goes back to the code box.
  const offerScreenShowing = keepSafeOffer === null && !!username && startedWithName.current === true;
  useReopenRestoreCode(
    restoreReopenReady({
      isReady,
      isLanguageReady,
      startupError: Boolean(startupError),
      doneVisible,
      moved: Boolean(moved),
      offerScreenShowing,
    }),
    !!username,
    pathname,
  );
  // SYC-136: a rejected promise inside DeviceProvider's setup effect isn't
  // caught by the top-level ErrorBoundary (render-only), so DeviceProvider
  // surfaces it here instead of leaving isReady false and this app stuck
  // on a blank screen forever.
  if (startupError) return <StartupErrorScreen />;
  if (!isReady || !isLanguageReady) return null;
  // SYC-63: "Done" comes before the new spotter's first-run step.
  if (doneVisible) return <DeleteMyDataDone />;
  // SYC-3: this phone's spotter moved to a new phone.
  if (moved) return <MovedScreen />;
  // SYC-3: a restore link works on a phone that hasn't finished onboarding.
  if (pathname === '/restore') return <RootLayoutNav />;
  // SYC-506: a name held on the phone (chosen offline) is past onboarding;
  // HeldNameSaver saves it once there's a connection.
  if (!username && !heldUsername) return <OnboardingFlow />;
  // SYC-3: the one-time offer, only for a spotter from before this version.
  if (keepSafeOffer === null && username && startedWithName.current === true) {
    return (
      <KeepSafeScreen
        surface="first_badge"
        onSaved={() => setKeepSafeOffer('done')}
        onSkip={() => setKeepSafeOffer('done')}
      />
    );
  }
  return (
    <CelebrationProvider>
      <OfflineTilesLoader />
      {!username && <HeldNameSaver />}
      <RootLayoutNav />
      <BannerStack />
      {/* SYC-506: only for a spotter whose name the server has saved. */}
      {keepSafeOffer === 'skipped-onboarding' && username ? <FirstBadgeOffer /> : null}
    </CelebrationProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontSources);

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
          <CelebrationSettingsProvider>
          <ErrorBoundary>
            <LanguageProvider>
              <DeviceProvider>
                <OfflineProvider>
                  <LocationProvider>
                    <AppSettingsProvider>
                      <ReportQueueProvider>
                        <IssueQueueProvider>
                          <NotificationProvider>
                            <DeleteMyDataProvider>
                              <GestureHandlerRootView>
                                <KeyboardProvider>
                                  <AppColumn>
                                    <OnboardingGate />
                                  </AppColumn>
                                  <TurnstileHost />
                                </KeyboardProvider>
                              </GestureHandlerRootView>
                            </DeleteMyDataProvider>
                          </NotificationProvider>
                        </IssueQueueProvider>
                      </ReportQueueProvider>
                    </AppSettingsProvider>
                  </LocationProvider>
                </OfflineProvider>
              </DeviceProvider>
            </LanguageProvider>
          </ErrorBoundary>
          </CelebrationSettingsProvider>
        </AppearanceProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
