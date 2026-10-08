import React from 'react';
import { router } from 'expo-router';
import { useGetProfile, getGetProfileQueryKey } from '@workspace/api-client-react';
import { RestoreRequestScreen } from '@/components/keepSafe/RestoreRequestScreen';
import { RestoreWarning } from '@/components/keepSafe/RestoreWarning';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';

/**
 * Settings → Get your spots back (Decision 7). On a phone that already has a
 * spotter, the warning naming that spotter comes first; then the ordinary
 * email-and-button restore. Nothing is merged.
 */
export default function GetSpotsBackRoute() {
  const { deviceId, username } = useDevice();
  const { isOnline } = useOffline();
  const profile = useGetProfile(deviceId ?? '', {
    query: { enabled: !!deviceId && !!username && isOnline, queryKey: getGetProfileQueryKey(deviceId ?? '') },
  });
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <RestoreRequestScreen
      onBack={leave}
      intro={username ? <RestoreWarning current={username} spots={profile.data?.totalSightings ?? 0} /> : null}
    />
  );
}
