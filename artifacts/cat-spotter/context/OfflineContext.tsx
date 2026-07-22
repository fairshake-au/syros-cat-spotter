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
import { useDevice } from './DeviceContext';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

export interface PendingSighting {
  localId: string;
  photoBase64: string;
  photoUri: string;
  lat: number;
  lng: number;
  createdAt: string;
  status: 'queued' | 'review';
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
          setPending(JSON.parse(raw) as PendingSighting[]);
        } catch {
          // corrupted queue — drop it
        }
      }
    });
  }, []);

  const persist = useCallback(async (items: PendingSighting[]) => {
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
        } catch {
          // still offline or server error — keep queued
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
