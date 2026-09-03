import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Appearance, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppearancePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'cat-spotter/appearance';

interface AppearanceContextValue {
  appearance: AppearancePreference;
  isHydrated: boolean;
  setAppearance: (appearance: AppearancePreference) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(
  undefined,
);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] =
    useState<AppearancePreference>('system');
  const [isHydrated, setIsHydrated] = useState(false);
  const userSelectedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!mounted || userSelectedRef.current) return;
        if (stored === 'system' || stored === 'light' || stored === 'dark') {
          setAppearanceState(stored);
        }
      })
      .catch(() => {
        // System appearance remains the safe default if storage is unavailable.
      })
      .finally(() => {
        if (mounted && !userSelectedRef.current) {
          setIsHydrated(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const setAppearance = useCallback((nextAppearance: AppearancePreference) => {
    userSelectedRef.current = true;
    setAppearanceState(nextAppearance);
    setIsHydrated(true);
    AsyncStorage.setItem(STORAGE_KEY, nextAppearance).catch(() => {
      // The in-memory preference still applies for this session.
    });
  }, []);

  useEffect(() => {
    if (!isHydrated || Platform.OS === 'web') return;
    Appearance.setColorScheme(appearance === 'system' ? null : appearance);
  }, [appearance, isHydrated]);

  const value = useMemo(
    () => ({ appearance, isHydrated, setAppearance }),
    [appearance, isHydrated, setAppearance],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error('useAppearance must be used within AppearanceProvider');
  }
  return context;
}