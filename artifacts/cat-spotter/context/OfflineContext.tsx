import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createSighting } from '@workspace/api-client-react';
import { photoRejectionKey } from '@/lib/photoRejection';
import {
  optimizePhotoForUpload,
  shouldOptimizePhoto,
  type UploadNetworkState,
} from '@/lib/photoUpload';
import {
  backupQueueText,
  cleanupOrphanPhotos,
  deletePendingPhoto,
  durablePhotos,
  isStoredPhotoRef,
  moveInlinePhotoToStore,
  openPhotoForUpload,
  readPendingPhoto,
  pruneQueueBackups,
  replacementPhotoKey,
  savePendingPhoto,
  supportsPhotoFiles,
  type SavePhotoResult,
} from '@/lib/pendingPhotos';
import {
  QueueWriteError,
  createQueueStore,
  parseQueue,
  type LoadContext,
  type QueueStore,
} from '@/lib/queueStore';
import {
  QUEUE_LOCK,
  UPLOAD_LOCK,
  ifLockFree,
  withLock,
} from '@/lib/webLocks';
import { useDevice } from './DeviceContext';
import {
  applyServerFailure,
  classifySyncFailure,
  markStaleItems,
  resetForRetry,
  type PendingSighting,
} from '../lib/offlineQueue';

export type { PendingSighting };
export { QueueWriteError, isQueueWriteError } from '@/lib/queueStore';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

/** What callers provide when queueing — always includes the photo base64. */
export type EnqueueInput = Omit<PendingSighting, 'status' | 'photoBase64'> & {
  photoBase64: string;
};

export interface ReplacementPhoto {
  photoBase64: string;
  photoUri: string;
}

