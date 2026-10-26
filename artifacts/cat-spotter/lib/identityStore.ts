import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where this phone keeps its device id and secret (SYC-137, SYC-3 plan
 * Slice 2, DECISIONS Part 2d).
 *
 * - Web, and any build without the switch: AsyncStorage / localStorage, as
 *   always. Nothing here runs for them but a plain read or write.
 * - iPhone and Android builds with EXPO_PUBLIC_SECURE_IDENTITY=on: the phone's
 *   secure storage (iOS Keychain, Android Keystore-backed prefs) through
 *   `expo-secure-store`. On iPhone the Keychain survives deleting and
 *   reinstalling the app, so the same spotter comes back.
 *
 * The switch is off until SYC-596 has checked it on a real TestFlight and Play
 * build. It is ONE-WAY: once a build with it on has run, the id and secret live
 * only in secure storage, so a later build with it off would not see them and
 * would make a new spotter. Never ship it on and then off again.
 *
 * Moving across is done one key at a time, and a key is never absent from both
 * places: read the old value, write the new one, read it back and check it, and
 * only then remove the old one. Killed anywhere in that, the next launch finds
 * the value in at least one place and carries on (a leftover old copy is
 * removed once the secure copy is confirmed equal). Secure storage wins when
 * both hold a value, because after the first move every write goes there only.
 *
 * If secure storage can't be read, this throws instead of answering "nothing
 * saved": the caller would make a new identity and strand the real one.
 */
export const ID_KEY = 'cat-spotter/device-id';
export const SECRET_KEY = 'cat-spotter/device-secret';

// expo-secure-store keys allow only letters, digits, ".", "-" and "_".
const secureName = (key: string) => key.replace(/\//g, '.');

/** True when this build keeps the identity in secure storage. */
export function secureIdentityOn(): boolean {
  // Written as a literal so Expo inlines it into the bundle.
  return Platform.OS !== 'web' && process.env.EXPO_PUBLIC_SECURE_IDENTITY === 'on';
}

type SecureStoreModule = typeof import('expo-secure-store');

/**
 * Imported only when it is going to be used: its module chain assumes a native
 * runtime, so the web build and the tests never load it by accident.
 */
async function secureStore(): Promise<SecureStoreModule | null> {
  if (!secureIdentityOn()) return null;
  const SecureStore = await import('expo-secure-store');
  if (!(await SecureStore.isAvailableAsync())) return null;
  return SecureStore;
}

// Readable after the first unlock, so a background wake-up (a notification
// handled with the phone locked) can still sign its requests. Not
// "this device only": a phone restored from an iCloud backup carries the
// app's saved id and secret today, and must keep doing so.
function options(SecureStore: SecureStoreModule) {
  return { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
}

async function writeSecure(SecureStore: SecureStoreModule, key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(secureName(key), value, options(SecureStore));
  const back = await SecureStore.getItemAsync(secureName(key), options(SecureStore));
  if (back !== value) throw new Error(`Secure storage did not keep ${key}`);
}

/** One key: secure storage first, moving an old AsyncStorage copy across. */
async function readKey(SecureStore: SecureStoreModule, key: string): Promise<{ value: string | null; fromSecure: boolean }> {
  const secure = await SecureStore.getItemAsync(secureName(key), options(SecureStore));
  const old = await AsyncStorage.getItem(key);
  if (secure !== null) {
    // Confirmed in secure storage: a leftover old copy (a move that was
    // interrupted, or a reinstall that kept the Keychain) is no longer needed.
    if (old !== null) await AsyncStorage.removeItem(key);
    return { value: secure, fromSecure: old === null };
  }
  if (old === null) return { value: null, fromSecure: false };
  await writeSecure(SecureStore, key, old);
  await AsyncStorage.removeItem(key);
  return { value: old, fromSecure: false };
}

export type StoredIdentity = {
  id: string | null;
  secret: string | null;
  /**
   * The id was read from secure storage (not moved across just now). After a
   * delete and reinstall the app's own storage is empty, so the saved name and
   * cats are gone from the phone while the server still has them; the caller
   * asks the server for the name when it has none locally.
   */
  recoveredFromSecure: boolean;
};

export async function readIdentity(): Promise<StoredIdentity> {
  const SecureStore = await secureStore();
  if (!SecureStore) {
    const [id, secret] = await Promise.all([AsyncStorage.getItem(ID_KEY), AsyncStorage.getItem(SECRET_KEY)]);
    return { id, secret, recoveredFromSecure: false };
  }
  // Sequential: the two moves must not interleave their cleanup.
  const id = await readKey(SecureStore, ID_KEY);
  const secret = await readKey(SecureStore, SECRET_KEY);
  return { id: id.value, secret: secret.value, recoveredFromSecure: id.fromSecure && id.value !== null };
}

/** The saved id alone (the 410 handler reads it). */
export async function readStoredId(): Promise<string | null> {
  const SecureStore = await secureStore();
  if (!SecureStore) return AsyncStorage.getItem(ID_KEY);
  return (await readKey(SecureStore, ID_KEY)).value;
}

async function writeKey(key: string, value: string): Promise<void> {
  const SecureStore = await secureStore();
  if (!SecureStore) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await writeSecure(SecureStore, key, value);
  // An old copy would otherwise be read back as stale if secure storage were
  // ever emptied; secure storage is the only home now.
  await AsyncStorage.removeItem(key);
}

export const writeId = (id: string) => writeKey(ID_KEY, id);
export const writeSecret = (secret: string) => writeKey(SECRET_KEY, secret);

/** Forget the id and secret everywhere they could be. */
export async function removeIdentity(): Promise<void> {
  await AsyncStorage.multiRemove([ID_KEY, SECRET_KEY]);
  const SecureStore = await secureStore();
  if (!SecureStore) return;
  await SecureStore.deleteItemAsync(secureName(ID_KEY), options(SecureStore));
  await SecureStore.deleteItemAsync(secureName(SECRET_KEY), options(SecureStore));
}
