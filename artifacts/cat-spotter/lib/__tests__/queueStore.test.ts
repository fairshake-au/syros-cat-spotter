/**
 * Unit tests for the queue's single write path (spec §3.1).
 *
 * The provider-level tests reproduce the review's failure sequences; these
 * pin the rules underneath them: re-read before every write, memory only
 * after the write, honest failures for user changes, replay for system ones,
 * a read-only queue when the saved text cannot be parsed, and two tabs taking
 * turns under the lock.
 */
import { describe, expect, it } from 'vitest';
import {
  QueueWriteError,
  createQueueStore,
  parseQueue,
  type QueueChange,
} from '../queueStore';
import type { PendingSighting } from '../offlineQueue';

function item(localId: string, overrides: Partial<PendingSighting> = {}): PendingSighting {
  return {
    localId,
    photoUri: `file:///photos/${localId}.jpg`,
    lat: 37.4,
    lng: 24.9,
    createdAt: '2026-09-27T10:00:00.000Z',
    status: 'queued',
    ...overrides,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One saved value, as localStorage holds it, with an await on every access. */
function makeStorage(initial: PendingSighting[] | string | null = null) {
  const state = {
    value:
      initial === null || typeof initial === 'string'
        ? initial
        : JSON.stringify(initial),
    failWrites: false,
    failReads: false,
    writes: 0,
  };
  return {
    state,
    read: async () => {
      await tick();
      if (state.failReads) throw new Error('SecurityError');
      return state.value;
    },
    write: async (raw: string) => {
      await tick();
      if (state.failWrites) throw new Error('QuotaExceededError');
      state.writes += 1;
      state.value = raw;
    },
    list: (): PendingSighting[] =>
      state.value ? (JSON.parse(state.value) as PendingSighting[]) : [],
  };
}

function makeStore(storage: ReturnType<typeof makeStorage>, withLock?: <T>(fn: () => Promise<T>) => Promise<T>) {
  const published: PendingSighting[][] = [];
  const store = createQueueStore({
    read: storage.read,
    write: storage.write,
    withLock,
    publish: (items) => published.push(items),
  });
  return { store, published };
}

/** A lock shared by several "tabs" — what navigator.locks gives each origin. */
function makeSharedLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  };
}

const add = (p: PendingSighting): QueueChange => (list) => [...list, p];
const ids = (list: PendingSighting[]) => list.map((p) => p.localId);

describe('parseQueue', () => {
  it('treats nothing saved as an empty queue', () => {
    expect(parseQueue(null)).toEqual({ ok: true, items: [] });
  });

  it('refuses text that is not a list of queue items', () => {
    expect(parseQueue('not json').ok).toBe(false);
    expect(parseQueue('{"localId":"a"}').ok).toBe(false);
    expect(parseQueue('[null]').ok).toBe(false);
  });
});

