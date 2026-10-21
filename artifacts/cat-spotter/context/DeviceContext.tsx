import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getProfile,
  setDeviceMovedListener,
  setDeviceSecretGetter,
} from '@workspace/api-client-react';
import {
  KEEP_SAFE_OFFER_KEY,
  readKeepSafeOffer,
  writeKeepSafeOffer,
  type KeepSafeOffer,
} from '@/lib/keepSafe';

const STORAGE_KEY = 'cat-spotter/device-id';
const SECRET_KEY = 'cat-spotter/device-secret';
const USERNAME_KEY = 'cat-spotter/username';
// SYC-506: a name chosen offline, kept on the phone until the server saves it.
const HELD_USERNAME_KEY = 'cat-spotter/held-username';
// SYC-506: "Someone already had X, so you're Y", shown in Me until dismissed.
const NAME_NOTE_KEY = 'cat-spotter/name-note';
const OWNED_CATS_KEY = 'cat-spotter/owned-cat-ids';
// Written by OwnershipNoticeBanner: which of "your" cats had a home, last seen.
const OWNERSHIP_SNAPSHOT_KEY = 'cat-spotter/ownership-snapshot';

/**
 * Everything on the phone that is this spotter, as opposed to a preference
 * (language, appearance) or the public cat list. "Delete my data" removes
 * all of it (SYC-63 plan §6.2).
 */
/**
 * The id this phone has saved, which every tab on the web shares. The 410
 * handler checks it, because a tab's own copy can be out of date (#97
 * review, finding 4).
 */
export function readStoredDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEY);
}

export const IDENTITY_KEYS = [
  STORAGE_KEY,
  SECRET_KEY,
  USERNAME_KEY,
  HELD_USERNAME_KEY,
  NAME_NOTE_KEY,
  OWNED_CATS_KEY,
  OWNERSHIP_SNAPSHOT_KEY,
] as const;

/** SYC-506: why the background save gave the spotter a different name. */
export type NameNote = { from: string; to: string; reason: 'taken' | 'refused' };

function parseNameNote(raw: string | null): NameNote | null {
  if (!raw) return null;
  try {
    const note = JSON.parse(raw);
    if (
      note &&
      typeof note.from === 'string' &&
      typeof note.to === 'string' &&
      (note.reason === 'taken' || note.reason === 'refused')
    ) {
      return { from: note.from, to: note.to, reason: note.reason };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

const BASE64URL_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Cryptographically random bytes: Web Crypto (`crypto.getRandomValues`) on
 * web, `expo-crypto` on native. Throws rather than silently falling back to
 * `Math.random()` if neither secure source is available at runtime — a
 * device id/secret minted from a weak source is worse than one that fails
 * loudly (SYC-136).
 *
 * This throw happens inside a `useEffect` in `DeviceProvider`, not during
 * render, so the top-level `ErrorBoundary` (components/ErrorBoundary.tsx)
 * does *not* catch it — React error boundaries only catch errors thrown
 * synchronously while rendering/in lifecycle methods, never a rejected
 * promise from an effect. `DeviceProvider` below catches this itself and
 * exposes it as `startupError`, which `OnboardingGate` (app/_layout.tsx)
 * renders explicitly; letting it go uncaught would leave `isReady` false
 * forever and the app stuck on a blank screen.
 *
 * `expo-crypto` is imported dynamically, only on the native branch: its
 * module chain (expo-modules-core) assumes a React Native/Expo runtime
 * (e.g. a global `__DEV__`) and blows up merely being imported anywhere
 * else, including under Vitest, where Platform.OS is 'web'
 * (react-native-web) and this branch never runs.
 */
async function getSecureRandomBytes(byteCount: number): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const webCrypto =
      typeof crypto !== 'undefined' ? crypto : (globalThis as any)?.crypto;
    if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') {
      throw new Error(
        'No cryptographically secure random source available: crypto.getRandomValues is missing',
      );
    }
    return webCrypto.getRandomValues(new Uint8Array(byteCount));
  }
  const ExpoCrypto = await import('expo-crypto');
  if (!ExpoCrypto || typeof ExpoCrypto.getRandomBytesAsync !== 'function') {
    throw new Error(
      'No cryptographically secure random source available: expo-crypto is missing',
    );
  }
  return ExpoCrypto.getRandomBytesAsync(byteCount);
}

/** Unpadded base64url, per RFC 4648 §5 — safe to send as a header value. */
function base64UrlEncode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result += BASE64URL_CHARS[b0 >> 2];
    result += BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) {
      result += BASE64URL_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    }
    if (b2 !== undefined) {
      result += BASE64URL_CHARS[b2 & 0x3f];
    }
  }
  return result;
}

/** Random base36 digits derived from `byteCount` cryptographically random bytes. */
function bytesToBase36(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value.toString(36);
}

