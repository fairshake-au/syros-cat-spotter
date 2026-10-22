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
import { photoRejectionKey, rejectedPhotoRole } from '@/lib/photoRejection';
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
  deleteAllSightingPhotos,
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
  extrasOf,
  hintOf,
  markStaleItems,
  resetForRetry,
  type ExtraRef,
  type PendingSighting,
} from '../lib/offlineQueue';
import type { ExtraRole } from '@/lib/extraPhotos';

export type { PendingSighting };
export { QueueWriteError, isQueueWriteError } from '@/lib/queueStore';

const QUEUE_KEY = 'cat-spotter/pending-sightings';

/** One extra photo as the Spot screen hands it over: the prepared copy (SYC-415). */
export interface EnqueueExtra {
  role: ExtraRole;
  photoUri: string;
  photoBase64: string;
}

/** What callers provide when queueing — always includes the photo base64. */
export type EnqueueInput = Omit<
  PendingSighting,
  'status' | 'photoBase64' | 'extraPhotos' | 'extraNote' | 'rejectedRole' | 'hintCatId'
> & {
  photoBase64: string;
  extraPhotos?: EnqueueExtra[];
};

/**
 * SYC-415: `extraNotKept` is true when an extra photo couldn't be stored
 * outside the list, so the spot was queued without it (never inline).
 */
export interface EnqueueResult {
  extraNotKept: boolean;
  /** The extra photos that WERE kept, so only those count as logged. */
  keptRoles: ExtraRole[];
}

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
  /**
   * Throws QueueWriteError if the sighting could not be saved. SYC-574: a
   * hint (`hintCatId`) is set on the stored item here, after `queuedSighting`
   * built it, so the saved-for-later shape stays pinned (test 6b). It stays
   * on the phone: the replay builds its body field by field and never reads it.
   */
  enqueue: (item: EnqueueInput, options?: { hintCatId?: number | null }) => Promise<EnqueueResult>;
  /** Throws QueueWriteError if the change could not be saved. */
  remove: (localId: string) => Promise<void>;
  /** Put a failed item back in the queue and try syncing again. */
  retry: (localId: string) => Promise<void>;
  /**
   * Replace a rejected item's photo while preserving its capture metadata.
   * Throws QueueWriteError if the change could not be saved.
   */
  replacePhoto: (localId: string, photo: ReplacementPhoto) => Promise<void>;
  /**
   * SYC-415: take one extra photo out of a rejected spot. If the server's
   * refusal was about that photo (or the spot was too large), the spot goes
   * back in the queue and syncs. Throws QueueWriteError if not saved.
   */
  removeExtraPhoto: (localId: string, role: ExtraRole) => Promise<void>;
  /** SYC-415: as replacePhoto, for one extra photo of a rejected spot. */
  replaceExtraPhoto: (
    localId: string,
    role: ExtraRole,
    photo: ReplacementPhoto,
  ) => Promise<void>;
  syncNow: () => Promise<void>;
  syncing: boolean;
  /**
   * SYC-503: store a successful "Check again" on a waiting item. Throws
   * QueueWriteError if the change could not be saved.
   */
  updateReview: (localId: string, result: Omit<ReviewResult, 'sightingId'>) => Promise<void>;
  /** Number of synced sightings waiting for the user's review. */
  reviewReadyCount: number;
  /** True right after queued sightings finish syncing, until dismissed. */
  reviewPromptVisible: boolean;
  dismissReviewPrompt: () => void;
  /**
   * A sync hit the pre-launch gate's own 401 (SYC-113): the website session
   * cookie is missing or stale (e.g. after the Neon cutover rotated the
   * session keys). Web only — on native store builds this can only mean the
   * tester key is misconfigured, which is logged instead (see syncNow).
   * Queued items are untouched and syncing is paused until
   * `retryAfterSignIn` is called, so the queue does not hammer the gate.
   */
  needsSignIn: boolean;
  /** Clears `needsSignIn` and syncs again — call after the user signs in. */
  retryAfterSignIn: () => Promise<void>;
  /**
   * Spots on this phone the server has never seen: everything except those
   * already uploaded and waiting for review. "Delete my data" says how many
   * will go (SYC-63 decision B).
   */
  unsentCount: number;
  /**
   * SYC-63: stop syncing and wait until no upload is in flight, in this tab
   * (the in-progress sync itself, since phones have no lock manager) and, on
   * the web, in any other tab (the upload lock). Nothing syncs again until
   * `resumeSync`.
   */
  pauseSync: () => Promise<void>;
  resumeSync: () => void;
  /**
   * SYC-63: forget every queued spot, every sighting photo and every queue
   * backup on this phone, even when the saved queue is unreadable. Throws if
   * it couldn't finish.
   */
  wipeQueue: () => Promise<void>;
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
    .flatMap((p) => [
      ...(p.photoBase64 ? [p.photoUri, `idb:${p.localId}`] : [p.photoUri]),
      // SYC-415: every photo of a waiting spot, not just the first.
      ...extrasOf(p).map((e) => e.photoUri),
    ]);
  await cleanupOrphanPhotos(keep).catch(() => undefined);
}

