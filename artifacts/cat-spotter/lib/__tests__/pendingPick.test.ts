/**
 * SYC-864: Android can close the app while the phone's camera (or photo
 * library) is open. The picker keeps the answer; the Spot screen collects it
 * with getPendingResultAsync. pendingPick remembers which button started the
 * pick, so a recovered photo goes through the same checks as a normal one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPickMark, markPickStarted, PENDING_PICK_KEY, takePendingPick } from '../pendingPick';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: async (k: string) => {
      map.delete(k);
    },
  };
}

const success = { canceled: false as const, assets: [{ uri: 'file:///cam.jpg', width: 4000, height: 3000 }] };

describe('pendingPick', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('remembers which button started the pick, and forgets it when the pick comes back', async () => {
    await markPickStarted(storage, 'camera');
    expect(storage.map.get(PENDING_PICK_KEY)).toBe('camera');
    await clearPickMark(storage);
    expect(storage.map.has(PENDING_PICK_KEY)).toBe(false);
  });

  it('hands back a recovered camera photo with where it came from', async () => {
    await markPickStarted(storage, 'camera');
    const got = await takePendingPick(storage, async () => success);
    expect(got).toEqual({ kind: 'camera', asset: success.assets[0] });
    expect(storage.map.has(PENDING_PICK_KEY)).toBe(false);
  });

  it('hands back a recovered library photo as a library photo, so its checks still run', async () => {
    await markPickStarted(storage, 'library');
    expect((await takePendingPick(storage, async () => success))?.kind).toBe('library');
  });

  it('returns nothing when there is no pending photo, and clears a stale mark', async () => {
    await markPickStarted(storage, 'camera');
    expect(await takePendingPick(storage, async () => null)).toBeNull();
    expect(storage.map.has(PENDING_PICK_KEY)).toBe(false);
  });

  it('returns nothing for a cancelled pick or a picker error', async () => {
    await markPickStarted(storage, 'camera');
    expect(await takePendingPick(storage, async () => ({ canceled: true, assets: null }))).toBeNull();
    await markPickStarted(storage, 'camera');
    expect(await takePendingPick(storage, async () => ({ code: 'ERR', message: 'x' }))).toBeNull();
  });

  it('leaves a pending photo with no mark with the picker: it did not start from the Spot buttons', async () => {
    let asked = 0;
    expect(
      await takePendingPick(storage, async () => {
        asked += 1;
        return success;
      }),
    ).toBeNull();
    expect(asked).toBe(0);
  });

  it('returns nothing, rather than throwing, when the picker or storage fails', async () => {
    await markPickStarted(storage, 'camera');
    expect(
      await takePendingPick(storage, async () => {
        throw new Error('boom');
      }),
    ).toBeNull();
  });
});
