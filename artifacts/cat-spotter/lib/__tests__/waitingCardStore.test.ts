import { describe, expect, it } from 'vitest';
import { emptyRecord } from '../waitingCard';
import {
  clearWaitingRecords,
  loadWaitingRecord,
  saveWaitingRecord,
  waitingCardKey,
  type KeyValueStore,
} from '../waitingCardStore';

// SYC-48 starter-facts.md §3.4 and §9.1 tests 8 and 9: the record is
// best effort, per device, and goes with "Delete my data".

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
    getAllKeys: async () => [...data.keys()],
    multiRemove: async (keys) => keys.forEach((k) => data.delete(k)),
  };
}

describe('the waiting-card record', () => {
  it('a phone with no record starts fresh', async () => {
    expect(await loadWaitingRecord(memory(), 'd1')).toEqual(emptyRecord());
  });

  it('saves and reads back, per device', async () => {
    const s = memory();
    await saveWaitingRecord(s, 'd1', { ...emptyRecord(), tapped: true });
    expect((await loadWaitingRecord(s, 'd1'))!.tapped).toBe(true);
    expect((await loadWaitingRecord(s, 'd2'))!.tapped).toBe(false);
  });

  it('8. garbage, a wrong shape, or a storage that throws reads as null (unreadable)', async () => {
    const s = memory();
    s.data.set(waitingCardKey('d1'), '{not json');
    expect(await loadWaitingRecord(s, 'd1')).toBeNull();
    s.data.set(waitingCardKey('d1'), JSON.stringify({ v: 2 }));
    expect(await loadWaitingRecord(s, 'd1')).toBeNull();
    const broken = { ...memory(), getItem: async () => { throw new Error('quota'); } };
    expect(await loadWaitingRecord(broken, 'd1')).toBeNull();
  });

  it('a failed save is swallowed', async () => {
    const broken = { ...memory(), setItem: async () => { throw new Error('quota'); } };
    await expect(saveWaitingRecord(broken, 'd1', emptyRecord())).resolves.toBeUndefined();
  });

  it('9. Delete my data removes every waiting-card record and nothing else', async () => {
    const s = memory();
    await saveWaitingRecord(s, 'd1', emptyRecord());
    await saveWaitingRecord(s, 'd2', emptyRecord());
    s.data.set('cat-spotter/username', 'Mia');
    await clearWaitingRecords(s);
    expect([...s.data.keys()]).toEqual(['cat-spotter/username']);
  });
});

describe('loadExistingWaitingRecord', () => {
  it('is null when nothing is stored, so a wiped record is never brought back', async () => {
    const { loadExistingWaitingRecord } = await import('../waitingCardStore');
    const s = memory();
    expect(await loadExistingWaitingRecord(s, 'd1')).toBeNull();
    await saveWaitingRecord(s, 'd1', emptyRecord());
    expect(await loadExistingWaitingRecord(s, 'd1')).toEqual(emptyRecord());
  });
});
