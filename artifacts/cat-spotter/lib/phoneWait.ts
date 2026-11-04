/**
 * SYC-795: how long the phone waited for the live answer, so the launch
 * measures can report it. Fire-and-forget: a failed report never touches
 * what the spotter sees, and a send is never held up by it.
 */

/** A wait longer than this is not a wait we trust (a phone left asleep). */
export const MAX_PHONE_WAIT_MS = 600_000;

export function startPhoneWait(
  clock: () => number = () => performance.now(),
): () => number | null {
  const startedAt = clock();
  return () => {
    const ms = Math.round(clock() - startedAt);
    return ms < 0 || ms > MAX_PHONE_WAIT_MS ? null : ms;
  };
}

export function reportPhoneWait(
  post: (id: number, body: { deviceId: string; waitMs: number }) => Promise<unknown>,
  sightingId: number,
  deviceId: string,
  waitMs: number | null,
): void {
  if (waitMs === null) return;
  try {
    void Promise.resolve(post(sightingId, { deviceId, waitMs })).catch(() => undefined);
  } catch {
    // never surfaces
  }
}