interface OfflineContextValue {
  isOnline: boolean;
  /** True when uploads should use a smaller temporary photo representation. */
  isConstrainedNetwork: boolean;
  /** False until the saved queue has been loaded. */
  ready: boolean;
  /**
   * The saved queue could not be read, so nothing can be queued this session
   * (rather than overwrite it). Sending online still works.
   */
  readOnly: boolean;
  pending: PendingSighting[];
  /** Throws QueueWriteError if the sighting could not be saved. */
  enqueue: (item: EnqueueInput) => Promise<void>;
  /** Throws QueueWriteError if the change could not be saved. */
  remove: (localId: string) => Promise<void>;
  /** Put a failed item back in the queue and try syncing again. */
  retry: (localId: string) => Promise<void>;
  /**
   * Replace a rejected item's photo while preserving its capture metadata.
   * Throws QueueWriteError if the change could not be saved.
   */
  replacePhoto: (localId: string, photo: ReplacementPhoto) => Promise<void>;
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

/**
 * The one-off move of photos already queued inline on testers' phones into
 * the web photo store (spec §3.3). Runs inside the load, before `ready`.
 *
 *  1. Backup first: the saved text, exactly as stored, goes to the backups
 *     store. If that cannot be written, NOTHING moves on this load.
 *  2. Each photo in turn: decode, save, read back. A photo that cannot be
 *     decoded or saved — including "data:," from the old camera — stays
 *     inline and is retried next load. It never throws out of the move.
 *  3. Strip only what was verified, through the write path, which re-reads
 *     the list: anything added meanwhile survives.
 *
 * Legacy camera captures (a data URL in both fields) are normalised here:
 * their photoUri becomes the reference, which closes the route crash for
 * old queued items.
 */
async function moveInlinePhotosOnWeb(ctx: LoadContext): Promise<void> {
  // A browser that cannot keep photos durably keeps them inline (R3).
  if (!(await durablePhotos())) return;
  await pruneQueueBackups();

  const raw = await ctx.readRaw();
  const parsed = parseQueue(raw);
  if (raw === null || !parsed.ok) return;
  const inline = parsed.items.filter((p) => p.photoBase64);
  if (inline.length === 0) return;

  if (!(await backupQueueText(raw, 'move'))) return;

  const verified = new Map<string, { ref: string; inline: string }>();
  for (const item of inline) {
    const photo = item.photoBase64 as string;
    try {
      const ref = await moveInlinePhotoToStore(item.localId, photo);
      if (ref) verified.set(item.localId, { ref, inline: photo });
    } catch {
      // Stays inline; retried next load.
    }
  }
  if (verified.size === 0) return;

  await ctx.mutate((list) => {
    let changed = false;
    const next = list.map((p) => {
      const moved = verified.get(p.localId);
      // Only the exact photo that was verified — never one changed since.
      if (!moved || p.photoBase64 !== moved.inline) return p;
      changed = true;
      return { ...p, photoBase64: undefined, photoUri: moved.ref };
    });
    return changed ? next : list;
  });
}

/** A list that cannot be parsed is kept, untouched, in the backups store too. */
async function backUpUnparseableQueue(raw: string): Promise<void> {
  if (supportsPhotoFiles) return;
  if (!(await durablePhotos())) return;
  await backupQueueText(raw, 'unparseable');
}

/**
 * Runs inside the load, after the parsed list is in memory and before any
 * writer is let in. Each step is contained: a failure in one never stops the
 * others, and never takes the parsed list out of memory.
 */
async function prepareLoadedQueue(ctx: LoadContext): Promise<void> {
  // Flag very old queued items as stale — they can never sync.
  await ctx
    .mutate((list) => {
      const stale = markStaleItems(list, Date.now());
      return stale.changed ? stale.items : list;
    })
    .catch(() => undefined);

  if (!supportsPhotoFiles) {
    await moveInlinePhotosOnWeb(ctx).catch(() => undefined);
  }

  // Move any legacy inline base64 photos into document storage. Each photo is
  // saved on its own; only the ones that saved are stripped, and the strip
  // re-reads the list, so nothing added meanwhile can be lost.
  if (supportsPhotoFiles) {
    const moved = new Map<string, string>();
    for (const item of ctx.items()) {
      if (!item.photoBase64) continue;
      try {
        const saved = await savePendingPhoto(
          item.localId,
          item.photoUri,
          item.photoBase64,
        );
        if (saved.ok) moved.set(item.localId, saved.ref);
      } catch {
        // Stays inline; retried next load.
      }
    }
    if (moved.size > 0) {
      await ctx
        .mutate((list) => {
          let changed = false;
          const next = list.map((p) => {
            const fileUri = moved.get(p.localId);
            if (!fileUri || !p.photoBase64) return p;
            changed = true;
            return { ...p, photoBase64: undefined, photoUri: fileUri };
          });
          return changed ? next : list;
        })
        .catch(() => undefined);
    }
  }

  // Drop photos that no queue item references anymore. This runs before
  // `ready`, so no writer in this tab can have saved a photo it has not yet
  // listed. An item still inline keeps the copy the move may have written
  // for it (it is stripped only after a later read-back).
  const keep = ctx
    .items()
    .flatMap((p) =>
      p.photoBase64 ? [p.photoUri, `idb:${p.localId}`] : [p.photoUri],
    );
  await cleanupOrphanPhotos(keep).catch(() => undefined);
}

function markReview(
  localId: string,
  result: Pick<PendingSighting, 'sightingId' | 'isCatPhoto' | 'candidates'>,
) {
  return (list: PendingSighting[]) =>
    list.map((p) =>
      p.localId === localId && p.status === 'queued'
        ? {
            ...p,
            status: 'review' as const,
            sightingId: result.sightingId,
            isCatPhoto: result.isCatPhoto,
            candidates: result.candidates,
          }
        : p,
    );
}

function markStatus(localId: string, patch: Partial<PendingSighting>) {
  return (list: PendingSighting[]) =>
    list.map((p) =>
      p.localId === localId && p.status === 'queued' ? { ...p, ...patch } : p,
    );
}

type SyncOutcome = 'synced' | 'network' | 'done';

/**
 * What a failed photo save means for a sighting the user is saving now.
 * `unavailable` (no photo store here) keeps the photo inline, as always. On
 * web a store that is available but failed is reported honestly (review F1)
 * rather than stuffed into the ~5 MB list. Native keeps its long-standing
 * inline fallback for a failed file write (spec §4: native photo storage does
 * not change); the list save then succeeds or fails honestly on its own.
 */
function keepInlineUnlessBroken(saved: SavePhotoResult): SavePhotoResult {
  if (!saved.ok && saved.reason === 'failed' && !supportsPhotoFiles) {
    throw new QueueWriteError('failed');
  }
  return saved;
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { deviceId } = useDevice();
  const [isOnline, setIsOnline] = useState(true);
  const [networkState, setNetworkState] = useState<UploadNetworkState | null>(
    null,
  );
  const [pending, setPending] = useState<PendingSighting[]>([]);
  const [ready, setReady] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reviewPromptVisible, setReviewPromptVisible] = useState(false);
  const syncingRef = useRef(false);
  const networkStateRef = useRef<UploadNetworkState | null>(null);

