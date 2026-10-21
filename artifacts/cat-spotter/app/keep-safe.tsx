import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { KeepSafeScreen } from '@/components/keepSafe/KeepSafeScreen';
import { useDevice } from '@/context/DeviceContext';
import { KEEP_SAFE_QUERY_ROOT } from '@/components/keepSafe/KeepSafeSettings';

/**
 * Settings → Keep my spots safe → Add an email / Change (SYC-3 plan step 8),
 * and the one-time offer at the first badge (`?surface=first_badge`, opened by
 * FirstBadgeOffer, SYC-502). The offer has no back arrow: Skip is the way on,
 * back to where the spotter was.
 */
export default function KeepSafeRoute() {
  const queryClient = useQueryClient();
  const { setKeepSafeOffer } = useDevice();
  const { surface } = useLocalSearchParams<{ surface?: string }>();
  const firstBadge = surface === 'first_badge';
  const fallback = firstBadge ? '/' : '/profile';
  const leave = () => (router.canGoBack() ? router.back() : router.replace(fallback));
  return (
    <KeepSafeScreen
      surface={firstBadge ? 'first_badge' : 'settings'}
      onBack={firstBadge ? undefined : leave}
      onSkip={leave}
      onSaved={() => {
        setKeepSafeOffer('done');
        void queryClient.invalidateQueries({ queryKey: KEEP_SAFE_QUERY_ROOT });
        leave();
      }}
    />
  );
}
