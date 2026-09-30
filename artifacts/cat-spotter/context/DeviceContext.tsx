import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getProfile,
  setDeviceSecretGetter,
} from '@workspace/api-client-react';

const STORAGE_KEY = 'cat-spotter/device-id';
const SECRET_KEY = 'cat-spotter/device-secret';
const USERNAME_KEY = 'cat-spotter/username';
const OWNED_CATS_KEY = 'cat-spotter/owned-cat-ids';

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
  /** Chosen unique username; null = not chosen yet. */
  username: string | null;
  /** True once local storage has been read (deviceId & username resolved). */
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
}

const DeviceContext = createContext<DeviceContextValue>({
  deviceId: null,
  username: null,
  isReady: false,
  startupError: null,
  setUsername: () => {},
  ownedCatIds: [],
  addOwnedCat: () => {},
});

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [ownedCatIds, setOwnedCatIds] = useState<number[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [startupError, setStartupError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedId, storedName, storedOwned, storedSecret] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEY),
            AsyncStorage.getItem(USERNAME_KEY),
            AsyncStorage.getItem(OWNED_CATS_KEY),
            AsyncStorage.getItem(SECRET_KEY),
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
    AsyncStorage.setItem(USERNAME_KEY, name);
  }, []);

  // Hydrate the owned-cat list from the server so edit rights survive
  // reinstalls / storage clears (the local cache is just a fast start).
  useEffect(() => {
    // The initial username claim must not compete with the full multi-query
    // profile hydration. Home and Profile fetch it independently after entry.
    if (!deviceId || !username) return;
    let cancelled = false;
    getProfile(deviceId)
      .then((profile) => {
        if (cancelled || !Array.isArray(profile.ownedCatIds)) return;
        setOwnedCatIds((prev) => {
          const merged = Array.from(new Set([...prev, ...profile.ownedCatIds]));
          AsyncStorage.setItem(OWNED_CATS_KEY, JSON.stringify(merged));
          return merged;
        });
      })
      .catch(() => {
        // Offline or server unreachable: keep the locally cached list.
      });
  }, [deviceId, username]);

  const addOwnedCat = useCallback((catId: number) => {
    setOwnedCatIds((prev) => {
      if (prev.includes(catId)) return prev;
      const next = [...prev, catId];
      AsyncStorage.setItem(OWNED_CATS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      deviceId,
      username,
      isReady,
      startupError,
      setUsername,
      ownedCatIds,
      addOwnedCat,
    }),
    [
      deviceId,
      username,
      isReady,
      startupError,
      setUsername,
      ownedCatIds,
      addOwnedCat,
    ],
  );
  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