// Same `dev-<timestamp><random>` shape as before (the server doesn't
// enforce a format, only a max length, but other client code and logs
// assume this prefix) — only the random suffix's source changed.
//
// 6 random bytes (48 bits) in base36 is 1–10 characters depending on the
// value (as few as 1 when the high-order bytes happen to be zero, as many
// as 10 at the top of the range) — padStart guarantees at least 8 before
// slice(-8) caps it at exactly 8, so neither call is redundant on its own.
async function makeDeviceId(): Promise<string> {
  const random = bytesToBase36(await getSecureRandomBytes(6))
    .padStart(8, '0')
    .slice(-8);
  return 'dev-' + Date.now().toString(36) + random;
}

/**
 * Private per-device secret, sent as the `X-Device-Secret` header so the
 * server can verify this device owns its deviceId. Never shown in the UI
 * and never included in URLs or request bodies.
 *
 * 32 cryptographically random bytes, base64url-encoded (~43 chars) — well
 * within the server's accepted length (`deviceAuth.ts`, 16–256 chars).
 */
async function makeDeviceSecret(): Promise<string> {
  return base64UrlEncode(await getSecureRandomBytes(32));
}

interface DeviceContextValue {
  deviceId: string | null;
  /**
   * The username the server has saved for this phone; null = none yet. Every
   * reader that means "a real spotter" (restore, the offline queue, the
   * keep-safe offer) reads this, never `heldUsername`.
   */
  username: string | null;
  /**
   * SYC-506: a name picked offline and kept on the phone until the server
   * saves it (then it becomes `username`). Set only while `username` is null.
   */
  heldUsername: string | null;
  /** SYC-506: keep a name chosen offline; the background save claims it later. */
  holdUsername: (name: string) => void;
  /** SYC-506: the background save renamed the spotter; shown in Me. */
  nameNote: NameNote | null;
  setNameNote: (note: NameNote | null) => void;
  /**
   * SYC-506 review F1: which spotter this phone is, as a number that changes
   * on "Delete my data", "Start again" and restore. Read live (not from a
   * render), so work started for one spotter can check it is still current
   * before it changes anything.
   */
  identityGeneration: () => number;
  /** True once local storage has been read (deviceId, username and any held name resolved). */
  isReady: boolean;
  /**
   * Set if the one-time device id/secret setup failed outright (e.g. no
   * cryptographically secure random source at runtime — SYC-136). When
   * set, `isReady` never becomes true; consumers should show a startup
   * error instead of waiting.
   */
  startupError: Error | null;
  /** Persist the username locally after a successful server claim. */
  setUsername: (name: string) => void;
  /**
   * Cat ids this device has claimed ownership of. The API never exposes
   * ownerDeviceId, so ownership is remembered locally after a successful
   * claim (and confirmed server-side on every edit via deviceId).
   */
  ownedCatIds: number[];
  /** Record a successful ownership claim for a cat. */
  addOwnedCat: (catId: number) => void;
  /** SYC-130: the owner let go of a cat; it leaves this phone's list at once. */
  removeOwnedCat: (catId: number) => void;
  /**
   * SYC-3: the server said `device_moved`. This phone's spotter was moved to
   * a new phone with "Get your spots back"; the app shows "Your spots moved
   * to a new phone" and the offline queue stops sending.
   */
  moved: boolean;
  /**
   * SYC-3: forget this phone's identity after a move (or before a restore is
   * abandoned), and start again as a new spotter with a fresh id and secret.
   * Sightings saved on the phone and not yet sent are kept, and go under the
   * new spotter once it has a name.
   */
  startAgain: () => Promise<void>;
  /**
   * SYC-3: this phone now IS the restored spotter. It keeps its own secret
   * (the server moved the spotter onto it) and takes the spotter's id and name.
   */
  adoptRestoredIdentity: (deviceId: string, username: string | null) => Promise<void>;
  /** SYC-3: whether "keep my spots safe" has been offered on this phone (lib/keepSafe.ts). */
  keepSafeOffer: KeepSafeOffer;
  setKeepSafeOffer: (value: Exclude<KeepSafeOffer, null>) => void;
  /**
   * SYC-63: forget this spotter and become a brand-new one — a new id and
   * secret, made the same way as on first launch, with no username and no
   * cats. Call only once the server has deleted the old identity.
   */
  resetIdentity: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue>({
  deviceId: null,
  username: null,
  heldUsername: null,
  holdUsername: () => {},
  nameNote: null,
  setNameNote: () => {},
  identityGeneration: () => 0,
  isReady: false,
  startupError: null,
  setUsername: () => {},
  ownedCatIds: [],
  addOwnedCat: () => {},
  removeOwnedCat: () => {},
  moved: false,
  startAgain: async () => {},
  adoptRestoredIdentity: async () => {},
  keepSafeOffer: null,
  setKeepSafeOffer: () => {},
  resetIdentity: async () => {},
});

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [heldUsername, setHeldUsernameState] = useState<string | null>(null);
  const [nameNote, setNameNoteState] = useState<NameNote | null>(null);
  const generation = useRef(0);
  const identityGeneration = useCallback(() => generation.current, []);
  const [ownedCatIds, setOwnedCatIds] = useState<number[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [startupError, setStartupError] = useState<Error | null>(null);
  const [moved, setMoved] = useState(false);
  const [keepSafeOffer, setKeepSafeOfferState] = useState<KeepSafeOffer>(null);

  useEffect(() => {
    setDeviceMovedListener(() => setMoved(true));
    return () => setDeviceMovedListener(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedId, storedName, storedOwned, storedSecret, storedHeld, storedNote] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEY),
            AsyncStorage.getItem(USERNAME_KEY),
            AsyncStorage.getItem(OWNED_CATS_KEY),
            AsyncStorage.getItem(SECRET_KEY),
            AsyncStorage.getItem(HELD_USERNAME_KEY),
            AsyncStorage.getItem(NAME_NOTE_KEY),
          ]);
        let secret = storedSecret;
        if (!secret) {
          secret = await makeDeviceSecret();
          await AsyncStorage.setItem(SECRET_KEY, secret);
        }
        setDeviceSecretGetter(() => secret);
        if (storedOwned) {
          try {
            const parsed = JSON.parse(storedOwned);
            if (Array.isArray(parsed)) {
              setOwnedCatIds(parsed.filter((n) => typeof n === 'number'));
            }
          } catch {
            // ignore corrupt storage
          }
        }
        if (storedId) {
          setDeviceId(storedId);
        } else {
          const id = await makeDeviceId();
          await AsyncStorage.setItem(STORAGE_KEY, id);
          setDeviceId(id);
        }
        if (storedName) setUsernameState(storedName);
        // A saved name wins; a held one left behind is stale.
        else if (storedHeld) setHeldUsernameState(storedHeld);
        setNameNoteState(parseNameNote(storedNote));
        setKeepSafeOfferState(await readKeepSafeOffer());
        if (!cancelled) setIsReady(true);
      } catch (error) {
        // A rejection here (most likely from getSecureRandomBytes — no
        // secure random source available, SYC-136) is NOT caught by the
        // top-level ErrorBoundary: this runs inside a useEffect, not
        // during render, and React error boundaries only catch
        // synchronous render/lifecycle errors. Without this catch,
        // isReady would simply never become true and OnboardingGate
        // would render null forever — a silent, permanent blank screen.
        console.error(
          'DeviceProvider failed to set up a device id/secret:',
          error,
        );
        if (!cancelled) {
          setStartupError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setUsername = useCallback((name: string) => {
    setUsernameState(name);
    setHeldUsernameState(null);
    AsyncStorage.setItem(USERNAME_KEY, name);
    AsyncStorage.removeItem(HELD_USERNAME_KEY);
  }, []);

  const holdUsername = useCallback((name: string) => {
    setHeldUsernameState(name);
    AsyncStorage.setItem(HELD_USERNAME_KEY, name);
  }, []);

  const setNameNote = useCallback((note: NameNote | null) => {
    setNameNoteState(note);
    if (note) AsyncStorage.setItem(NAME_NOTE_KEY, JSON.stringify(note));
    else AsyncStorage.removeItem(NAME_NOTE_KEY);
  }, []);

  // Hydrate the owned-cat list from the server so edit rights survive
  // reinstalls / storage clears (the local cache is just a fast start).
  // Cats added on this phone while the profile request is in flight. The
  // server's list replaces the saved one, but a claim that completes before
  // the answer arrives must not be lost by an answer that predates it.
  const addedDuringHydration = useRef<Set<number>>(new Set());

  useEffect(() => {
    // The initial username claim must not compete with the full multi-query
    // profile hydration. Home and Profile fetch it independently after entry.
    if (!deviceId || !username) return;
    let cancelled = false;
    addedDuringHydration.current = new Set();
    getProfile(deviceId)
      .then((profile) => {
        if (cancelled || !Array.isArray(profile.ownedCatIds)) return;
        // SYC-130 (claiming-a-cat.md §6): the server's list replaces this
        // phone's, it is not merged into it, so a cat the owner let go of
        // (or the team removed the owner from) stops showing owner controls.
        // The saved list is only the fast start while offline.
        const fromServer = Array.from(
          new Set([...profile.ownedCatIds, ...addedDuringHydration.current]),
        );
        addedDuringHydration.current = new Set();
        setOwnedCatIds(fromServer);
        AsyncStorage.setItem(OWNED_CATS_KEY, JSON.stringify(fromServer));
      })
      .catch(() => {
        // Offline or server unreachable: keep the locally cached list.
      });
  }, [deviceId, username]);

  const addOwnedCat = useCallback((catId: number) => {
    addedDuringHydration.current.add(catId);
    setOwnedCatIds((prev) => {
      if (prev.includes(catId)) return prev;
      const next = [...prev, catId];
      AsyncStorage.setItem(OWNED_CATS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeOwnedCat = useCallback((catId: number) => {
    addedDuringHydration.current.delete(catId);
    setOwnedCatIds((prev) => {
      if (!prev.includes(catId)) return prev;
      const next = prev.filter((id) => id !== catId);
      AsyncStorage.setItem(OWNED_CATS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setKeepSafeOffer = useCallback((value: Exclude<KeepSafeOffer, null>) => {
    setKeepSafeOfferState(value);
    void writeKeepSafeOffer(value);
  }, []);

  const startAgain = useCallback(async () => {
    generation.current++;
    const [id, secret] = [await makeDeviceId(), await makeDeviceSecret()];
    await AsyncStorage.multiRemove([
      USERNAME_KEY,
      HELD_USERNAME_KEY,
      NAME_NOTE_KEY,
      OWNED_CATS_KEY,
      KEEP_SAFE_OFFER_KEY,
    ]);
    await AsyncStorage.setItem(SECRET_KEY, secret);
    await AsyncStorage.setItem(STORAGE_KEY, id);
    setDeviceSecretGetter(() => secret);
    setOwnedCatIds([]);
    setKeepSafeOfferState(null);
    setUsernameState(null);
    setHeldUsernameState(null);
    setNameNoteState(null);
    setDeviceId(id);
    setMoved(false);
  }, []);

  const adoptRestoredIdentity = useCallback(async (restoredId: string, restoredName: string | null) => {
    generation.current++;
    await AsyncStorage.setItem(STORAGE_KEY, restoredId);
    if (restoredName) await AsyncStorage.setItem(USERNAME_KEY, restoredName);
    else await AsyncStorage.removeItem(USERNAME_KEY);
    // SYC-506: a name held offline was never saved; the restored one replaces it.
    await AsyncStorage.multiRemove([HELD_USERNAME_KEY, NAME_NOTE_KEY]);
    // The server's list of owned cats replaces this phone's (hydrated below).
    await AsyncStorage.removeItem(OWNED_CATS_KEY);
    // The restored spotter is already kept safe.
    await writeKeepSafeOffer('done');
    setOwnedCatIds([]);
    setKeepSafeOfferState('done');
    setDeviceId(restoredId);
    setUsernameState(restoredName);
    setHeldUsernameState(null);
    setNameNoteState(null);
    setMoved(false);
  }, []);

  const resetIdentity = useCallback(async () => {
    generation.current++;
    // Removed first: if the app dies after this, the next launch makes a
    // fresh identity anyway. If it dies before, the old id gets 410 and the
    // wipe runs again (plan §6.4).
    await AsyncStorage.multiRemove([...IDENTITY_KEYS, KEEP_SAFE_OFFER_KEY]);
    const secret = await makeDeviceSecret();
    const id = await makeDeviceId();
    await AsyncStorage.setItem(SECRET_KEY, secret);
    await AsyncStorage.setItem(STORAGE_KEY, id);
    // The new secret is in place before anything can send the new id.
    setDeviceSecretGetter(() => secret);
    setUsernameState(null);
    setHeldUsernameState(null);
    setNameNoteState(null);
    setOwnedCatIds([]);
    // SYC-3: deletion removed the keep-safe address too, so the new spotter
    // is offered "keep my spots safe" again, as after "start again".
    setKeepSafeOfferState(null);
    setMoved(false);
    setDeviceId(id);
  }, []);

  const value = useMemo(
    () => ({
      deviceId,
      username,
      heldUsername,
      holdUsername,
      nameNote,
      setNameNote,
      identityGeneration,
      isReady,
      startupError,
      setUsername,
      ownedCatIds,
      addOwnedCat,
      removeOwnedCat,
      moved,
      startAgain,
      adoptRestoredIdentity,
      keepSafeOffer,
      setKeepSafeOffer,
      resetIdentity,
    }),
    [
      moved,
      startAgain,
      adoptRestoredIdentity,
      keepSafeOffer,
      setKeepSafeOffer,
      deviceId,
      username,
      heldUsername,
      holdUsername,
      nameNote,
      setNameNote,
      identityGeneration,
      isReady,
      startupError,
      setUsername,
      ownedCatIds,
      addOwnedCat,
      removeOwnedCat,
      resetIdentity,
    ],
  );
  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
