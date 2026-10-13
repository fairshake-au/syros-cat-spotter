import React from 'react';
import { router } from 'expo-router';
import { RestoreRequestScreen } from '@/components/keepSafe/RestoreRequestScreen';
import { RestoreWarning } from '@/components/keepSafe/RestoreWarning';
import { useDevice } from '@/context/DeviceContext';

/**
 * Settings → Get your spots back (Decision 7). On a phone that already has a
 * spotter, the warning naming that spotter comes first; then the ordinary
 * email-and-button restore. Nothing is merged.
 */
export default function GetSpotsBackRoute() {
  const { username } = useDevice();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <RestoreRequestScreen
      onBack={leave}
      intro={username ? <RestoreWarning current={username} /> : null}
    />
  );
}
