/**
 * Pure decision logic for the offline sighting queue.
 *
 * Extracted from OfflineContext so the flagging rules (stale items,
 * permanent server rejections, retry counting) can be unit-tested
 * without React Native.
 */
import type { MatchCandidate } from '@workspace/api-client-react';
import { isDeviceMovedError } from './deviceMoved';
import type { ExtraRole } from './extraPhotos';

/** Server-error retries before an item is marked failed. */
export const MAX_SYNC_ATTEMPTS = 3;
/** Queued items older than this are flagged as stale and can never sync. */
export const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PendingSighting {
  localId: string;
  /**
   * Inline base64 photo. Only kept where photos cannot be stored outside the
   * list (browsers without a working photo store), and for items queued
   * before photos moved out of it.
   */
  photoBase64?: string;
  /**
   * The photo's reference once stored: a document-directory file path on
   * native, `idb:<id>` on web. For an inline item, whatever display URI the
   * capture had (which may no longer resolve).
   */
  photoUri: string;
  lat: number;
  lng: number;
  createdAt: string;
  status: 'queued' | 'review' | 'error' | 'rejected';
  /**
   * Why the item is in the error state. `cleared`: the browser cleared the
   * stored photo (web only) — said plainly, never as "too old".
   */
  errorKind?: 'server' | 'stale' | 'cleared';
  /** Consecutive server-error sync failures. */
  failCount?: number;
  /** Translation key explaining a permanent server rejection. */
  rejectionKey?: string;
  /**
   * SYC-415: the optional face and body photos, stored as refs (never inline
   * base64 once queued). Typed `unknown` on purpose: the stored list is never
   * validated on load (`parseQueue` passes items through), so ALWAYS read it
   * through `extrasOf`.
   */
  extraPhotos?: unknown;
  /**
   * SYC-415: `extraMissing` — an extra's stored file had gone when the spot
   * sent, so it sent without it. `extraNotKept` — an extra couldn't be stored
   * outside the list when queued, so the spot was queued with its first photo.
   */
  extraNote?: 'extraMissing' | 'extraNotKept';
  /** SYC-415: which photo the server refused, with `rejectionKey`. */
  rejectedRole?: 'first' | 'face' | 'body';
  // Populated once synced with the server:
  sightingId?: number;
  isCatPhoto?: boolean;
  candidates?: MatchCandidate[];
  /**
   * SYC-503: whether the look-alike check worked. Missing (an item saved by
   * an older app) means "done", as before this field existed.
   */
  matchCheck?: 'done' | 'failed';
  /** SYC-503: a failed check can be run again (false when the photo has gone). */
  canRecheck?: boolean;
}

/** One stored extra photo of a queued spot (SYC-415). */
export interface ExtraRef {
  role: ExtraRole;
  photoUri: string;
  photoBase64?: string;
}

/**
 * The ONLY way to read a queued item's extra photos. Never throws: anything
 * malformed is dropped, and at most the first face and the first body are
 * kept, because the stored shape can't be trusted (`parseQueue` in
 * `queueStore.ts` passes items through untouched).
 */
export function extrasOf(item: { extraPhotos?: unknown }): ExtraRef[] {
  const raw = item?.extraPhotos;
  if (!Array.isArray(raw)) return [];
  const out: ExtraRef[] = [];
  const seen = new Set<ExtraRole>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const { role, photoUri, photoBase64 } = e as Record<string, unknown>;
    if (role !== 'face' && role !== 'body') continue;
    if (typeof photoUri !== 'string' || photoUri.length === 0) continue;
    if (seen.has(role)) continue;
    seen.add(role);
    out.push(typeof photoBase64 === 'string' ? { role, photoUri, photoBase64 } : { role, photoUri });
  }
  return out;
}

/**
 * The queued spot's cover photo (spec §5.1): the face extra if there is one,
 * else the first photo. The uri and base64 always come from the SAME photo.
 */
export function coverOf(item: PendingSighting): { uri: string; base64?: string } {
  const face = extrasOf(item).find((e) => e.role === 'face');
  if (face) return { uri: face.photoUri, base64: face.photoBase64 };
  return { uri: item.photoUri, base64: item.photoBase64 };
}

/**
 * Flag queued items older than MAX_QUEUE_AGE_MS as stale errors.
 * Returns the (possibly unchanged) list plus whether anything changed.
 */
export function markStaleItems(
  items: PendingSighting[],
  now: number,
): { items: PendingSighting[]; changed: boolean } {
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
  return { items: next, changed };
}

export type SyncFailureDecision =
  | { kind: 'network' }
  | { kind: 'needs_sign_in' }
  | { kind: 'moved' }
  | { kind: 'server'; permanent: boolean; failCount: number };

/**
 * Is `err` specifically the pre-launch gate's own 401 (SYC-113's
 * `prelaunchGate.ts`), told apart from every other 401/403 by its response
 * body's `error` field — never by status code alone.
 *
 * This matters because `POST /api/sightings` and its device-secret check
 * (`verifyDeviceSecret`) also answer 401 (`{ error: "Device secret
 * required" }`) and 403 (`{ error: "Device secret does not match" }`), and
 * those must keep today's "permanent rejection" handling, not this one.
 */
function isPrelaunchGateFailure(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== 'ApiError') return false;
  const status =
    'status' in err && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  if (status !== 401) return false;
  const data = (err as { data?: unknown }).data;
  return (
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).error === 'prelaunch_pass_required'
  );
}

/**
 * Decide what to do with a queued item after a sync attempt threw `err`.
 *
 * - Non-API errors are network failures: keep the item queued unchanged.
 * - The pre-launch gate's own 401 (post-cutover session keys, a queued
 *   sighting replayed with no valid gate cookie) is NOT permanent: the item
 *   stays queued untouched, and the caller pauses retrying until sign-in.
 * - API (server) errors increment the fail count; the item is flagged as a
 *   permanent error on any other 4xx status, or once the fail count reaches
 *   MAX_SYNC_ATTEMPTS.
 */
export function classifySyncFailure(
  err: unknown,
  previousFailCount: number | undefined,
): SyncFailureDecision {
  const isServerError = err instanceof Error && err.name === 'ApiError';
  if (!isServerError) return { kind: 'network' };
  if (isPrelaunchGateFailure(err)) return { kind: 'needs_sign_in' };
  // SYC-3: this phone's spotter moved to a new phone. Says nothing about the
  // sighting: it stays queued, untouched, and goes under the new spotter
  // after "Start again".
  if (isDeviceMovedError(err)) return { kind: 'moved' };
  const failCount = (previousFailCount ?? 0) + 1;
  const status =
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 0;
  const permanent =
    (status >= 400 && status < 500) || failCount >= MAX_SYNC_ATTEMPTS;
  return { kind: 'server', permanent, failCount };
}

/** Apply a server-failure decision to the item with `localId`. */
export function applyServerFailure(
  items: PendingSighting[],
  localId: string,
  decision: Extract<SyncFailureDecision, { kind: 'server' }>,
): PendingSighting[] {
  return items.map((p) =>
    p.localId === localId
      ? decision.permanent
        ? {
            ...p,
            status: 'error' as const,
            errorKind: 'server' as const,
            failCount: decision.failCount,
          }
        : { ...p, failCount: decision.failCount }
      : p,
  );
}

/** Put a failed item back in the queue with a fresh fail count. */
export function resetForRetry(
  items: PendingSighting[],
  localId: string,
): PendingSighting[] {
  return items.map((p) =>
    p.localId === localId
      ? { ...p, status: 'queued' as const, errorKind: undefined, failCount: 0 }
      : p,
  );
}
