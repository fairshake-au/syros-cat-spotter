import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cat-spotter/device-id';
const USERNAME_KEY = 'cat-spotter/username';

function makeDeviceId(): string {
  return (
    'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

interface DeviceContextValue {
  deviceId: string | null;
  /** Chosen unique username; null = not chosen yet. */
  username: string | null;
  /** True once local storage has been read (deviceId & username resolved). */
  isReady: boolean;
  /** Persist the username locally after a successful server claim. */
  setUsername: (name: string) => void;
}

const DeviceContext = createContext<DeviceContextValue>({
  deviceId: null,
  username: null,
  isReady: false,
  setUsername: () => {},
});

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [username, setUsernameState] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(USERNAME_KEY),
    ]).then(async ([storedId, storedName]) => {
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

  const value = useMemo(
    () => ({ deviceId, username, isReady, setUsername }),
    [deviceId, username, isReady, setUsername],
  );
  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
