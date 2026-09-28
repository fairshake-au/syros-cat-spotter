/**
 * Cross-tab locks for the offline queue (spec §3.1), via the Web Locks API
 * (Chrome 69+, Safari 15.4+, Firefox 96+). Where there is no lock manager —
 * native, older browsers, tests — the in-tab promise chain alone serialises
 * changes, which is all a single-process app needs.
 */

export const QUEUE_LOCK = 'cat-spotter-queue';
export const UPLOAD_LOCK = 'cat-spotter-upload';

interface LockManagerLike {
  request<T>(
    name: string,
    optionsOrCallback: unknown,
    callback?: (lock: unknown) => Promise<T> | T,
  ): Promise<T>;
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Run `fn` while holding the named lock, waiting for it if another tab has it. */
export async function withLock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const locks = lockManager();
  if (!locks) return fn();
  let started = false;
  try {
    return await locks.request<T>(name, () => {
      started = true;
      return fn();
    });
  } catch (err) {
    // The lock manager refused outright (e.g. an opaque origin). The in-tab
    // chain still serialises this tab, so fall back rather than fail a save.
    if (started) throw err;
    return fn();
  }
}

/**
 * Run `fn` only if no other tab holds the lock; otherwise skip it. Used so
 * that exactly one open tab uploads the queue at a time.
 */
export async function ifLockFree(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  const locks = lockManager();
  if (!locks) return fn();
  let started = false;
  try {
    await locks.request<void>(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      started = true;
      await fn();
    });
  } catch (err) {
    if (started) throw err;
    await fn();
  }
}
