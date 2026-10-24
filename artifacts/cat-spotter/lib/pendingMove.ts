import { isDefiniteRefusal, redeemRestore } from './keepSafe';
import { clearPendingMove, readPendingMove } from './restoreWaiting';

/**
 * SYC-664: finishing this phone's own restore move when its answer was lost
 * (a reload, a dropped connection). The server answers the same phone's retry
 * for 15 minutes (its replay window) and moves nothing twice, so asking again
 * with the stored values is always safe.
 *
 * One at a time (SYC-664 ship review F2): start-up, the code screen's move,
 * its "Try again" and the back-online retry all go through `exclusiveMove`. A
 * caller that arrives while one is in flight waits for that one's answer and
 * sends nothing of its own.
 */

export type Restored = { deviceId: string; username: string | null };

/**
 * The tries at start-up, before the app shows anything: `attempts` tries,
 * `delayMs` apart, each with its own `timeoutMs`, while the move is inside its
 * window. Mutable so tests can shorten the delay.
 */
export const RESUME_RETRY = { attempts: 4, delayMs: 1_500, timeoutMs: 5_000 };

let current: Promise<Restored | null> | null = null;

/** Whether a move (or the finishing of one) is in flight right now. */
export function moveInFlight(): boolean {
  return current !== null;
}

/** Runs `work` unless a move is already in flight, in which case it waits for that one instead. */
export function exclusiveMove(work: () => Promise<Restored | null>): Promise<Restored | null> {
  if (current) return current;
  const run = work();
  current = run;
  const release = () => {
    if (current === run) current = null;
  };
  run.then(release, release);
  return run;
}

/**
 * Ask again for the pending move, as `deviceId` (the id this phone still holds),
 * and on an answer call `adopt` before anyone waiting is told. Resolves to the
 * spotter that came back, or null when nothing is pending. Rejects with the
 * last error otherwise: after a definite refusal (a 4xx other than 429) the
 * pending move is cleared, after anything else it is kept for the next try
 * while it is inside its window.
 */
export function finishPendingMove(
  deviceId: string,
  adopt: (deviceId: string, username: string | null) => Promise<void>,
  attempts = 1,
): Promise<Restored | null> {
  return exclusiveMove(async () => {
    let lastError: unknown = null;
    for (let attempt = 1; ; attempt++) {
      // Read afresh each time: once the window has passed this clears it.
      const pending = readPendingMove();
      if (!pending) {
        if (lastError) throw lastError;
        return null;
      }
      let result: Restored;
      try {
        result = await redeemRestore(
          deviceId,
          {
            token: pending.handle,
            choice: pending.choice,
            abandonCurrent: pending.abandonCurrent,
            ...(pending.deleteCurrent ? { deleteCurrent: true } : {}),
          },
          { timeoutMs: RESUME_RETRY.timeoutMs },
        );
      } catch (err) {
        if (isDefiniteRefusal(err)) {
          clearPendingMove();
          throw err;
        }
        lastError = err;
        if (attempt >= attempts) {
          readPendingMove(); // kept inside the window, cleared after it
          throw err;
        }
        await new Promise((r) => setTimeout(r, RESUME_RETRY.delayMs));
        continue;
      }
      // Outside the try: a failed write here is not a refused move (N2).
      await adopt(result.deviceId, result.username);
      return result;
    }
  });
}
