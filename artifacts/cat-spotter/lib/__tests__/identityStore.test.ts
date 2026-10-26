import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYC-137: the device id and secret move into secure storage, one key at a
// time, and are never absent from both places. expo-secure-store is mocked
// here; the real Keychain is checked on a TestFlight build (SYC-596).

const h = vi.hoisted(() => ({
  async: new Map<string, string>(),
  secure: new Map<string, string>(),
  os: 'ios',
  failSecureWrite: null as null | ((key: string) => boolean),
  failSecureRead: false,
  killAfterSecureWrite: null as null | string,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.async.get(k) ?? null,
    setItem: async (k: string, v: string) => void h.async.set(k, v),
    removeItem: async (k: string) => void h.async.delete(k),
    multiRemove: async (ks: string[]) => void ks.forEach((k) => h.async.delete(k)),
  },
}));

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'after-first-unlock',
  isAvailableAsync: async () => true,
  getItemAsync: async (k: string) => {
    if (h.failSecureRead) throw new Error('keychain locked');
    return h.secure.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (h.failSecureWrite?.(k)) throw new Error('keychain write failed');
    h.secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => void h.secure.delete(k),
}));

import { readIdentity, readStoredId, removeIdentity, writeId, writeSecret } from '@/lib/identityStore';

const OLD_ID = 'dev-old';
const OLD_SECRET = 'old-secret-old-secret';

beforeEach(() => {
  h.async.clear();
  h.secure.clear();
  h.os = 'ios';
  h.failSecureWrite = null;
  h.failSecureRead = false;
  process.env.EXPO_PUBLIC_SECURE_IDENTITY = 'on';
});

describe('identityStore with the switch on (phone builds)', () => {
  it('a fresh install finds nothing, and writes go to secure storage only', async () => {
    expect(await readIdentity()).toEqual({ id: null, secret: null, recoveredFromSecure: false });
    await writeId('dev-new');
    await writeSecret('new-secret-new-secret');
    expect(h.secure.get('cat-spotter.device-id')).toBe('dev-new');
    expect(h.secure.get('cat-spotter.device-secret')).toBe('new-secret-new-secret');
    expect(h.async.has('cat-spotter/device-id')).toBe(false);
    expect(h.async.has('cat-spotter/device-secret')).toBe(false);
  });

  it('moves an existing id and secret across, then removes the old copies', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.async.set('cat-spotter/device-secret', OLD_SECRET);
    const first = await readIdentity();
    expect(first).toMatchObject({ id: OLD_ID, secret: OLD_SECRET, recoveredFromSecure: false });
    expect(h.secure.get('cat-spotter.device-id')).toBe(OLD_ID);
    expect(h.secure.get('cat-spotter.device-secret')).toBe(OLD_SECRET);
    expect(h.async.size).toBe(0);
    // The next launch reads it from secure storage.
    expect(await readIdentity()).toMatchObject({ id: OLD_ID, secret: OLD_SECRET, recoveredFromSecure: true });
  });

  it('a reinstall that kept the Keychain gets the same identity back from an empty app', async () => {
    h.secure.set('cat-spotter.device-id', OLD_ID);
    h.secure.set('cat-spotter.device-secret', OLD_SECRET);
    expect(await readIdentity()).toEqual({ id: OLD_ID, secret: OLD_SECRET, recoveredFromSecure: true });
  });

  it('killed before anything was written: the old copies are untouched and the next launch moves them', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.async.set('cat-spotter/device-secret', OLD_SECRET);
    h.failSecureWrite = () => true;
    await expect(readIdentity()).rejects.toThrow();
    expect(h.async.get('cat-spotter/device-id')).toBe(OLD_ID);
    expect(h.async.get('cat-spotter/device-secret')).toBe(OLD_SECRET);
    h.failSecureWrite = null;
    expect(await readIdentity()).toMatchObject({ id: OLD_ID, secret: OLD_SECRET });
  });

  it('killed between the two keys: each key is in at least one place, and nothing is made new', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.async.set('cat-spotter/device-secret', OLD_SECRET);
    // The id moved; the app died on the secret's write.
    h.failSecureWrite = (k) => k === 'cat-spotter.device-secret';
    await expect(readIdentity()).rejects.toThrow();
    expect(h.secure.get('cat-spotter.device-id')).toBe(OLD_ID);
    expect(h.async.has('cat-spotter/device-id')).toBe(false);
    expect(h.async.get('cat-spotter/device-secret')).toBe(OLD_SECRET);
    h.failSecureWrite = null;
    expect(await readIdentity()).toMatchObject({ id: OLD_ID, secret: OLD_SECRET });
    expect(h.async.size).toBe(0);
  });

  it('killed after the secure write but before the old copy was removed: secure wins, the leftover goes', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.secure.set('cat-spotter.device-id', OLD_ID);
    h.async.set('cat-spotter/device-secret', OLD_SECRET);
    h.secure.set('cat-spotter.device-secret', OLD_SECRET);
    expect(await readIdentity()).toMatchObject({ id: OLD_ID, secret: OLD_SECRET, recoveredFromSecure: false });
    expect(h.async.size).toBe(0);
  });

  it('refuses to move on when the written value cannot be read back', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    const { setItemAsync } = await import('expo-secure-store');
    // A write that "succeeds" but stores something else.
    h.failSecureWrite = null;
    const spy = vi.spyOn(await import('expo-secure-store'), 'setItemAsync').mockImplementation(async (k: string) => {
      h.secure.set(k, 'garbled');
    });
    await expect(readIdentity()).rejects.toThrow(/did not keep/);
    expect(h.async.get('cat-spotter/device-id')).toBe(OLD_ID);
    spy.mockRestore();
    void setItemAsync;
  });

  it('an unreadable secure store throws, so no new identity is made over the real one', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.failSecureRead = true;
    await expect(readIdentity()).rejects.toThrow(/keychain/);
    await expect(readStoredId()).rejects.toThrow();
    expect(h.async.get('cat-spotter/device-id')).toBe(OLD_ID);
  });

  it('removeIdentity clears both places', async () => {
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.secure.set('cat-spotter.device-id', OLD_ID);
    h.secure.set('cat-spotter.device-secret', OLD_SECRET);
    await removeIdentity();
    expect(h.async.size).toBe(0);
    expect(h.secure.size).toBe(0);
  });
});

