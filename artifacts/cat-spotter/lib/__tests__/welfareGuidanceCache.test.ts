/**
 * SYC-42 plan, Slice 1 items 1.10 and 1.14, test 24: the advice and vet list
 * come from the guidance file. The app keeps the last version it downloaded,
 * and with nothing saved and no signal it uses the copy built into the app.
 * A served copy whose schema it doesn't know is ignored (Slice 0 review fix 7).
 */
import { describe, expect, it, vi } from 'vitest';
import { getGuidance } from '@workspace/welfare-guidance';
import {
  GUIDANCE_STORAGE_PREFIX,
  loadGuidance,
  refreshGuidance,
  type GuidanceStorage,
} from '../welfareGuidanceCache';

function memoryStorage(initial: Record<string, string> = {}): GuidanceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (k) => data[k] ?? null,
    setItem: async (k, v) => {
      data[k] = v;
    },
  };
}

describe('loadGuidance', () => {
  it('test 24: with storage empty and the network off, the built-in copy renders', async () => {
    const storage = memoryStorage();
    const g = await loadGuidance('el', storage);
    expect(g.copy.urgent.intro).toBe(getGuidance('el').copy.urgent.intro);
    expect(g.copy.urgent.capacity).toBe(getGuidance('el').copy.urgent.capacity);
    expect(g.vets).toHaveLength(3);
    expect(g.source).toBe('built-in');
  });

  it('a storage that throws still gives the built-in copy', async () => {
    const storage: GuidanceStorage = {
      getItem: async () => {
        throw new Error('SecurityError');
      },
      setItem: async () => undefined,
    };
    expect((await loadGuidance('fr', storage)).source).toBe('built-in');
  });

  it('uses the last downloaded version when there is one', async () => {
    const served = { ...getGuidance('en'), version: 'abcdef12' };
    served.vets = served.vets.map((v, i) => (i === 0 ? { ...v, name: 'Renamed clinic' } : v));
    const storage = memoryStorage({ [`${GUIDANCE_STORAGE_PREFIX}en`]: JSON.stringify(served) });
    const g = await loadGuidance('en', storage);
    expect(g.source).toBe('saved');
    expect(g.vets[0]!.name).toBe('Renamed clinic');
  });

  it('ignores a served or saved copy missing any field this app renders (found in the 2 Oct browser check)', async () => {
    // An API still running an older guidance file served vetList without the
    // compact labels, and the urgent screen crashed. Same schemaVersion, so
    // only a shape check catches it.
    const older = JSON.parse(JSON.stringify(getGuidance('en')));
    delete older.copy.vetList.phoneKindsShort;
    const s1 = memoryStorage({ [`${GUIDANCE_STORAGE_PREFIX}en`]: JSON.stringify(older) });
    expect((await loadGuidance('en', s1)).source).toBe('built-in');
    const s2 = memoryStorage();
    expect(await refreshGuidance('en', s2, async () => older)).toBeNull();
    const wrongType = JSON.parse(JSON.stringify(getGuidance('en')));
    wrongType.copy.urgent.steps = 'not a list';
    expect(await refreshGuidance('en', s2, async () => wrongType)).toBeNull();
  });

  it('nit (review of #55): ignores a copy whose capacity line or steps are empty', async () => {
    const s = memoryStorage();
    const blankCapacity = JSON.parse(JSON.stringify(getGuidance('en')));
    blankCapacity.copy.urgent.capacity = '';
    expect(await refreshGuidance('en', s, async () => blankCapacity)).toBeNull();
    const noSteps = JSON.parse(JSON.stringify(getGuidance('en')));
    noSteps.copy.urgent.steps = [];
    expect(await refreshGuidance('en', s, async () => noSteps)).toBeNull();
    const blankStep = JSON.parse(JSON.stringify(getGuidance('en')));
    blankStep.copy.urgent.steps[0] = '   ';
    expect(await refreshGuidance('en', s, async () => blankStep)).toBeNull();
  });

  it('ignores a saved copy with an unknown schemaVersion, or one that is malformed', async () => {
    const future = { ...getGuidance('en'), schemaVersion: 2 };
    const s1 = memoryStorage({ [`${GUIDANCE_STORAGE_PREFIX}en`]: JSON.stringify(future) });
    expect((await loadGuidance('en', s1)).source).toBe('built-in');
    const s2 = memoryStorage({ [`${GUIDANCE_STORAGE_PREFIX}en`]: '{"schemaVersion":1}' });
    expect((await loadGuidance('en', s2)).source).toBe('built-in');
    const s3 = memoryStorage({ [`${GUIDANCE_STORAGE_PREFIX}en`]: 'not json' });
    expect((await loadGuidance('en', s3)).source).toBe('built-in');
  });
});

describe('refreshGuidance', () => {
  it('saves a served copy with the known schema', async () => {
    const storage = memoryStorage();
    const fetchGuidance = vi.fn(async () => ({ ...getGuidance('fr'), version: '12345678' }));
    const g = await refreshGuidance('fr', storage, fetchGuidance);
    expect(g?.version).toBe('12345678');
    expect(JSON.parse(storage.data[`${GUIDANCE_STORAGE_PREFIX}fr`]!).version).toBe('12345678');
  });

  it('refuses to save a served copy with an unknown schema', async () => {
    const storage = memoryStorage();
    const fetchGuidance = vi.fn(async () => ({ ...getGuidance('fr'), schemaVersion: 2 }));
    expect(await refreshGuidance('fr', storage, fetchGuidance)).toBeNull();
    expect(storage.data).toEqual({});
  });

  it('a network failure changes nothing', async () => {
    const storage = memoryStorage();
    const fetchGuidance = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await refreshGuidance('en', storage, fetchGuidance)).toBeNull();
    expect(storage.data).toEqual({});
  });
});
