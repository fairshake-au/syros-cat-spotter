import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

export interface Coords {
  latitude: number;
  longitude: number;
}

interface UseLocationResult {
  coords: Coords | null;
  denied: boolean;
  loading: boolean;
  refresh: () => void;
}

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
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export function useLocation(): UseLocationResult {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    setDenied(false);
    (async () => {
      try {
        if (Platform.OS === 'web') {
          const pos = await getWebPosition();
          setCoords(pos);
        } else {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            setDenied(true);
            return;
          }
          // getCurrentPositionAsync has no timeout on iOS and can hang
          // indefinitely. Show a cached fix immediately when available, and
          // cap the fresh GPS read with a hard timeout.
          const lastKnown = await Location.getLastKnownPositionAsync({
            maxAge: 5 * 60 * 1000,
          });
          if (lastKnown) {
            setCoords({
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            });
            setLoading(false);
          }
          const pos = await Promise.race([
            Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
          ]);
          if (pos) {
            setCoords({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
          } else if (!lastKnown) {
            // Timed out with no cached position either.
            setDenied(true);
          }
        }
      } catch {
        setDenied(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { coords, denied, loading, refresh };
}
