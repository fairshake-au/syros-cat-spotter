import { useEffect, useRef } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { readWaiting } from '@/lib/restoreWaiting';

export type ReopenGateState = {
  isReady: boolean;
  isLanguageReady: boolean;
  startupError: boolean;
  doneVisible: boolean;
  moved: boolean;
  /** The one-time "keep my spots safe" screen is showing instead of the app. */
  offerScreenShowing: boolean;
};

/** True once the gate is showing the ordinary app (named or not), the moment to decide. */
export function restoreReopenReady(g: ReopenGateState): boolean {
  return g.isReady && g.isLanguageReady && !g.startupError && !g.doneVisible && !g.moved && !g.offerScreenShowing;
}

/**
 * SYC-664: an iPhone home-screen app can reload while its person is in Mail
 * fetching their code. Decided exactly once, on the first render where the gate
 * is ready: if the phone has a name and a live "waiting for a code" note (read
 * fresh at that moment) and isn't already on the restore screens, it is sent
 * to the code box. The replace itself waits for the root navigator. A phone
 * without a name at that moment is never redirected later (OnboardingFlow
 * handles it), so Back from the code screen never loops.
 */
export function useReopenRestoreCode(ready: boolean, hasName: boolean, pathname: string): void {
  const navKey = useRootNavigationState()?.key;
  const decided = useRef(false);
  const go = useRef(false);
  const sent = useRef(false);
  useEffect(() => {
    if (ready && !decided.current) {
      decided.current = true;
      go.current =
        hasName && pathname !== '/get-spots-back' && pathname !== '/restore' && readWaiting() !== null;
    }
    if (go.current && !sent.current && navKey) {
      sent.current = true;
      router.replace('/get-spots-back');
    }
  }, [ready, hasName, pathname, navKey]);
}