/** What the server answered about a sent spot: its check, and any look-alikes. */
type ReviewResult = Pick<
  PendingSighting,
  'sightingId' | 'isCatPhoto' | 'candidates' | 'matchCheck' | 'canRecheck'
>;

/**
 * SYC-503: a successful "Check again" replaces a waiting item's stored
 * answer, so reopening it later shows the new result. Only an item still
 * waiting for review, and only its answer.
 */
export function applyRecheck(
  localId: string,
  result: Omit<ReviewResult, 'sightingId'>,
) {
  return (list: PendingSighting[]) =>
    list.map((p) =>
      p.localId === localId && p.status === 'review'
        ? {
            ...p,
            isCatPhoto: result.isCatPhoto,
            candidates: result.candidates,
            matchCheck: result.matchCheck,
            canRecheck: result.canRecheck,
          }
        : p,
    );
}

function markReview(
  localId: string,
  result: ReviewResult,
  extraNote?: PendingSighting['extraNote'],
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
            matchCheck: result.matchCheck,
            canRecheck: result.canRecheck,
            ...(extraNote ? { extraNote } : {}),
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

type SyncOutcome = 'synced' | 'network' | 'needs_sign_in' | 'moved' | 'done';

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
  const { deviceId, username, moved } = useDevice();
  const [isOnline, setIsOnline] = useState(true);
  const [networkState, setNetworkState] = useState<UploadNetworkState | null>(
    null,
  );
  const [pending, setPending] = useState<PendingSighting[]>([]);
  const [ready, setReady] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reviewPromptVisible, setReviewPromptVisible] = useState(false);
  const [needsSignIn, setNeedsSignInState] = useState(false);
  const syncingRef = useRef(false);
  // SYC-63: "Delete my data" pauses syncing and must be able to wait for the
  // sync in progress. A boolean can't be awaited, so the sync keeps a promise.
  const pausedRef = useRef(false);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const networkStateRef = useRef<UploadNetworkState | null>(null);
  const needsSignInRef = useRef(false);

  const setNeedsSignIn = useCallback((value: boolean) => {
    needsSignInRef.current = value;
    setNeedsSignInState(value);
  }, []);

  const storeRef = useRef<QueueStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createQueueStore({
      read: () => AsyncStorage.getItem(QUEUE_KEY),
      write: (raw) => AsyncStorage.setItem(QUEUE_KEY, raw),
      remove: () => AsyncStorage.removeItem(QUEUE_KEY),
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

      // SYC-415: the extra photos. One that has gone missing is skipped and
      // the spot sends with the others: a good first photo is never lost
      // because of an extra (spec §6.4). One that merely can't be read this
      // time keeps the spot queued for the next sync.
      const extraPhotos: { role: ExtraRole; photoBase64: string }[] = [];
      let extraMissing = false;
      for (const extra of extrasOf(item)) {
        const extraRead = extra.photoBase64
          ? { status: 'ok' as const, base64: extra.photoBase64 }
          : await readPendingPhoto(extra.photoUri);
        if (extraRead.status === 'error') {
          // Could not read it this time: leave the spot queued for the next
          // sync, exactly as for the first photo. Only a photo that is gone
          // ('missing') is ever sent without.
          return 'done';
        }
        if (extraRead.status === 'ok') {
          extraPhotos.push({ role: extra.role, photoBase64: extraRead.base64 });
        } else {
          extraMissing = true;
        }
      }

      // The constrained-network shrink only ever applies to the first photo:
      // extras were already prepared at pick time.
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
          ...(extraPhotos.length > 0 ? { extraPhotos } : {}),
        });
      } catch (err) {
        const rejectionKey = photoRejectionKey(err);
        if (rejectionKey) {
          // Permanent rejection (bad format / too large) — retrying will
          // never succeed, so mark it rejected, say which photo, and move on.
          // The spotter can fix it (replace or remove that photo).
          await store.mutate(
            markStatus(localId, {
              status: 'rejected',
              rejectionKey,
              rejectedRole: rejectedPhotoRole(err) ?? 'first',
            }),
            'system',
          );
          return 'done';
        }
        const decision = classifySyncFailure(err, item.failCount);
        if (decision.kind === 'needs_sign_in') {
          // The pre-launch gate's own 401, not the device-secret check's.
          // The item is left exactly as it was — queued, no error flagged —
          // since this says nothing about the sighting itself.
          return 'needs_sign_in';
        }
        if (decision.kind === 'moved') return 'moved';
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
      await store.mutate(
        markReview(localId, result, extraMissing ? 'extraMissing' : undefined),
        'system',
      );
      return 'synced';
    },
    [store],
  );

  const syncNow = useCallback(async () => {
    try {
      // Nothing is known about the queue until it has loaded.
      await store.ready;
      if (syncingRef.current || !deviceId) return;
      // SYC-3: nothing is sent while this phone's spotter has moved away, or
      // before a fresh spotter (after "Start again") has picked a name
      // (`null` is DeviceContext's "not chosen yet").
      if (moved || username === null) return;
      // Paused after a gate 401 (needs_sign_in) until retryAfterSignIn
      // clears it — otherwise every reconnect/foreground event would hammer
      // the gate with the same doomed request.
      if (needsSignInRef.current) return;
      // Paused while a person deletes their data (SYC-63).
      if (pausedRef.current) return;
      syncingRef.current = true;
      let syncedAny = false;
      // Set in the same tick as the checks above, so pauseSync either stops
      // this sync before it starts or finds this promise to wait for.
      let settle!: () => void;
      syncInFlightRef.current = new Promise<void>((resolve) => {
        settle = resolve;
      });
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
            // Pausing stops the sync between items, never mid-upload.
            if (pausedRef.current) break;
            let outcome: SyncOutcome;
            try {
              outcome = await syncOne(localId, deviceId);
            } catch {
              // One item's failure never stops the others.
              outcome = 'done';
            }
            if (outcome === 'synced') syncedAny = true;
            if (outcome === 'network' || outcome === 'moved') break;
            if (outcome === 'needs_sign_in') {
              if (Platform.OS === 'web') {
                // Web has a sign-in flow (the website's session cookie) —
                // show the prompt and pause until the user returns.
                setNeedsSignIn(true);
              } else {
                // Store builds carry a baked-in tester key, not a session
                // cookie: a gate 401 here can only mean that key is missing
                // or wrong. There is nothing for the user to sign in to, so
                // just log it and keep the item queued — no prompt loop.
                console.error(
                  '[prelaunch] the pre-launch gate rejected a request from a ' +
                    'native build — check EXPO_PUBLIC_PRELAUNCH_KEY',
                );
              }
              break;
            }
          }
        });
      } finally {
        syncingRef.current = false;
        syncInFlightRef.current = null;
        settle();
        setSyncing(false);
        if (syncedAny) {
          setReviewPromptVisible(true);
        }
      }
    } catch {
      // Callers (NetInfo) do not await this; never leave a rejection behind.
    }
  }, [deviceId, username, moved, setNeedsSignIn, store, syncOne]);

  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  /** Call after the user signs in again: clears the pause and retries. */
  const retryAfterSignIn = useCallback(async () => {
    if (!needsSignInRef.current) return;
    setNeedsSignIn(false);
    await syncNowRef.current();
  }, [setNeedsSignIn]);

  const retryAfterSignInRef = useRef(retryAfterSignIn);
  retryAfterSignInRef.current = retryAfterSignIn;

  // On web, returning to the tab after visiting the sign-in page is the
  // natural moment to retry automatically — without polling or a timer,
  // which would hammer the gate while signed out.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (typeof window.addEventListener !== 'function') return;
    const onFocus = () => {
      void retryAfterSignInRef.current();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

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
    async (item: EnqueueInput, options?: { hintCatId?: number | null }) => {
      await store.ready;
      const hint = hintOf(options);
      // Store the photo outside the list so the list stays small.
      const saved = keepInlineUnlessBroken(
        await savePendingPhoto(item.localId, item.photoUri, item.photoBase64),
      );
      // SYC-415: each extra photo is stored outside the list too, and is
      // NEVER kept inline: three inline photos could overflow the browser's
      // list. One that can't be stored is dropped, and the spot says so.
      const { extraPhotos: extrasIn, ...rest } = item;
      const extraRefs: ExtraRef[] = [];
      let extraNotKept = false;
      for (const extra of extrasIn ?? []) {
        let extraSaved: SavePhotoResult;
        try {
          extraSaved = await savePendingPhoto(
            `${item.localId}-${extra.role}`,
            extra.photoUri,
            extra.photoBase64,
          );
        } catch {
          extraSaved = { ok: false, reason: 'failed' };
        }
        if (extraSaved.ok) {
          extraRefs.push({ role: extra.role, photoUri: extraSaved.ref });
        } else {
          extraNotKept = true;
        }
      }
      const base: PendingSighting = saved.ok
        ? {
            ...rest,
            photoBase64: undefined,
            photoUri: saved.ref,
            status: 'queued' as const,
          }
        : { ...rest, status: 'queued' as const };
      const stored: PendingSighting = {
        ...base,
        ...(extraRefs.length > 0 ? { extraPhotos: extraRefs } : {}),
        ...(extraNotKept ? { extraNote: 'extraNotKept' as const } : {}),
        ...(hint !== undefined ? { hintCatId: hint } : {}),
      };
      try {
        await store.mutate((list) => {
          // SYC-63: nothing new joins the queue while "Delete my data" has
          // syncing paused, or a spot whose photo was still saving could land
          // after the wipe and survive it. Checked here, in the write itself,
          // so it holds however long the photo took.
          if (pausedRef.current) throw new QueueWriteError('failed');
          return [...list.filter((p) => p.localId !== stored.localId), stored];
        }, 'user');
      } catch (err) {
        // The spot wasn't saved: don't leave its extra files behind (the
        // first photo's file is left to the sweep, as before).
        for (const ref of extraRefs) deletePendingPhoto(ref.photoUri).catch(() => {});
        throw err;
      }
      return { extraNotKept, keptRoles: extraRefs.map((r) => r.role) };
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
      // SYC-415: and every extra photo's file.
      if (gone) {
        for (const extra of extrasOf(gone)) {
          deletePendingPhoto(extra.photoUri).catch(() => {});
        }
      }
    },
    [store],
  );

  const updateReview = useCallback(
    async (localId: string, result: Omit<ReviewResult, 'sightingId'>) => {
      await store.mutate(applyRecheck(localId, result), 'user');
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
              rejectedRole: undefined,
              errorKind: undefined,
              failCount: 0,
              sightingId: undefined,
              isCatPhoto: undefined,
              candidates: undefined,
              matchCheck: undefined,
              canRecheck: undefined,
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

  /**
   * SYC-415: change one extra photo of a rejected spot (remove it, or swap in
   * a new one stored under a new key), then delete the old file once the list
   * no longer refers to it. When the refusal was about this photo, or the
   * whole spot was too large, the rejection is cleared and the spot goes back
   * in the queue; otherwise it stays rejected for the real fix.
   */
  const changeExtraPhoto = useCallback(
    async (localId: string, role: ExtraRole, photo: ReplacementPhoto | null) => {
      await store.ready;
      const current = store.items().find((p) => p.localId === localId);
      if (!current || current.status !== 'rejected') return;
      const currentRef = extrasOf(current).find((e) => e.role === role)?.photoUri;
      if (!photo && !currentRef) return;

      let newRef: string | null = null;
      if (photo) {
        // Never inline (an extra never is): a save that doesn't work fails
        // honestly, and the spot is left as it was.
        const saved = await savePendingPhoto(
          replacementPhotoKey(localId, currentRef, role),
          photo.photoUri,
          photo.photoBase64,
        );
        if (!saved.ok) throw new QueueWriteError('failed');
        newRef = saved.ref;
      }

      let oldRef: string | undefined;
      let requeued = false;
      await store.mutate(
        (list) =>
          list.map((p) => {
            if (p.localId !== localId || p.status !== 'rejected') return p;
            const extras = extrasOf(p);
            oldRef = extras.find((e) => e.role === role)?.photoUri;
            const others = extras.filter((e) => e.role !== role);
            const nextExtras: ExtraRef[] = newRef
              ? [...others, { role, photoUri: newRef }].sort((a, b) =>
                  a.role === b.role ? 0 : a.role === 'face' ? -1 : 1,
                )
              : others;
            const clears =
              p.rejectedRole === role || p.rejectionKey === 'spotTooLarge';
            requeued = clears;
            return {
              ...p,
              extraPhotos: nextExtras.length > 0 ? nextExtras : undefined,
              ...(clears
                ? {
                    status: 'queued' as const,
                    rejectionKey: undefined,
                    rejectedRole: undefined,
                    errorKind: undefined,
                    failCount: 0,
                  }
                : {}),
            };
          }),
        'user',
      );
      // The old photo goes only once the list no longer refers to it.
      const old = oldRef as string | undefined;
      if (old && old !== newRef) deletePendingPhoto(old).catch(() => {});
      if (requeued) await syncNowRef.current();
    },
    [store],
  );

  const removeExtraPhoto = useCallback(
    (localId: string, role: ExtraRole) => changeExtraPhoto(localId, role, null),
    [changeExtraPhoto],
  );

  const replaceExtraPhoto = useCallback(
    (localId: string, role: ExtraRole, photo: ReplacementPhoto) =>
      changeExtraPhoto(localId, role, photo),
    [changeExtraPhoto],
  );

  const pauseSync = useCallback(async () => {
    pausedRef.current = true;
    // This tab's own upload. On phones this is the only wait there is:
    // withLock runs straight away without a lock manager (plan §6.2).
    await syncInFlightRef.current;
    // On the web, any other tab's upload holds this lock until it finishes.
    await withLock(UPLOAD_LOCK, async () => undefined);
  }, []);

  const resumeSync = useCallback(() => {
    pausedRef.current = false;
    void syncNowRef.current();
  }, []);

  const wipeQueue = useCallback(async () => {
    await store.wipe();
    await deleteAllSightingPhotos();
    setReadOnly(false);
    setReviewPromptVisible(false);
  }, [store]);

  const unsentCount = useMemo(
    () => pending.filter((p) => p.status !== 'review').length,
    [pending],
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
      updateReview,
      replacePhoto,
      removeExtraPhoto,
      replaceExtraPhoto,
      syncNow,
      syncing,
      reviewReadyCount,
      reviewPromptVisible,
      dismissReviewPrompt,
      needsSignIn,
      retryAfterSignIn,
      unsentCount,
      pauseSync,
      resumeSync,
      wipeQueue,
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
      updateReview,
      replacePhoto,
      removeExtraPhoto,
      replaceExtraPhoto,
      syncNow,
      syncing,
      reviewReadyCount,
      reviewPromptVisible,
      dismissReviewPrompt,
      needsSignIn,
      retryAfterSignIn,
      unsentCount,
      pauseSync,
      resumeSync,
      wipeQueue,
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