  const storeRef = useRef<QueueStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createQueueStore({
      read: () => AsyncStorage.getItem(QUEUE_KEY),
      write: (raw) => AsyncStorage.setItem(QUEUE_KEY, raw),
      withLock: (fn) => withLock(QUEUE_LOCK, fn),
      publish: setPending,
    });
  }
  const store = storeRef.current;

  /** Upload one queued item and record the outcome through the write path. */
  const syncOne = useCallback(
    async (localId: string, device: string): Promise<SyncOutcome> => {
      // Changed or gone since the sync started (resolved, discarded, or
      // handled by another tab): leave it alone.
      const item = store.items().find((p) => p.localId === localId);
      if (!item || item.status !== 'queued') return 'done';

      // Load the photo — from the stored reference, or inline base64 where
      // it never left the list.
      let photoBase64 = item.photoBase64;
      if (!photoBase64) {
        const read = await readPendingPhoto(item.photoUri);
        if (read.status === 'error') {
          // Could not read it this time; leave it queued for the next sync.
          return 'done';
        }
        if (read.status === 'missing') {
          // The photo is gone — this item can never upload. On web that means
          // the browser cleared it, which is not the same as "too old".
          await store.mutate(
            markStatus(localId, {
              status: 'error',
              errorKind: isStoredPhotoRef(item.photoUri) ? 'cleared' : 'stale',
            }),
            'system',
          );
          return 'done';
        }
        photoBase64 = read.base64;
      }

      let uploadPhotoBase64 = photoBase64;
      if (shouldOptimizePhoto(networkStateRef.current)) {
        // The shrink step must be given something it can load: on web, an
        // object URL made from the stored or inline bytes (review F9).
        const source = await openPhotoForUpload(item.photoUri, item.photoBase64);
        if (source) {
          try {
            const optimized = await optimizePhotoForUpload(source.uri);
            if (optimized) uploadPhotoBase64 = optimized;
          } finally {
            source.release();
          }
        }
      }

      let result;
      try {
        result = await createSighting({
          deviceId: device,
          photoBase64: uploadPhotoBase64,
          lat: item.lat,
          lng: item.lng,
          // This item may have sat in the queue for days. Send the time the
          // photo was actually taken, or the streak credits the day the
          // network came back instead of the day the cat was spotted.
          capturedAt: item.createdAt,
        });
      } catch (err) {
        const rejectionKey = photoRejectionKey(err);
        if (rejectionKey) {
          // Permanent rejection (bad format / too large) — retrying will
          // never succeed, so mark it rejected and move on.
          await store.mutate(
            markStatus(localId, { status: 'rejected', rejectionKey }),
            'system',
          );
          return 'done';
        }
        const decision = classifySyncFailure(err, item.failCount);
        if (decision.kind === 'server') {
          // The server responded but rejected the sighting — count the
          // failure and flag the item once it keeps failing.
          await store.mutate(
            (list) => applyServerFailure(list, localId, decision),
            'system',
          );
          return 'done';
        }
        // Network failure — still offline, keep everything queued.
        return 'network';
      }

      // The sighting now exists on the server. This change always reaches
      // memory, even if it cannot be saved, so it is never sent twice.
      await store.mutate(markReview(localId, result), 'system');
      return 'synced';
    },
    [store],
  );

  const syncNow = useCallback(async () => {
    try {
      // Nothing is known about the queue until it has loaded.
      await store.ready;
      if (syncingRef.current || !deviceId) return;
      syncingRef.current = true;
      let syncedAny = false;
      try {
        // Only one open tab uploads at a time.
        await ifLockFree(UPLOAD_LOCK, async () => {
          await store.refresh();
          const queued = store
            .items()
            .filter((p) => p.status === 'queued')
            .map((p) => p.localId);
          if (queued.length === 0) return;
          setSyncing(true);
          for (const localId of queued) {
            let outcome: SyncOutcome;
            try {
              outcome = await syncOne(localId, deviceId);
            } catch {
              // One item's failure never stops the others.
              outcome = 'done';
            }
            if (outcome === 'synced') syncedAny = true;
            if (outcome === 'network') break;
          }
        });
      } finally {
        syncingRef.current = false;
        setSyncing(false);
        if (syncedAny) {
          setReviewPromptVisible(true);
        }
      }
    } catch {
      // Callers (NetInfo) do not await this; never leave a rejection behind.
    }
  }, [deviceId, store, syncOne]);

  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  useEffect(() => {
    store
      .load({
        afterParse: prepareLoadedQueue,
        onUnparseable: backUpUnparseableQueue,
      })
      .then(() => {
        setReady(true);
        setReadOnly(store.isReadOnly());
        // Anything moved or marked during the load can go now.
        if (networkStateRef.current?.isConnected) {
          void syncNowRef.current();
        }
      });
  }, [store]);

  // Another tab changed the saved list: pick it up.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (typeof window.addEventListener !== 'function') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === QUEUE_KEY) {
        void store.refresh();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const uploadNetwork = state as UploadNetworkState;
      networkStateRef.current = uploadNetwork;
      setNetworkState(uploadNetwork);
      const online = !!state.isConnected;
      setIsOnline(online);
      if (online) {
        void syncNow();
      }
    });
    return unsubscribe;
  }, [syncNow]);

  const enqueue = useCallback(
    async (item: EnqueueInput) => {
      await store.ready;
      // Store the photo outside the list so the list stays small.
      const saved = keepInlineUnlessBroken(
        await savePendingPhoto(item.localId, item.photoUri, item.photoBase64),
      );
      const stored: PendingSighting = saved.ok
        ? {
            ...item,
            photoBase64: undefined,
            photoUri: saved.ref,
            status: 'queued' as const,
          }
        : { ...item, status: 'queued' as const };
      await store.mutate(
        (list) => [...list.filter((p) => p.localId !== stored.localId), stored],
        'user',
      );
    },
    [store],
  );

  const remove = useCallback(
    async (localId: string) => {
      let removed: PendingSighting | undefined;
      await store.mutate((list) => {
        removed = list.find((p) => p.localId === localId);
        return removed ? list.filter((p) => p.localId !== localId) : list;
      }, 'user');
      // Only once the list no longer refers to it.
      const gone = removed as PendingSighting | undefined;
      if (gone && !gone.photoBase64) {
        deletePendingPhoto(gone.photoUri).catch(() => {});
      }
    },
    [store],
  );

  const retry = useCallback(
    async (localId: string) => {
      await store.mutate((list) => resetForRetry(list, localId), 'user');
      await syncNowRef.current();
    },
    [store],
  );

  const replacePhoto = useCallback(
    async (localId: string, photo: ReplacementPhoto) => {
      await store.ready;
      const current = store.items().find((p) => p.localId === localId);
      if (!current || current.status !== 'rejected') return;

      // A new key, never the original's: a failed replacement must not touch
      // the photo it replaces.
      const saved = keepInlineUnlessBroken(
        await savePendingPhoto(
          replacementPhotoKey(localId, current.photoUri),
          photo.photoUri,
          photo.photoBase64,
        ),
      );
      let replaced: PendingSighting | undefined;
      let replacement: PendingSighting | undefined;
      await store.mutate(
        (list) =>
          list.map((p) => {
            if (p.localId !== localId || p.status !== 'rejected') return p;
            replaced = p;
            replacement = {
              ...p,
              photoUri: saved.ok ? saved.ref : photo.photoUri,
              photoBase64: saved.ok ? undefined : photo.photoBase64,
              status: 'queued',
              rejectionKey: undefined,
              errorKind: undefined,
              failCount: 0,
              sightingId: undefined,
              isCatPhoto: undefined,
              candidates: undefined,
            };
            return replacement;
          }),
        'user',
      );
      // The old photo goes only once the list no longer refers to it.
      const before = replaced as PendingSighting | undefined;
      const after = replacement as PendingSighting | undefined;
      if (
        before &&
        after &&
        !before.photoBase64 &&
        before.photoUri !== after.photoUri
      ) {
        deletePendingPhoto(before.photoUri).catch(() => {});
      }
      await syncNowRef.current();
    },
    [store],
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
      isConstrainedNetwork: shouldOptimizePhoto(networkState),
      ready,
      readOnly,
      pending,
      enqueue,
      remove,
      retry,
      replacePhoto,
      syncNow,
      syncing,
      reviewReadyCount,
      reviewPromptVisible,
      dismissReviewPrompt,
    }),
    [
      isOnline,
      networkState,
      ready,
      readOnly,
      pending,
      enqueue,
      remove,
      retry,
      replacePhoto,
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
