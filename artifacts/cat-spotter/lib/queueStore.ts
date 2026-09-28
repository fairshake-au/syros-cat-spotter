/**
 * The single write path for the offline sighting queue (spec §3.1).
 *
 * Every change to the queue — queueing, discarding, retrying, replacing a
 * photo, and every step of a sync — goes through `mutate(change)`. It:
 *
 *  1. runs on ONE promise chain, so changes in this tab happen one at a time;
 *  2. runs inside a cross-tab lock where the platform has one (web), so two
 *     open tabs take turns;
 *  3. RE-READS the latest saved list, applies `change` to it, writes it, and
 *     only then updates memory.
 *
 * Before this existed, several writers each rewrote the whole list from their
 * own copy of it and overwrote one another: a sighting resolved during a sync
 * came back, a discarded one came back, and one queued during a sync vanished.
 * Re-reading on every change is what makes those impossible — not care at each
 * call site.
 *
 * Loading is the first job on the chain and resolves `ready`. Writers wait for
 * it. Loading never empties the queue: a list that parses always reaches
 * memory, whatever fails after that; a list that does not parse leaves the
 * queue read-only for the session, so nothing can overwrite it.
 *
 * Framework-free on purpose, so the ordering rules are unit-testable.
 */
import type { PendingSighting } from './offlineQueue';

export type QueueWriteFailure = 'failed' | 'read-only';

/**
 * Thrown to the screen when a change the user asked for could not be saved.
 * Memory is left exactly as it was, so the screen can keep the photo on
 * screen and say so honestly.
 */
export class QueueWriteError extends Error {
  readonly reason: QueueWriteFailure;

  constructor(reason: QueueWriteFailure, cause?: unknown) {
    super(
      reason === 'read-only'
        ? 'The saved queue could not be read, so it cannot be changed'
        : 'The queue could not be saved',
    );
    this.name = 'QueueWriteError';
    this.reason = reason;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

export function isQueueWriteError(err: unknown): err is QueueWriteError {
  return err instanceof Error && err.name === 'QueueWriteError';
}

/**
 * A change to the list. Must be a pure function of the list it is given —
 * it may be applied to a freshly re-read list, and a sync result may be
 * replayed onto a later one. Return the SAME array when nothing changes so the
 * store can skip the write.
 */
export type QueueChange = (items: PendingSighting[]) => PendingSighting[];

/**
 * - `user`: a change someone asked for. If it cannot be saved it throws
 *   `QueueWriteError` and memory is unchanged.
 * - `system`: the outcome of something that already happened (an upload
 *   finished, the server rejected a photo). It ALWAYS reaches memory; if it
 *   cannot be saved the queue is marked unsaved and the change is replayed on
 *   the next write — so a sighting already uploaded is never uploaded again in
 *   this session.
 */
export type ChangeKind = 'user' | 'system';

export interface QueueStoreOptions {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
  /** Hold the cross-tab queue lock while `fn` runs. Identity where there is none. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Memory changed; show it. */
  publish: (items: PendingSighting[]) => void;
}

export interface LoadContext {
  /** The list as memory has it now. */
  items(): PendingSighting[];
  /** `mutate` for use INSIDE the load (the load already holds the chain). */
  mutate(change: QueueChange): Promise<PendingSighting[]>;
}

export interface LoadHooks {
  /** The saved text could not be parsed. Keep a copy of it somewhere safe. */
  onUnparseable?: (raw: string) => Promise<void>;
  /**
   * Runs after the parsed list is in memory and before `ready` resolves:
   * stale marking, moving photos, the orphan sweep. Anything it throws is
   * contained — the parsed list is already in memory.
   */
  afterParse?: (ctx: LoadContext, raw: string | null) => Promise<void>;
}

export interface QueueStore {
  /** Resolves once the saved list has been loaded (or found unreadable). */
  readonly ready: Promise<void>;
  isReady(): boolean;
  /** The saved list could not be parsed: no change can be saved this session. */
  isReadOnly(): boolean;
  /** A system change reached memory but not storage yet. */
  hasUnsavedChanges(): boolean;
  items(): PendingSighting[];
  load(hooks?: LoadHooks): Promise<void>;
  mutate(change: QueueChange, kind?: ChangeKind): Promise<PendingSighting[]>;
  /** Re-read storage into memory (another tab may have changed it). */
  refresh(): Promise<void>;
}

type Parsed = { ok: true; items: PendingSighting[] } | { ok: false };

function isItem(value: unknown): value is PendingSighting {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { localId?: unknown }).localId === 'string'
  );
}

