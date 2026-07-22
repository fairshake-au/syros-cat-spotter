/**
 * Pure decision logic for the offline sighting queue.
 *
 * Extracted from OfflineContext so the flagging rules (stale items,
 * permanent server rejections, retry counting) can be unit-tested
 * without React Native.
 */
import type { MatchCandidate } from '@workspace/api-client-react';

/** Server-error retries before an item is marked failed. */
export const MAX_SYNC_ATTEMPTS = 3;
/** Queued items older than this are flagged as stale and can never sync. */
export const MAX_QUEUE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PendingSighting {
  localId: string;
  /**
   * Inline base64 photo. Only kept on web (no persistent file system) and
   * for legacy items queued before photos moved to document storage.
   */
  photoBase64?: string;
  /** Display URI — points at the persisted photo file once enqueued. */
  photoUri: string;
  lat: number;
  lng: number;
  createdAt: string;
  status: 'queued' | 'review' | 'error' | 'rejected';
  /** Why the item is in the error state. */
  errorKind?: 'server' | 'stale';
  /** Consecutive server-error sync failures. */
  failCount?: number;
  /** Translation key explaining a permanent server rejection. */
  rejectionKey?: string;
  // Populated once synced with the server:
  sightingId?: number;
  isCatPhoto?: boolean;
  candidates?: MatchCandidate[];
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
  | { kind: 'server'; permanent: boolean; failCount: number };

/**
 * Decide what to do with a queued item after a sync attempt threw `err`.
 *
 * - Non-API errors are network failures: keep the item queued unchanged.
 * - API (server) errors increment the fail count; the item is flagged as a
 *   permanent error on any 4xx status, or once the fail count reaches
 *   MAX_SYNC_ATTEMPTS.
 */
export function classifySyncFailure(
  err: unknown,
  previousFailCount: number | undefined,
): SyncFailureDecision {
  const isServerError = err instanceof Error && err.name === 'ApiError';
  if (!isServerError) return { kind: 'network' };
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
