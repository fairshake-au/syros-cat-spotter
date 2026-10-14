import { Platform } from 'react-native';
import * as Location from 'expo-location';

export interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * The phone's position, asked for only when the person taps "Use where I am
 * now" (claiming-a-cat.md §4.2). Null if they say no, or it can't be found.
 * Nothing is kept: the caller puts the pin there and the position is gone.
 */
export async function getCurrentCoords(): Promise<Coords | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
      return await new Promise<Coords | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 },
        );
      });
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    // getCurrentPositionAsync has no timeout on iOS; cap it.
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ]);
    return pos
      ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      : null;
  } catch {
    return null;
  }
}
