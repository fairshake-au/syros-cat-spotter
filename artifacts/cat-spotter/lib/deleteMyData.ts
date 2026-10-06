/**
 * "Delete my data" on the phone (SYC-63 plan §1.3, §6.2–§6.4), as plain
 * functions over injected steps, so the order can be tested without a screen.
 *
 * The order matters:
 *  1. Pause the queue and wait for any upload in flight, so nothing is sent
 *     under the old identity after the server has deleted it.
 *  2. Ask the server to delete the person.
 *  3. Only once the server says it's done (204, or 410: already done), wipe
 *     the phone's copy of the person, then
 *  4. make a fresh identity and let syncing carry on under it.
 *
 * If step 2 fails, nothing on the phone is touched and syncing resumes: the
 * person is exactly where they started, and trying again is always safe.
 */

export type DeleteOutcome =
  /** Server and phone are both done. Show "Done". */
  | 'done'
  /** The server didn't delete anything (offline, error). Nothing changed. */
  | 'failed'
  /**
   * The server deleted the person but the phone couldn't finish wiping.
   * Syncing stays paused; trying again finishes the wipe (the server answers
   * 204 to a repeat).
   */
  | 'wipe_failed';

export interface DeleteMyDataSteps {
  pauseSync(): Promise<void>;
  resumeSync(): void;
  /** DELETE /api/me with this phone's current id and secret. */
  deleteOnServer(): Promise<void>;
  /** Queue, photos, backups, cached server data: everything but the identity. */
  wipePhone(): Promise<void>;
  /** Forget the id, secret, username and owned cats; make new ones. */
  resetIdentity(): Promise<void>;
}

/** The server's "this spotter's data was deleted" (410 IDENTITY_DELETED). */
export function isIdentityDeletedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: unknown; data?: unknown };
  return (
    e.status === 410 &&
    typeof e.data === 'object' &&
    e.data !== null &&
    (e.data as { code?: unknown }).code === 'IDENTITY_DELETED'
  );
}

/** The tap on "Delete my data". */
export async function deleteMyData(steps: DeleteMyDataSteps): Promise<DeleteOutcome> {
  await steps.pauseSync();
  try {
    await steps.deleteOnServer();
  } catch (err) {
    // 410: an earlier attempt (or another tab) already deleted it.
    if (!isIdentityDeletedError(err)) {
      steps.resumeSync();
      return 'failed';
    }
  }
  return finishAfterServerDeleted(steps);
}

/**
 * Steps 3–4, for a server that has already deleted the person: after the tap,
 * or when any request with the old identity gets a 410 (an app killed between
 * the server's answer and the wipe, plan §6.4).
 */
export async function finishAfterServerDeleted(
  steps: Omit<DeleteMyDataSteps, 'deleteOnServer'>,
): Promise<DeleteOutcome> {
  await steps.pauseSync();
  try {
    await steps.wipePhone();
    await steps.resetIdentity();
  } catch {
    // Leave syncing paused: the old identity must not upload again, and a
    // retry finishes the job.
    return 'wipe_failed';
  }
  steps.resumeSync();
  return 'done';
}
