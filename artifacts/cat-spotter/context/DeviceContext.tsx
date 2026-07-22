import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDeviceSecretGetter } from '@workspace/api-client-react';

const STORAGE_KEY = 'cat-spotter/device-id';
const SECRET_KEY = 'cat-spotter/device-secret';
const USERNAME_KEY = 'cat-spotter/username';
const OWNED_CATS_KEY = 'cat-spotter/owned-cat-ids';

function makeDeviceId(): string {
  return (
    'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Private per-device secret, sent as the `X-Device-Secret` header so the
 * server can verify this device owns its deviceId. Never shown in the UI
 * and never included in URLs or request bodies.
 */
function makeDeviceSecret(): string {
  let secret = '';
  while (secret.length < 32) {
    secret += Math.random().toString(36).slice(2);
  }
  return 'sec-' + Date.now().toString(36) + '-' + secret.slice(0, 32);
}

interface DeviceContextValue {
  deviceId: string | null;
  /** Chosen unique username; null = not chosen yet. */
  username: string | null;
  /** True once local storage has been read (deviceId & username resolved). */
  isReady: boolean;
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
  setUsername: () => {},
  ownedCatIds: [],
  addOwnedCat: () => {},
});

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [ownedCatIds, setOwnedCatIds] = useState<number[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(USERNAME_KEY),
      AsyncStorage.getItem(OWNED_CATS_KEY),
      AsyncStorage.getItem(SECRET_KEY),
    ]).then(async ([storedId, storedName, storedOwned, storedSecret]) => {
      let secret = storedSecret;
      if (!secret) {
        secret = makeDeviceSecret();
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
        const id = makeDeviceId();
        await AsyncStorage.setItem(STORAGE_KEY, id);
        setDeviceId(id);
      }
      if (storedName) setUsernameState(storedName);
      setIsReady(true);
    });
  }, []);

  const setUsername = useCallback((name: string) => {
    setUsernameState(name);
    AsyncStorage.setItem(USERNAME_KEY, name);
  }, []);

  const addOwnedCat = useCallback((catId: number) => {
    setOwnedCatIds((prev) => {
      if (prev.includes(catId)) return prev;
      const next = [...prev, catId];
      AsyncStorage.setItem(OWNED_CATS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ deviceId, username, isReady, setUsername, ownedCatIds, addOwnedCat }),
    [deviceId, username, isReady, setUsername, ownedCatIds, addOwnedCat],
  );
  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
