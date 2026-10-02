/**
 * SYC-42 plan, Slice 0 item 0.4 (test 6): the queue store is generic, so the
 * report queue in Slice 1 gets the same single serialised write path and the
 * same "never overwrite an unreadable list" rule as sightings, rather than a
 * second, weaker copy. Every existing sighting test (queueStore.test.ts and
 * the OfflineContext suites) must pass unchanged alongside this file.
 */
import { describe, expect, it } from 'vitest';
import { QueueWriteError, createQueueStore, parseQueue } from '../queueStore';

type Report = { localId: string; severity: 'urgent' | 'attention'; note: string };

function storage(initial: string | null = null) {
  const state = { value: initial };
  return {
    state,
    read: async () => state.value,
    write: async (raw: string) => {
      state.value = raw;
    },
  };
}

describe('createQueueStore<T>', () => {
  it('stores items of another shape through the same write path', async () => {
    const s = storage();
    const published: Report[][] = [];
    const store = createQueueStore<Report>({
      read: s.read,
      write: s.write,
      publish: (items) => published.push(items),
    });
    await store.load();
    await store.mutate((items) => [
      ...items,
      { localId: 'r1', severity: 'urgent', note: 'by the bakery' },
    ]);
    expect(store.items()).toEqual([
      { localId: 'r1', severity: 'urgent', note: 'by the bakery' },
    ]);
    expect(JSON.parse(s.state.value!)).toHaveLength(1);
    expect(published.at(-1)![0]!.severity).toBe('urgent');
  });

  it('never overwrites a list it cannot parse, whatever the item type', async () => {
    const s = storage('{not json');
    const store = createQueueStore<Report>({
      read: s.read,
      write: s.write,
      publish: () => undefined,
    });
    await store.load();
    expect(store.isReadOnly()).toBe(true);
    await expect(
      store.mutate((items) => [...items, { localId: 'r2', severity: 'attention', note: '' }]),
    ).rejects.toBeInstanceOf(QueueWriteError);
    expect(s.state.value).toBe('{not json');
  });

  it('a per-store item check rejects a list of the wrong shape as unreadable', async () => {
    const s = storage(JSON.stringify([{ localId: 'x' }]));
    const store = createQueueStore<Report>({
      read: s.read,
      write: s.write,
      publish: () => undefined,
      isItem: (v): v is Report =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as Report).localId === 'string' &&
        ((v as Report).severity === 'urgent' || (v as Report).severity === 'attention'),
    });
    await store.load();
    expect(store.isReadOnly()).toBe(true);
  });

  it('parseQueue keeps its old behaviour for sightings', () => {
    expect(parseQueue(null)).toEqual({ ok: true, items: [] });
    expect(parseQueue('[{"localId":"a"}]').ok).toBe(true);
    expect(parseQueue('[{"nope":1}]').ok).toBe(false);
  });
});
