import {
  claimUsername,
  getClaimedUsername,
  type ClaimedUsername,
} from '@workspace/api-client-react';
import { usernameKey } from './usernameNormalize';

/**
 * Timers, and how they fit together (SYC-211):
 *
 * - The transport timeout (USERNAME_REQUEST_TIMEOUT_MS, 30 s, in
 *   custom-fetch.ts) is what actually ends a claim, read or availability
 *   request. Every request therefore settles, so nothing waits for ever.
 * - CLAIM_WAIT_MS and RECONCILE_WAIT_MS are UI waits only. After them the
 *   screen stops waiting and shows "uncertain", while the request itself is
 *   still observed until the transport settles it.
 *
 * AVAILABILITY_WAIT_MS is only used by the Profile-tab editor now; onboarding
 * no longer gates Continue on availability (F2) and keeps late answers.
 */
export const AVAILABILITY_WAIT_MS = 5000;
export const CLAIM_WAIT_MS = 8000;
export const RECONCILE_WAIT_MS = 4000;

export class RequestTimedOut extends Error {
  constructor() {
    super('Request timed out');
  }
}

/** Bounds the UI wait without cancelling a write that may already be committing. */
export async function withDeadline<T>(request: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RequestTimedOut()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** What the screen should do now. */
export type ClaimOutcome =
  | { kind: 'claimed'; username: string }
  /** Unknown whether the server saved it: allow only a same-name retry. */
  | { kind: 'uncertain' }
  /** A firm server answer (400, 401, 403, 409): the name was not saved. */
  | { kind: 'rejected'; error: unknown }
  /** The request ended without a status and the server confirms it does not hold the name. */
  | { kind: 'notSaved' };

/** How one claim request finally ended (reported through `onSettled`). */
export type ClaimSettlement =
  | { kind: 'claimed'; username: string }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'notSaved' }
  /** Ended without a status and the follow-up read failed: still unknown. */
  | { kind: 'unknown' }
  /** Succeeded, but for a name this phone is no longer claiming; not applied. */
  | { kind: 'ignored' };

const FIRM_STATUSES = new Set([400, 401, 403, 409]);

/** A definite server "no". Everything else (no status, 5xx, 429, 408) leaves the outcome unknown. */
export function isFirmRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && FIRM_STATUSES.has(status);
}

/** Keep full profile stats intact until the independent refresh completes. */
export function withUpdatedUsername<T extends object>(
  profile: T | undefined,
  username: string,
): (T & { username: string }) | undefined {
  return profile ? { ...profile, username } : undefined;
}

/**
 * The name this phone most recently tried to claim (normalised). A late
 * success or a reconcile read is only applied for this name, so an older
 * request can never overwrite a newer choice on the phone.
 */
let latestClaimKey: string | null = null;

/**
 * Claim `name`, bounded for the UI, and keep observing the request until the
 * transport settles it.
 *
 * - A lost POST response is not proof the write failed: after any unclear
 *   failure the server's name is read before the caller may unlock.
 * - A server name (reconciled or late) is accepted only if it is the same
 *   name as submitted under the server's normalisation, and still the latest
 *   name claimed. `onClaimed` fires at most once per call.
 * - `onSettled` reports how the request finally ended, after any follow-up
 *   read, so the caller can unlock a name that turned out not to be saved.
 */
export async function claimAndReconcile(
  deviceId: string,
  name: string,
  onClaimed: (username: string) => void,
  onSettled: (settlement: ClaimSettlement) => void = () => {},
  dependencies: {
    claim: typeof claimUsername;
    read: typeof getClaimedUsername;
  } = { claim: claimUsername, read: getClaimedUsername },
  acceptsServerName?: (username: string) => boolean,
): Promise<ClaimOutcome> {
  const started = Date.now();
  const key = usernameKey(name);
  latestClaimKey = key;
  const accepts =
    acceptsServerName ?? ((username: string) => usernameKey(username) === key && latestClaimKey === key);

  let claimedOnce = false;
  const claimed = (username: string) => {
    if (claimedOnce) return;
    claimedOnce = true;
    onClaimed(username);
  };

  type Read = { kind: 'held'; username: string } | { kind: 'absent' } | { kind: 'failed' };
  const reconcile = async (): Promise<Read> => {
    const readStarted = Date.now();
    try {
      const profile = await withDeadline(dependencies.read(deviceId), RECONCILE_WAIT_MS);
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('Username reconciliation timing', {
        claimMs: readStarted - started,
        readMs: Date.now() - readStarted,
      });
      const username = profile.username;
      return username && accepts(username) ? { kind: 'held', username } : { kind: 'absent' };
    } catch {
      return { kind: 'failed' };
    }
  };

  const request = dependencies.claim(deviceId, { username: name });

  // This observer stays attached after the UI stops waiting.
  let finalSettlement: ClaimSettlement | undefined;
  const settlement = request.then(
    (result: ClaimedUsername): ClaimSettlement => {
      if (!result.username) return { kind: 'unknown' };
      if (!accepts(result.username)) return { kind: 'ignored' };
      claimed(result.username);
      return { kind: 'claimed', username: result.username };
    },
    async (error: unknown): Promise<ClaimSettlement> => {
      if (isFirmRejection(error)) return { kind: 'rejected', error };
      const read = await reconcile();
      if (read.kind === 'held') {
        claimed(read.username);
        return { kind: 'claimed', username: read.username };
      }
      return read.kind === 'absent' ? { kind: 'notSaved' } : { kind: 'unknown' };
    },
  ).then((result) => {
    finalSettlement = result;
    onSettled(result);
    return result;
  });

  const toOutcome = (result: ClaimSettlement): ClaimOutcome => {
    switch (result.kind) {
      case 'claimed': return result;
      case 'rejected': return result;
      case 'notSaved':
      case 'ignored': return { kind: 'notSaved' };
      case 'unknown': return { kind: 'uncertain' };
    }
  };

  let answeredInTime = true;
  try {
    await withDeadline(request.then(() => {}, () => {}), CLAIM_WAIT_MS);
  } catch {
    answeredInTime = false;
  }

  if (answeredInTime) {
    const result = await settlement;
    if (result.kind === 'claimed' && typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('Username claim client timing', { claimMs: Date.now() - started });
    }
    return toOutcome(result);
  }

  // The UI deadline passed with the request still open: ask the server.
  const read = await reconcile();
  if (read.kind === 'held') {
    claimed(read.username);
    return { kind: 'claimed', username: read.username };
  }
  if (finalSettlement) return toOutcome(finalSettlement);
  // Still open (or its own follow-up is running): the write may yet commit.
  return { kind: 'uncertain' };
}
