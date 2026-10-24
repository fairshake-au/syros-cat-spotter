import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import {
  getGetProfileQueryKey,
  listBadgeMoments,
  markMomentCelebrated,
  useGetProfile,
  type BadgeMoment,
} from '@workspace/api-client-react';
import { BadgeCelebration } from '@/components/celebration/BadgeCelebration';
import { canOfferHere } from '@/components/keepSafe/FirstBadgeOffer';
import { badgeViews } from '@/lib/badgeProgress';
import { registerWeeklyResultHandler } from '@/lib/celebrationBus';
import { useDevice } from '@/context/DeviceContext';
import { useOffline } from '@/context/OfflineContext';

const FIRST_LOOK_MS = 5000;

interface CelebrationValue {
  /** A celebration is queued or playing: other one-time offers wait. */
  pending: boolean;
  /** The review screen plays this moment itself, so the queue skips it. */
  claimMoment: (id: number) => void;
}

const CelebrationContext = createContext<CelebrationValue>({
  pending: false,
  claimMoment: () => {},
});

export function useCelebration(): CelebrationValue {
  return useContext(CelebrationContext);
}

/**
 * SYC-706: plays the badge celebrations the server has queued (badges earned
 * while the app was closed, last week's result, the launch-day history),
 * oldest first, one at a time, only on a resting screen. Fetched on app open
 * and on resume, online only; nothing waits on the fetch.
 */
export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useDevice();
  const { isOnline } = useOffline();
  const pathname = usePathname();
  const [queue, setQueue] = useState<BadgeMoment[]>([]);
  const [claimed, setClaimed] = useState<ReadonlySet<number>>(new Set());
  // A tapped weekly result may play from the notifications screen too.
  const [forced, setForced] = useState(false);
  // Until the first answer is in, a celebration may be on its way.
  const [asked, setAsked] = useState(false);
  const finished = useRef(new Set<number>());
  const inFlight = useRef<Promise<BadgeMoment[]> | null>(null);

  const fetchMoments = useCallback((): Promise<BadgeMoment[]> => {
    if (!deviceId || !isOnline) return Promise.resolve([]);
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const res = await listBadgeMoments(deviceId);
        const rows = Array.isArray(res?.moments) ? res.moments : [];
        const fresh = rows.filter((m) => !finished.current.has(m.id));
        setQueue(fresh);
        return fresh;
      } catch {
        // Offline or the server is busy: nothing is lost, the next open asks again.
        return [];
      } finally {
        inFlight.current = null;
        setAsked(true);
      }
    })();
    inFlight.current = run;
    return run;
  }, [deviceId, isOnline]);

  useEffect(() => {
    void fetchMoments();
  }, [fetchMoments]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchMoments();
    });
    return () => sub.remove();
  }, [fetchMoments]);

  // A hung request never holds the offer back for long.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(true), FIRST_LOOK_MS);
    return () => clearTimeout(timer);
  }, []);

  const claimedRef = useRef(claimed);
  claimedRef.current = claimed;
  useEffect(
    () =>
      registerWeeklyResultHandler(async () => {
        const rows = await fetchMoments();
        const has = rows.some((m) => m.kind === 'week_result' && !claimedRef.current.has(m.id));
        if (has) setForced(true);
        return has;
      }),
    [fetchMoments],
  );

  const claimMoment = useCallback((id: number) => {
    setClaimed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const current = queue.find((m) => !claimed.has(m.id)) ?? null;
  const restingHere = canOfferHere(pathname) || (forced && pathname === '/notifications');

  const profile = useGetProfile(deviceId ?? '', {
    query: {
      enabled: !!current && !!deviceId && isOnline,
      queryKey: getGetProfileQueryKey(deviceId ?? ''),
    },
  });
  const views = badgeViews(profile.data);
  const ready = !!current && restingHere && !profile.isFetching && !!views;

  const onDone = useCallback(() => {
    if (!current || !deviceId) return;
    finished.current.add(current.id);
    setQueue((q) => q.filter((m) => m.id !== current.id));
    setForced(false);
    markMomentCelebrated(deviceId, current.id).catch(() => {});
  }, [current, deviceId]);

  // Offers like "keep my spots safe" wait while a celebration is queued, or
  // while the first look at the queue is still on its way.
  const pending = !!current || (!!deviceId && isOnline && !asked);
  const value = useMemo(() => ({ pending, claimMoment }), [pending, claimMoment]);

  return (
    <CelebrationContext.Provider value={value}>
      {children}
      {ready && current && views ? (
        <BadgeCelebration
          key={current.id}
          moment={{
            kind: current.kind,
            badgeIds: current.badgeIds,
            place: current.place,
            weekPoints: current.weekPoints,
          }}
          views={views}
          onDone={onDone}
        />
      ) : null}
    </CelebrationContext.Provider>
  );
}
