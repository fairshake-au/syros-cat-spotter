import React, { useState } from 'react';
import { router } from 'expo-router';
import { RestoreRequestScreen } from '@/components/keepSafe/RestoreRequestScreen';
import { RestoreWarning } from '@/components/keepSafe/RestoreWarning';
import { readWaiting } from '@/lib/restoreWaiting';
import { useDevice } from '@/context/DeviceContext';

/**
 * Settings → Get your spots back (Decision 7). On a phone that already has a
 * spotter, the warning naming that spotter comes first; then the ordinary
 * email-and-button restore. Nothing is merged.
 */
export default function GetSpotsBackRoute() {
  const { username } = useDevice();
  // SYC-664: a live "waiting for a code" note at mount opens on the code box,
  // after a real request only, as the automatic reopen does (M8).
  const [startOnCode] = useState(() => (readWaiting()?.requests ?? 0) >= 1);
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <RestoreRequestScreen
      onBack={leave}
      startOnCode={startOnCode}
      intro={username ? <RestoreWarning current={username} /> : null}
    />
  );
}
