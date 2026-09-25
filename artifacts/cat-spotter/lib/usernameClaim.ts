import {
  claimUsername,
  getClaimedUsername,
  type ClaimedUsername,
} from '@workspace/api-client-react';

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

export type ClaimOutcome =
  | { kind: 'claimed'; username: string }
  | { kind: 'uncertain' }
  | { kind: 'rejected'; error: unknown };

/** Keep full profile stats intact until the independent refresh completes. */
export function withUpdatedUsername<T extends object>(
  profile: T | undefined,
  username: string,
): (T & { username: string }) | undefined {
  return profile ? { ...profile, username } : undefined;
}

/**
 * A lost POST response is not proof the write failed. Keep observing the POST
 * and read the authenticated, lightweight username before another attempt.
 * Callers must retry the *same* name while an earlier write is unresolved.
 */
export async function claimAndReconcile(
  deviceId: string,
  name: string,
  onClaimed: (username: string) => void,
  onSettled: () => void = () => {},
  dependencies: {
    claim: typeof claimUsername;
    read: typeof getClaimedUsername;
  } = { claim: claimUsername, read: getClaimedUsername },
  acceptsReconciledName: (username: string) => boolean = () => true,
): Promise<ClaimOutcome> {
  const started = Date.now();
  const request = dependencies.claim(deviceId, { username: name });
  // This observer remains attached when the UI deadline expires.
  request.then((result: ClaimedUsername) => {
    if (result.username) onClaimed(result.username);
    onSettled();
  }, onSettled);

  try {
    const result = await withDeadline(request, CLAIM_WAIT_MS);
    if (!result.username) throw new Error('Claim returned no username');
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('Username claim client timing', { claimMs: Date.now() - started });
    return { kind: 'claimed', username: result.username };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 400 || status === 401 || status === 403) {
      return { kind: 'rejected', error };
    }
    const readStarted = Date.now();
    try {
      const profile = await withDeadline(dependencies.read(deviceId), RECONCILE_WAIT_MS);
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.info('Username reconciliation timing', {
        claimMs: readStarted - started,
        readMs: Date.now() - readStarted,
      });
      if (profile.username && acceptsReconciledName(profile.username)) {
        onClaimed(profile.username);
        return { kind: 'claimed', username: profile.username };
      }
    } catch {
      // Unknown state: the original write may still commit. Retry only this name.
    }
    return status === 409
      ? { kind: 'rejected', error }
      : { kind: 'uncertain' };
  }
}