import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cat-spotter/device-id';

function makeDeviceId(): string {
  return (
    'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

interface DeviceContextValue {
  deviceId: string | null;
}

const DeviceContext = createContext<DeviceContextValue>({ deviceId: null });

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(async (stored) => {
      if (stored) {
        setDeviceId(stored);
      } else {
        const id = makeDeviceId();
        await AsyncStorage.setItem(STORAGE_KEY, id);
        setDeviceId(id);
      }
    });
  }, []);

  const value = useMemo(() => ({ deviceId }), [deviceId]);
  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  return useContext(DeviceContext);
}
