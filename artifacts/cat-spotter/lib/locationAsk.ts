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
  // 'denied-can-ask' only follows a no in the phone's box: the small link,
  // never the full card again, whatever was chosen.
  if (permission === 'denied-can-ask' || answeredThisPhoto || choice === 'map') return 'link';
  if (choice === 'shared') return 'auto-ask';
  return 'card';
}

/** Where a running ask started: the card, the small link, or the automatic one. */
export type AskFrom = 'card' | 'link' | 'auto' | null;

/**
 * What the screen actually treats as shown. While an ask from the card, or the
 * automatic one, waits for the phone with no position yet, the view holds at
 * 'card': no pin and no Ermoupoli start (the card stays busy; for the
 * automatic ask the phone's box is the UI). A refusal ('off-*') or a fix ends
 * the hold.
 */
export function effectiveLocationAsk({
  raw,
  askFrom,
  hasCoords,
}: {
  raw: LocationAskView;
  askFrom: AskFrom;
  hasCoords: boolean;
}): LocationAskView {
  const holding = (askFrom === 'card' || askFrom === 'auto') && !hasCoords;
  return holding && (raw === 'link' || raw === 'none') ? 'card' : raw;
}

/** The automatic ask runs once per photo, and only for the 'auto-ask' view. */
export function shouldAutoAsk(raw: LocationAskView, photo: unknown, lastAskedPhoto: unknown): boolean {
  return raw === 'auto-ask' && photo != null && photo !== lastAskedPhoto;
}
