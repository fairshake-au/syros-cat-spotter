import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { getGetProfileQueryKey, useGetProfile } from '@workspace/api-client-react';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';
import { useCelebration } from '@/context/CelebrationContext';

/**
 * Where the one-time offer may open: screens where the spotter is resting,
 * not in the middle of something. The first badge arrives on the review
 * screen's "well done", so the offer waits until they tap through to the cat
 * (SYC-502), and it never opens over the camera, a report or a restore.
 */
export function canOfferHere(pathname: string): boolean {
  return pathname === '/' || pathname === '/cats' || pathname === '/profile' || pathname.startsWith('/cat/');
}

/**
 * SYC-3: "keep my spots safe" offered once more when a spotter who skipped it
 * at onboarding first has something to lose, their first badge
 * (email-capture.md §8.3). Declining is one tap, and it's never asked again.
 *
 * SYC-502: it opens as its own screen on top of the app, never in place of
 * it, so the first sighting's "well done" and its questions are seen first,
 * and Skip or Save goes back to where they were (the cat's page).
 */
export function FirstBadgeOffer() {
  const { deviceId, keepSafeOffer, setKeepSafeOffer } = useDevice();
  const { isOnline } = useOffline();
  const pathname = usePathname();
  // The offer opens after a celebration closes, never over it.
  const { pending: celebrating } = useCelebration();
  const offered = useRef(false);
  const waiting = keepSafeOffer === 'skipped-onboarding';
  const profile = useGetProfile(deviceId ?? '', {
    query: {
      enabled: waiting && !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const badges = profile.data?.badges;
  const hasBadge = Array.isArray(badges) && badges.length > 0;

  useEffect(() => {
    if (!waiting || !hasBadge || offered.current || !canOfferHere(pathname) || celebrating) return;
    offered.current = true;
    // Offered counts as asked: leaving the screen any way (Skip, Save, the
    // back gesture) never brings it back.
    setKeepSafeOffer('done');
    router.push({ pathname: '/keep-safe', params: { surface: 'first_badge' } });
  }, [waiting, hasBadge, pathname, celebrating, setKeepSafeOffer]);

  return null;
}