describe('identityStore without the switch, and on the web build', () => {
  it('switch off on a phone: AsyncStorage only, secure storage never touched', async () => {
    process.env.EXPO_PUBLIC_SECURE_IDENTITY = 'off';
    h.async.set('cat-spotter/device-id', OLD_ID);
    await writeSecret(OLD_SECRET);
    expect(await readIdentity()).toEqual({ id: OLD_ID, secret: OLD_SECRET, recoveredFromSecure: false });
    expect(h.secure.size).toBe(0);
  });

  it('web build with the switch on: still AsyncStorage / localStorage only', async () => {
    h.os = 'web';
    h.async.set('cat-spotter/device-id', OLD_ID);
    await writeId('dev-web');
    expect(await readIdentity()).toMatchObject({ id: 'dev-web', recoveredFromSecure: false });
    expect(h.secure.size).toBe(0);
  });
});

describe('identity operations run one at a time', () => {
  it('a start-up read still moving the old copy cannot overwrite a newer id written meanwhile', async () => {
    process.env.EXPO_PUBLIC_SECURE_IDENTITY = 'on';
    h.os = 'ios';
    h.async.set('cat-spotter/device-id', OLD_ID);
    h.async.set('cat-spotter/device-secret', OLD_SECRET);
    const reading = readIdentity();
    const writing = writeId('dev-newer');
    await Promise.all([reading, writing]);
    expect(h.secure.get('cat-spotter.device-id')).toBe('dev-newer');
    expect(h.async.has('cat-spotter/device-id')).toBe(false);
  });

  it('a failed operation does not block the ones after it', async () => {
    process.env.EXPO_PUBLIC_SECURE_IDENTITY = 'on';
    h.os = 'ios';
    h.failSecureRead = true;
    await expect(readStoredId()).rejects.toThrow();
    h.failSecureRead = false;
    await writeId('dev-after');
    expect(await readStoredId()).toBe('dev-after');
  });
});
