import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { readWaiting } from '@/lib/restoreWaiting';

/**
 * SYC-664: an iPhone home-screen app can reload while its person is in Mail
 * fetching their code. A phone that already has a name and a live "waiting for
 * a code" note (read once, when the app starts) is sent to the code box, once
 * per app start, so pressing Back from there never bounces them in again.
 * `ready` is true once the device is loaded and the normal screens are showing.
 */
export function useReopenRestoreCode(ready: boolean, pathname: string): void {
  const [live] = useState(() => readWaiting() !== null);
  const handled = useRef(false);
  useEffect(() => {
    if (!ready || !live || handled.current) return;
    handled.current = true;
    if (pathname === '/get-spots-back' || pathname === '/restore') return;
    router.replace('/get-spots-back');
  }, [ready, live, pathname]);
}