/**
 * Parse the saved text. Anything that is not an array of queue items counts
 * as unparseable — and an unparseable list is never overwritten.
 */
export function parseQueue(raw: string | null): Parsed {
  if (raw === null || raw === '') return { ok: true, items: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(isItem)) return { ok: false };
    return { ok: true, items: value };
  } catch {
    return { ok: false };
  }
}

export function createQueueStore(options: QueueStoreOptions): QueueStore {
  const withLock =
    options.withLock ?? (<T,>(fn: () => Promise<T>): Promise<T> => fn());

  let chain: Promise<unknown> = Promise.resolve();
  let memory: PendingSighting[] = [];
  let unsaved: QueueChange[] = [];
  let loaded = false;
  let readOnly = false;
  let loadPromise: Promise<void> | null = null;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  function run<T>(job: () => Promise<T>): Promise<T> {
    const result = chain.then(() => job());
    chain = result.catch(() => undefined);
    return result;
  }

  function setMemory(items: PendingSighting[]) {
    memory = items;
    options.publish(items);
  }

  function replayUnsaved(items: PendingSighting[]): PendingSighting[] {
    return unsaved.reduce((list, change) => change(list), items);
  }

  async function readStored(): Promise<
    { ok: true; items: PendingSighting[] } | { ok: false; reason: QueueWriteFailure }
  > {
    let raw: string | null;
    try {
      raw = await options.read();
    } catch {
      return { ok: false, reason: 'failed' };
    }
    const parsed = parseQueue(raw);
    return parsed.ok ? parsed : { ok: false, reason: 'read-only' };
  }

  function mutateNow(
    change: QueueChange,
    kind: ChangeKind,
  ): Promise<PendingSighting[]> {
    return withLock(async () => {
      const stored = await readStored();
      if (!stored.ok) {
        if (kind === 'user') throw new QueueWriteError(stored.reason);
        // Something already happened (an upload finished). Memory must learn
        // it even though storage cannot, or the next sync repeats it.
        unsaved.push(change);
        setMemory(change(memory));
        return memory;
      }
      const base = replayUnsaved(stored.items);
      const next = change(base);
      if (next === stored.items && unsaved.length === 0) {
        // Nothing to write — but memory still catches up with storage.
        setMemory(stored.items);
        return next;
      }
      try {
        await options.write(JSON.stringify(next));
      } catch (err) {
        if (kind === 'user') throw new QueueWriteError('failed', err);
        unsaved.push(change);
        setMemory(next);
        return next;
      }
      unsaved = [];
      setMemory(next);
      return next;
    });
  }

  async function refreshNow(): Promise<void> {
    const stored = await readStored();
    if (!stored.ok) return;
    setMemory(replayUnsaved(stored.items));
  }

  async function loadNow(hooks: LoadHooks | undefined): Promise<void> {
    try {
      let raw: string | null = null;
      try {
        raw = await options.read();
      } catch {
        // Storage could not be read at all. Memory stays empty, but nothing is
        // lost: every write re-reads storage first.
        raw = null;
      }
      const parsed = parseQueue(raw);
      if (!parsed.ok) {
        readOnly = true;
        if (raw !== null && hooks?.onUnparseable) {
          await hooks.onUnparseable(raw).catch(() => undefined);
        }
        return;
      }
      // From here on the parsed list is in memory, whatever fails next.
      setMemory(parsed.items);
      if (hooks?.afterParse) {
        await hooks
          .afterParse(
            {
              items: () => memory,
              mutate: (change) => mutateNow(change, 'system'),
            },
            raw,
          )
          .catch(() => undefined);
      }
    } finally {
      loaded = true;
      resolveReady();
    }
  }

  return {
    ready,
    isReady: () => loaded,
    isReadOnly: () => readOnly,
    hasUnsavedChanges: () => unsaved.length > 0,
    items: () => memory,
    load(hooks) {
      // Idempotent: React may mount the provider's effect twice.
      loadPromise ??= run(() => loadNow(hooks));
      return loadPromise;
    },
    async mutate(change, kind = 'user') {
      await ready;
      return run(() => mutateNow(change, kind));
    },
    async refresh() {
      await ready;
      return run(refreshNow);
    },
  };
}
