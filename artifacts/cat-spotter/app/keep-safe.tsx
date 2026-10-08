import React from 'react';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { KeepSafeScreen } from '@/components/keepSafe/KeepSafeScreen';
import { useDevice } from '@/context/DeviceContext';
import { KEEP_SAFE_QUERY_ROOT } from '@/components/keepSafe/KeepSafeSettings';

/** Settings → Keep my spots safe → Add an email / Change (SYC-3 plan step 8). */
export default function KeepSafeRoute() {
  const queryClient = useQueryClient();
  const { setKeepSafeOffer } = useDevice();
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <KeepSafeScreen
      surface="settings"
      onBack={leave}
      onSkip={leave}
      onSaved={() => {
        setKeepSafeOffer('done');
        void queryClient.invalidateQueries({ queryKey: KEEP_SAFE_QUERY_ROOT });
        leave();
      }}
    />
  );
}
