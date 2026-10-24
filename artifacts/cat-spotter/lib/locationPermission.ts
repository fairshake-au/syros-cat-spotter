import { Platform } from 'react-native';
import * as Location from 'expo-location';
import type { LocationChoice } from './locationChoice';

/**
 * Where the location permission stands (SYC-524). Read without ever showing
 * the system prompt: nothing here calls a request or reads a position.
 */
export type LocationPermission =
  | 'granted'
  | 'denied-can-ask'
  | 'denied-final'
  | 'not-asked';

export function mapNativePermission(r: {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}): LocationPermission {
  if (r.status === 'granted') return 'granted';
  if (r.status === 'undetermined') return 'not-asked';
  return r.canAskAgain ? 'denied-can-ask' : 'denied-final';
}

/**
 * `state` null means the Permissions API is missing or threw (older Safari).
 * Then the remembered choice is the best evidence: a spotter who shared
 * location before is treated as still granted.
 */
export function mapWebPermission(
  state: 'granted' | 'denied' | 'prompt' | null,
  choice: LocationChoice,
): LocationPermission {
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied-final';
  if (state === 'prompt') return 'not-asked';
  return choice === 'shared' ? 'granted' : 'not-asked';
}

export async function getLocationPermission(
  choice: LocationChoice,
): Promise<LocationPermission> {
  if (Platform.OS === 'web') {
    let state: 'granted' | 'denied' | 'prompt' | null = null;
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      state = result.state;
    } catch {
      state = null;
    }
    return mapWebPermission(state, choice);
  }
  return mapNativePermission(await Location.getForegroundPermissionsAsync());
}
