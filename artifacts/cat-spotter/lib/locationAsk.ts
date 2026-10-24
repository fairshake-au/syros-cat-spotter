import type { LocationChoice } from './locationChoice';
import type { LocationPermission } from './locationPermission';
import type { PickSource } from './mapStart';

/**
 * SYC-524: what the Spot screen shows about location after a photo.
 * 'card' = the explain-first card, 'link' = the small "Use where I am" link,
 * 'off-native' / 'off-web' = the "location is off" line, 'auto-ask' = the
 * spotter already agreed, so ask the system straight away.
 */
export type LocationAskView = 'none' | 'card' | 'link' | 'off-native' | 'off-web' | 'auto-ask';

export interface LocationAskInput {
  source: PickSource | null;
  hasPhoto: boolean;
  permission: LocationPermission;
  choice: LocationChoice;
  platform: 'web' | 'native';
  /** The spotter already answered the card for this photo (chose the map). */
  answeredThisPhoto: boolean;
  /** The first permission read has finished; until then show nothing. */
  checked: boolean;
}

export function locationAskView({
  source,
  hasPhoto,
  permission,
  choice,
  platform,
  answeredThisPhoto,
  checked,
}: LocationAskInput): LocationAskView {
  // A library photo carries its own place; only the camera and live view ask.
  if (!checked || !hasPhoto || source === null || source === 'library') return 'none';
  if (permission === 'granted') return 'none';
  if (permission === 'denied-final') return platform === 'web' ? 'off-web' : 'off-native';
  if (answeredThisPhoto || choice === 'map') return 'link';
  if (choice === 'shared') return permission === 'not-asked' ? 'auto-ask' : 'link';
  return 'card';
}
