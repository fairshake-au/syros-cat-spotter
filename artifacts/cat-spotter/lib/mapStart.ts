/**
 * SYC-166 slice 4: where the "New spot" map starts (spec
 * photo-location-from-library.md §3.2 and Decision 6; plan "Slice 4").
 *
 * The map always has a start. A library photo whose phone has no usable
 * position (location refused, still searching after a few seconds, or the
 * phone is not on Syros) starts in Ermoupoli, so "Check for matches" is never
 * stuck. The camera is unchanged: it starts at the phone, and waits for it.
 *
 * Pure. Slice 5 adds the photo's own position as a first branch
 * (`photoPosition`), so the input carries the field already.
 */
import { ERMOUPOLI, isOnSyros } from './island';

/** How long a library pick waits for the phone's position (plan Decision E1). */
export const MAP_START_WAIT_MS = 4000;

export type PickSource = 'library' | 'camera' | 'live';

export interface MapStartCoords {
  latitude: number;
  longitude: number;
}

export interface MapStartInput {
  source: PickSource;
  /** The phone's position, as useLocation gives it. `loading` is not read:
   * still searching and "nothing yet" both wait out MAP_START_WAIT_MS. */
  phone: { coords: MapStartCoords | null; denied: boolean; loading: boolean };
  /** Time since the photo was picked. */
  waitedMs: number;
  /** Slice 5's. Nothing reads a photo's position yet. */
  photoPosition?: undefined;
}

export type ReadyMapStart = { status: 'ready'; coords: MapStartCoords; origin: 'phone' | 'town' };
export type MapStart = { status: 'waiting' } | ReadyMapStart;

function town(): ReadyMapStart {
  return { status: 'ready', coords: { ...ERMOUPOLI }, origin: 'town' };
}

export function resolveMapStart({ source, phone, waitedMs }: MapStartInput): MapStart {
  const { coords } = phone;
  if (source !== 'library') {
    // The camera and the live camera: as before, the phone or nothing.
    return coords ? { status: 'ready', coords, origin: 'phone' } : { status: 'waiting' };
  }
  if (coords) {
    return isOnSyros(coords.latitude, coords.longitude)
      ? { status: 'ready', coords, origin: 'phone' }
      : town();
  }
  if (phone.denied || waitedMs >= MAP_START_WAIT_MS) return town();
  return { status: 'waiting' };
}

/**
 * What the map's start becomes, given the one it has and the latest answer.
 * An Ermoupoli start gives way to a later phone fix on Syros until the spotter
 * first moves the map; after that nothing replaces it, so the pin never jumps
 * under a finger. A start from the phone is never replaced.
 */
export function nextMapStart(
  current: ReadyMapStart | null,
  resolved: MapStart,
  touched: boolean,
): ReadyMapStart | null {
  if (!current) return resolved.status === 'ready' ? resolved : null;
  if (current.origin === 'town' && !touched && resolved.status === 'ready' && resolved.origin === 'phone') {
    return resolved;
  }
  return current;
}

// About a metre. The native map reports its own first region when it settles,
// which is the start give or take rounding: that is not the spotter moving it.
const MOVE_EPSILON_DEG = 0.00001;

/** Whether the map's reported centre means the spotter moved the map. */
export function isSpotterMove(start: MapStartCoords, reported: MapStartCoords): boolean {
  return (
    Math.abs(reported.latitude - start.latitude) > MOVE_EPSILON_DEG ||
    Math.abs(reported.longitude - start.longitude) > MOVE_EPSILON_DEG
  );
}

/** The line under the map: the Ermoupoli line replaces the usual hint for a town start only. */
export function mapStartHintKey(start: ReadyMapStart | null): 'mapStartedInTown' | 'confirmLocationHint' {
  return start?.origin === 'town' ? 'mapStartedInTown' : 'confirmLocationHint';
}

/** "Check for matches" needs a start (the other conditions stay on the screen). */
export function canCheckForMatches(start: MapStart | null): boolean {
  return start?.status === 'ready';
}

/**
 * The place handed to "This cat needs help": none while the map still sits on
 * an Ermoupoli start the spotter hasn't moved, because that is our guess, not
 * where the cat is (review M1). Otherwise the pin.
 */
export function needsHelpCoords(
  start: ReadyMapStart | null,
  pin: MapStartCoords | null,
  touched: boolean,
): MapStartCoords | undefined {
  if (!pin) return undefined;
  if (start?.origin === 'town' && !touched) return undefined;
  return pin;
}
