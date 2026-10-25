import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cat-spotter/celebration-sounds';

interface CelebrationSettingsValue {
  /** Whether the badge celebration plays its chime. On by default. */
  soundsOn: boolean;
  isHydrated: boolean;
  setSoundsOn: (on: boolean) => void;
}

const CelebrationSettingsContext = createContext<CelebrationSettingsValue | undefined>(undefined);

export function CelebrationSettingsProvider({ children }: { children: React.ReactNode }) {
  const [soundsOn, setSoundsOnState] = useState(true);
  const [isHydrated, setIsHydrated] = useState(false);
  const userChoseRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!mounted || userChoseRef.current) return;
        if (stored === 'true' || stored === 'false') setSoundsOnState(stored === 'true');
      } catch {
        // Sounds stay on if storage is unavailable.
      } finally {
        if (mounted) setIsHydrated(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setSoundsOn = useCallback((on: boolean) => {
    userChoseRef.current = true;
    setSoundsOnState(on);
    setIsHydrated(true);
    try {
      AsyncStorage.setItem(STORAGE_KEY, String(on)).catch(() => {
        // The choice still applies for this session.
      });
    } catch {
      // The choice still applies for this session.
    }
  }, []);

  const value = useMemo(() => ({ soundsOn, isHydrated, setSoundsOn }), [soundsOn, isHydrated, setSoundsOn]);

  return <CelebrationSettingsContext.Provider value={value}>{children}</CelebrationSettingsContext.Provider>;
}

export function useCelebrationSettings(): CelebrationSettingsValue {
  const context = useContext(CelebrationSettingsContext);
  if (!context) {
    throw new Error('useCelebrationSettings must be used within CelebrationSettingsProvider');
  }
  return context;
}