describe('queue store', () => {
  it('re-reads the saved list before every change, so a change made elsewhere is kept', async () => {
    const storage = makeStorage([item('a')]);
    const { store } = makeStore(storage);
    await store.load();

    // Another writer (another tab) adds b behind this store's back.
    storage.state.value = JSON.stringify([item('a'), item('b')]);
    await store.mutate(add(item('c')));

    expect(ids(storage.list())).toEqual(['a', 'b', 'c']);
    expect(ids(store.items())).toEqual(['a', 'b', 'c']);
  });

  it('makes writers wait for the load, even when they arrive first', async () => {
    const storage = makeStorage([item('a')]);
    const { store } = makeStore(storage);
    const early = store.mutate(add(item('b')));
    expect(store.isReady()).toBe(false);
    await store.load();
    await early;
    expect(ids(storage.list())).toEqual(['a', 'b']);
  });

  it('a user change that cannot be saved throws and leaves memory as it was', async () => {
    const storage = makeStorage([item('a')]);
    const { store } = makeStore(storage);
    await store.load();
    storage.state.failWrites = true;

    const error = await store.mutate(add(item('b'))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueWriteError);
    expect((error as QueueWriteError).reason).toBe('failed');
    expect(ids(store.items())).toEqual(['a']);
    expect(ids(storage.list())).toEqual(['a']);
  });

  it('a system change always reaches memory, and is saved with the next change', async () => {
    const storage = makeStorage([item('a')]);
    const { store } = makeStore(storage);
    await store.load();
    storage.state.failWrites = true;

    const toReview: QueueChange = (list) =>
      list.map((p) => (p.localId === 'a' ? { ...p, status: 'review' as const } : p));
    await store.mutate(toReview, 'system');
    expect(store.items()[0].status).toBe('review');
    expect(store.hasUnsavedChanges()).toBe(true);
    expect(storage.list()[0].status).toBe('queued');

    // A refresh must not lose it either.
    await store.refresh();
    expect(store.items()[0].status).toBe('review');

    storage.state.failWrites = false;
    await store.mutate(add(item('b')));
    expect(storage.list()).toMatchObject([
      { localId: 'a', status: 'review' },
      { localId: 'b', status: 'queued' },
    ]);
    expect(store.hasUnsavedChanges()).toBe(false);
  });

  it('a user change that fails does not throw away an unsaved system change', async () => {
    const storage = makeStorage([item('a')]);
    const { store } = makeStore(storage);
    await store.load();
    storage.state.failWrites = true;
    await store.mutate(
      (list) => list.map((p) => ({ ...p, status: 'review' as const })),
      'system',
    );
    await expect(store.mutate(add(item('b')))).rejects.toBeInstanceOf(QueueWriteError);
    expect(store.items()).toMatchObject([{ localId: 'a', status: 'review' }]);
    expect(store.hasUnsavedChanges()).toBe(true);
  });

  it('skips the write when a change leaves the list as it is', async () => {
    const storage = makeStorage([item('a')]);
    const { store } = makeStore(storage);
    await store.load();
    await store.mutate((list) => list);
    expect(storage.state.writes).toBe(0);
  });

  describe('loading never empties the queue', () => {
    it('keeps an unparseable saved list untouched and makes the queue read-only', async () => {
      const storage = makeStorage('{"truncated": [');
      const kept: string[] = [];
      const { store } = makeStore(storage);
      await store.load({
        onUnparseable: async (raw) => {
          kept.push(raw);
        },
      });

      expect(store.isReadOnly()).toBe(true);
      expect(kept).toEqual(['{"truncated": [']);
      const error = await store.mutate(add(item('b'))).catch((e: unknown) => e);
      expect((error as QueueWriteError).reason).toBe('read-only');
      expect(storage.state.value).toBe('{"truncated": [');
      expect(storage.state.writes).toBe(0);
    });

    it('puts the parsed list in memory even when a later load step throws', async () => {
      const storage = makeStorage([item('a'), item('b')]);
      const { store } = makeStore(storage);
      await store.load({
        afterParse: async () => {
          throw new Error('the move blew up');
        },
      });
      expect(ids(store.items())).toEqual(['a', 'b']);
      expect(store.isReadOnly()).toBe(false);
    });

    // Final review of PR #9, finding 1 — a data-loss regression. A read that
    // throws at load used to be treated as "nothing saved", so the load steps
    // ran on an empty list and the orphan sweep deleted every queued photo.
    // The sweep lives in `afterParse`; it must not run at all.
    it('a storage read failure at load skips every load step, so nothing is swept on an empty list', async () => {
      const storage = makeStorage([item('a'), item('b')]);
      storage.state.failReads = true;
      const { store } = makeStore(storage);
      let loadStepsRan = false;
      await store.load({
        afterParse: async () => {
          loadStepsRan = true;
        },
      });
      expect(loadStepsRan).toBe(false);
      expect(store.isReady()).toBe(true);
      // Not read-only: writes re-read storage, so they stay safe and recover.
      expect(store.isReadOnly()).toBe(false);
      expect(ids(storage.list())).toEqual(['a', 'b']);
    });

    it('a storage read failure at load does not let a later write erase the saved list', async () => {
      const storage = makeStorage([item('a')]);
      storage.state.failReads = true;
      const { store } = makeStore(storage);
      await store.load();
      expect(store.items()).toEqual([]);

      // Reads work again; the next save starts from what is really saved.
      storage.state.failReads = false;
      await store.mutate(add(item('b')));
      expect(ids(storage.list())).toEqual(['a', 'b']);
    });
  });

  describe('two tabs', () => {
    it('take turns under the shared lock, so neither overwrites the other', async () => {
      const storage = makeStorage([item('a')]);
      const lock = makeSharedLock();
      const tab1 = makeStore(storage, lock).store;
      const tab2 = makeStore(storage, lock).store;
      await Promise.all([tab1.load(), tab2.load()]);

      await Promise.all([
        tab1.mutate(add(item('from-tab-1'))),
        tab2.mutate(add(item('from-tab-2'))),
      ]);

      expect(ids(storage.list()).sort()).toEqual(['a', 'from-tab-1', 'from-tab-2']);
    });

    // The control: proves the test above can fail, i.e. the lock is what
    // saves the second tab's sighting.
    it('without the lock, interleaved writes lose one tab’s sighting', async () => {
      const storage = makeStorage([item('a')]);
      const tab1 = makeStore(storage).store;
      const tab2 = makeStore(storage).store;
      await Promise.all([tab1.load(), tab2.load()]);

      await Promise.all([
        tab1.mutate(add(item('from-tab-1'))),
        tab2.mutate(add(item('from-tab-2'))),
      ]);

      expect(storage.list()).toHaveLength(2);
    });
  });
});
