import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  getLocationPermission,
  mapNativePermission,
  type LocationPermission,
} from '@/lib/locationPermission';
import {
  readLocationChoice,
  writeLocationChoice,
  type LocationChoice,
} from '@/lib/locationChoice';

export interface Coords {
  latitude: number;
  longitude: number;
}

interface LocationContextValue {
  permission: LocationPermission;
  coords: Coords | null;
  /** True only while a read or an ask is running. */
  loading: boolean;
  /** Refused, declined, or the last ask ended without a fix. */
  denied: boolean;
  choice: LocationChoice;
  /** False until the first permission read has finished; never goes back. */
  checked: boolean;
  /** The single way to bring up the phone's / browser's location box. */
  askAndLocate(): Promise<Coords | null>;
  chooseMap(): void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

const WEB_TIMEOUT_MS = 10000;
const NATIVE_TIMEOUT_MS = 15000;
const CACHED_FIX_MAX_AGE_MS = 5 * 60 * 1000;
// The browser's PositionError code for "permission denied".
const WEB_DENIED_CODE = 1;

async function getWebPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: WEB_TIMEOUT_MS },
    );
  });
}

/**
 * Reads the position on a phone whose permission is already granted.
 * getCurrentPositionAsync has no timeout on iOS and can hang indefinitely, so
 * a cached fix is shown at once when there is one (`onCached`) and the fresh
 * GPS read is capped with a hard timeout. Null = timed out with no cached fix.
 */
async function readNativePosition(onCached: (c: Coords) => void): Promise<Coords | null> {
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: CACHED_FIX_MAX_AGE_MS,
  });
  if (lastKnown) {
    onCached({
      latitude: lastKnown.coords.latitude,
      longitude: lastKnown.coords.longitude,
    });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pos = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), NATIVE_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (pos) {
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }
  return lastKnown
    ? { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude }
    : null;
}

/**
 * SYC-524: one place that knows where location permission stands. It never
 * asks on mount; it reads the position only when permission is already
 * granted. askAndLocate() is the only thing that shows the system prompt.
 */
export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [permission, setPermission] = useState<LocationPermission>('not-asked');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [choice, setChoice] = useState<LocationChoice>(null);
  const [lastAskFailed, setLastAskFailed] = useState(false);
  const [checked, setChecked] = useState(false);

  const mounted = useRef(true);
  const choiceRef = useRef<LocationChoice>(null);
  const coordsRef = useRef<Coords | null>(null);
  // Bumped by every sync and every ask: a sync is stale once anything newer
  // has started. Asks are only made stale by a newer ask, so a permission
  // re-read that happens mid-ask can't throw the ask's answer away.
  const genRef = useRef(0);
  const askGenRef = useRef(0);

  const applyCoords = useCallback((c: Coords | null) => {
    coordsRef.current = c;
    if (!mounted.current) return;
    setCoords(c);
    // A valid fix and "the last ask failed" never show together.
    if (c) setLastAskFailed(false);
  }, []);

  const applyChoice = useCallback((c: LocationChoice) => {
    choiceRef.current = c;
    if (mounted.current) setChoice(c);
  }, []);

  const track = useCallback((delta: 1 | -1) => {
    if (mounted.current) setInFlight((n) => n + delta);
  }, []);

  const readPermission = useCallback(async (c: LocationChoice): Promise<LocationPermission> => {
    try {
      return await getLocationPermission(c);
    } catch {
      // A permission we can't read is treated as never asked.
      return 'not-asked';
    }
  }, []);

  /** Re-reads the permission; when granted and there is no fix yet, reads one. No prompt. */
  const sync = useCallback(async () => {
    const gen = ++genRef.current;
    const current = () => mounted.current && gen === genRef.current;
    track(1);
    try {
      const perm = await readPermission(choiceRef.current);
      if (!current()) return;
      setPermission(perm);
      if (perm !== 'granted') {
        applyCoords(null);
        return;
      }
      if (coordsRef.current) return;
      try {
        const pos =
          Platform.OS === 'web'
            ? await getWebPosition()
            : await readNativePosition((c) => {
                if (current()) applyCoords(c);
              });
        if (pos && current()) applyCoords(pos);
      } catch {
        // Allowed but no fix right now: coords stay null, nothing is asked.
      }
    } finally {
      track(-1);
    }
  }, [applyCoords, readPermission, track]);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      applyChoice(await readLocationChoice(AsyncStorage));
      await sync();
      if (mounted.current) setChecked(true);
    })();
    return () => {
      mounted.current = false;
    };
  }, [applyChoice, sync]);

  // Coming back from the phone's Settings (or the browser's site settings)
  // the spotter may have changed the permission; pick that up without asking.
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const onVisible = () => {
        if (document.visibilityState === 'visible') void sync();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    return () => sub.remove();
  }, [sync]);

  const askAndLocate = useCallback(async (): Promise<Coords | null> => {
    ++genRef.current;
    const askGen = ++askGenRef.current;
    const current = () => mounted.current && askGen === askGenRef.current;
    track(1);
    setLastAskFailed(false);
    let pos: Coords | null = null;
    try {
      if (Platform.OS === 'web') {
        // getCurrentPosition is what brings up the browser's box.
        let refused = false;
        try {
          pos = await getWebPosition();
        } catch (e) {
          refused = (e as { code?: number } | null)?.code === WEB_DENIED_CODE;
        }
        if (pos) {
          await writeLocationChoice(AsyncStorage, 'shared');
          if (current()) {
            applyChoice('shared');
            applyCoords(pos);
          }
        }
        const perm = await readPermission(choiceRef.current);
        // Older browsers can say "prompt" or nothing after a refusal.
        if (current()) setPermission(refused ? 'denied-final' : perm);
      } else {
        const request = await Location.requestForegroundPermissionsAsync();
        const perm = mapNativePermission(request);
        if (current()) setPermission(perm);
        if (perm === 'granted') {
          pos = await readNativePosition((c) => {
            if (current()) applyCoords(c);
          });
          if (pos) {
            await writeLocationChoice(AsyncStorage, 'shared');
            if (current()) {
              applyCoords(pos);
              applyChoice('shared');
            }
          }
        }
      }
    } catch {
      pos = null;
    } finally {
      track(-1);
    }
    // Any ask that ends without a fix counts as a failure (timeout, location
    // services off, refusal), as the old hook's `denied` did.
    if (current() && !pos) setLastAskFailed(true);
    return pos;
  }, [applyChoice, applyCoords, readPermission, track]);

  const chooseMap = useCallback(() => {
    applyChoice('map');
    void writeLocationChoice(AsyncStorage, 'map');
  }, [applyChoice]);

  const denied =
    permission === 'denied-final' || permission === 'denied-can-ask' || lastAskFailed;
  const loading = inFlight > 0;

  const value = useMemo(
    () => ({ permission, coords, loading, denied, choice, checked, askAndLocate, chooseMap }),
    [permission, coords, loading, denied, choice, checked, askAndLocate, chooseMap],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useAppLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useAppLocation must be used inside <LocationProvider>');
  return ctx;
}
