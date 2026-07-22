import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createSighting, type MatchCandidate } from '@workspace/api-client-react';
import { photoRejectionKey } from '@/lib/photoRejection';
import { useDevice } from './DeviceContext';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

/** Server-error retries before an item is marked failed. */
const MAX_SYNC_ATTEMPTS = 3;
/** Queued items older than this are flagged as stale and can never sync. */
const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PendingSighting {
  localId: string;
  photoBase64: string;
  photoUri: string;
  lat: number;
  lng: number;
  createdAt: string;
  status: 'queued' | 'review' | 'error' | 'rejected';
  /** Why the item is in the error state. */
  errorKind?: 'server' | 'stale';
  /** Consecutive server-error sync failures. */
  failCount?: number;
  // Translation key explaining a permanent server rejection:
  rejectionKey?: string;
  // Populated once synced with the server:
  sightingId?: number;
  isCatPhoto?: boolean;
  candidates?: MatchCandidate[];
}

interface OfflineContextValue {
  isOnline: boolean;
  pending: PendingSighting[];
  enqueue: (item: Omit<PendingSighting, 'status'>) => Promise<void>;
  remove: (localId: string) => Promise<void>;
  /** Put a failed item back in the queue and try syncing again. */
  retry: (localId: string) => Promise<void>;
  syncNow: () => Promise<void>;
  syncing: boolean;
  /** Number of synced sightings waiting for the user's review. */
  reviewReadyCount: number;
  /** True right after queued sightings finish syncing, until dismissed. */
  reviewPromptVisible: boolean;
  dismissReviewPrompt: () => void;
}

const OfflineContext = createContext<OfflineContextValue | undefined>(
  undefined,
);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useDevice();
  const [isOnline, setIsOnline] = useState(true);
  const [pending, setPending] = useState<PendingSighting[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [reviewPromptVisible, setReviewPromptVisible] = useState(false);
  const syncingRef = useRef(false);
  const pendingRef = useRef<PendingSighting[]>([]);
  pendingRef.current = pending;

  useEffect(() => {
    AsyncStorage.getItem(QUEUE_KEY).then((raw) => {
      if (raw) {
        try {
          const items = JSON.parse(raw) as PendingSighting[];
          // Flag very old queued items as stale — they can never sync.
          const now = Date.now();
          let changed = false;
          const next = items.map((p) => {
            if (
              p.status === 'queued' &&
              now - new Date(p.createdAt).getTime() > MAX_QUEUE_AGE_MS
            ) {
              changed = true;
              return { ...p, status: 'error' as const, errorKind: 'stale' as const };
            }
            return p;
          });
          setPending(next);
          if (changed) {
            AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next)).catch(() => {});
          }
        } catch {
          // corrupted queue — drop it
        }
      }
    });
  }, []);

  const persist = useCallback(async (items: PendingSighting[]) => {
    pendingRef.current = items;
    setPending(items);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current || !deviceId) return;
    const queued = pendingRef.current.filter((p) => p.status === 'queued');
    if (queued.length === 0) return;
    syncingRef.current = true;
    setSyncing(true);
    let syncedAny = false;
    try {
      let items = [...pendingRef.current];
      for (const item of queued) {
        try {
          const result = await createSighting({
            deviceId,
            photoBase64: item.photoBase64,
            lat: item.lat,
            lng: item.lng,
          });
          items = items.map((p) =>
            p.localId === item.localId
              ? {
                  ...p,
                  status: 'review' as const,
                  sightingId: result.sightingId,
                  isCatPhoto: result.isCatPhoto,
                  candidates: result.candidates,
                }
              : p,
          );
          await persist(items);
          syncedAny = true;
        } catch (err) {
          const rejectionKey = photoRejectionKey(err);
          if (rejectionKey) {
            // Permanent rejection (bad format / too large) — retrying will
            // never succeed, so mark it rejected and move on.
            items = items.map((p) =>
              p.localId === item.localId
                ? { ...p, status: 'rejected' as const, rejectionKey }
                : p,
            );
            await persist(items);
            continue;
          }
          const isServerError =
            err instanceof Error && err.name === 'ApiError';
          if (isServerError) {
            // The server responded but rejected the sighting — count the
            // failure and flag the item once it keeps failing.
            const failCount = (item.failCount ?? 0) + 1;
            const status =
              err !== null &&
              typeof err === 'object' &&
              'status' in err &&
              typeof (err as { status?: unknown }).status === 'number'
                ? (err as { status: number }).status
                : 0;
            const permanent =
              (status >= 400 && status < 500) || failCount >= MAX_SYNC_ATTEMPTS;
            items = items.map((p) =>
              p.localId === item.localId
                ? permanent
                  ? { ...p, status: 'error' as const, errorKind: 'server' as const, failCount }
                  : { ...p, failCount }
                : p,
            );
            await persist(items);
            // Move on — other queued items may still succeed.
            continue;
          }
          // Network failure — still offline, keep everything queued.
          break;
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      if (syncedAny) {
        setReviewPromptVisible(true);
      }
    }
  }, [deviceId, persist]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      setIsOnline(online);
      if (online) {
        syncNow();
      }
    });
    return unsubscribe;
  }, [syncNow]);

  const enqueue = useCallback(
    async (item: Omit<PendingSighting, 'status'>) => {
      await persist([
        ...pendingRef.current,
        { ...item, status: 'queued' as const },
      ]);
    },
    [persist],
  );

  const remove = useCallback(
    async (localId: string) => {
      await persist(pendingRef.current.filter((p) => p.localId !== localId));
    },
    [persist],
  );

  const retry = useCallback(
    async (localId: string) => {
      await persist(
        pendingRef.current.map((p) =>
          p.localId === localId
            ? { ...p, status: 'queued' as const, errorKind: undefined, failCount: 0 }
            : p,
        ),
      );
      await syncNow();
    },
    [persist, syncNow],
  );

  const dismissReviewPrompt = useCallback(() => {
    setReviewPromptVisible(false);
  }, []);

  const reviewReadyCount = useMemo(
    () => pending.filter((p) => p.status === 'review').length,
    [pending],
  );

  // Hide the prompt automatically once nothing is left to review.
  useEffect(() => {
    if (reviewReadyCount === 0) {
      setReviewPromptVisible(false);
    }
  }, [reviewReadyCount]);

  const value = useMemo(
    () => ({
      isOnline,
      pending,
      enqueue,
      remove,
      retry,
      syncNow,
      syncing,
      reviewReadyCount,
      reviewPromptVisible,
      dismissReviewPrompt,
    }),
    [
      isOnline,
      pending,
      enqueue,
      remove,
      retry,
      syncNow,
      syncing,
      reviewReadyCount,
      reviewPromptVisible,
      dismissReviewPrompt,
    ],
  );

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
