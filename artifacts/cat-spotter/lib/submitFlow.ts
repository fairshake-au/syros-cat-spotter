/**
 * What happens when the user presses "Check for matches" (spec §3.5, R5).
 *
 * Kept apart from the Spot screen so the decisions are testable:
 *
 *  - Offline, the sighting is saved on the phone. If that save fails, the
 *    outcome says so — the screen keeps the photo and never says "queued".
 *  - Online, it is sent. If sending fails with a network-class error while the
 *    phone reports a connection (one bar of signal), the user is offered
 *    "Save and send later", which queues it. The server's duplicate check
 *    covers a send that half-arrived (R2).
 */
import { classifySyncFailure } from './offlineQueue';
import { photoRejectionKey, rejectedPhotoRole } from './photoRejection';
import { isQueueWriteError } from './queueStore';

/** Which explanation a failed save gets. */
export type SaveFailure =
  /** The saved queue could not be read, so nothing new can be saved offline. */
  | 'read-only'
  /** This browser cannot keep photos (some in-app browsers, R3). */
  | 'open-in-browser'
  | 'generic';

export type SubmitOutcome<R> =
  | { kind: 'sent'; result: R }
  | { kind: 'saved'; reason: 'offline' | 'later' }
  | { kind: 'save-failed'; failure: SaveFailure }
  /** SYC-415: `role` says which of the spot's photos the server refused. */
  | { kind: 'rejected'; rejectionKey: string; role: 'first' | 'face' | 'body' }
  /** Sending failed and the user chose not to save it for later. */
  | { kind: 'not-saved' }
  | { kind: 'send-failed' };

export interface SubmitSteps<R> {
  isOnline: boolean;
  /** False when the queue is read-only: there is nowhere to save it. */
  canSaveForLater: boolean;
  send: () => Promise<R>;
  save: () => Promise<void>;
  offerSaveForLater: () => Promise<boolean>;
  /** Whether this browser can keep photos at all (decides the wording). */
  photosKeepable: () => Promise<boolean>;
}

export async function describeSaveFailure(
  err: unknown,
  photosKeepable: () => Promise<boolean>,
): Promise<SaveFailure> {
  if (isQueueWriteError(err) && err.reason === 'read-only') return 'read-only';
  try {
    if (!(await photosKeepable())) return 'open-in-browser';
  } catch {
    // fall through to the general wording
  }
  return 'generic';
}

async function saveOrReport<R>(
  steps: SubmitSteps<R>,
  reason: 'offline' | 'later',
): Promise<SubmitOutcome<R>> {
  try {
    await steps.save();
    return { kind: 'saved', reason };
  } catch (err) {
    return {
      kind: 'save-failed',
      failure: await describeSaveFailure(err, steps.photosKeepable),
    };
  }
}

export async function submitSighting<R>(
  steps: SubmitSteps<R>,
): Promise<SubmitOutcome<R>> {
  if (!steps.isOnline) return saveOrReport(steps, 'offline');
  try {
    return { kind: 'sent', result: await steps.send() };
  } catch (err) {
    const rejectionKey = photoRejectionKey(err);
    if (rejectionKey) {
      return { kind: 'rejected', rejectionKey, role: rejectedPhotoRole(err) ?? 'first' };
    }
    if (classifySyncFailure(err, 0).kind === 'network' && steps.canSaveForLater) {
      if (!(await steps.offerSaveForLater())) return { kind: 'not-saved' };
      return saveOrReport(steps, 'later');
    }
    return { kind: 'send-failed' };
  }
}

/**
 * Runs one job at a time and ignores calls while one is running — so a
 * double tap cannot queue a sighting twice. Checked synchronously, before any
 * re-render could disable the button.
 */
export function createSingleFlight() {
  let running = false;
  return async function run<T>(job: () => Promise<T>): Promise<T | undefined> {
    if (running) return undefined;
    running = true;
    try {
      return await job();
    } finally {
      running = false;
    }
  };
}
