import { ApiError } from '@workspace/api-client-react';
import { haversineKm } from '@workspace/geo';

/**
 * SYC-130, claiming-a-cat.md §4.2 and §4.4: the pieces of "This is my cat"
 * that aren't screens.
 */

/** The pin may be at most this far from where the app shows the cat (D11). */
export const HOME_PIN_REACH_M = 1000;

/**
 * Whether the pin is further than the server will accept. The server
 * measures from the same public position (the cell centre the app already
 * shows), so the app can say so before sending (spec §4.2). It never says
 * how far.
 */
export function pinTooFar(
  cat: { lat: number; lng: number },
  pin: { lat: number; lng: number },
): boolean {
  return haversineKm(cat, pin) * 1000 > HOME_PIN_REACH_M;
}

/**
 * The map reports its centre when it first appears on some phones. That is
 * not the person placing the pin, so a report that is the starting point
 * itself (to about a tenth of a metre) doesn't count as "placed or moved".
 */
export function pinMovedFrom(
  start: { lat: number; lng: number },
  next: { lat: number; lng: number },
): boolean {
  return (
    Math.abs(next.lat - start.lat) > 1e-6 || Math.abs(next.lng - start.lng) > 1e-6
  );
}

export type ClaimRefusalKey =
  | 'claimRefusedNotMet'
  | 'claimRefusedHomed'
  | 'claimRefusedNotStreet'
  | 'claimRefusedTooFar'
  | 'claimRefusedNotConfirmed'
  | 'claimRefusedLater'
  | 'claimRefusedNote'
  | 'claimNeedsConnection';

export interface ClaimRefusal {
  /** The string to show (spec §4.4). */
  key: ClaimRefusalKey;
  /** The page was out of date: refresh it (spec §4.4, 409 rows). */
  refreshPage: boolean;
}

/**
 * Turns a failed claim into the words the person sees. Reads the `code` in
 * the body, not just the HTTP status (spec §4.4). A request that got no
 * answer at all is "no connection": a claim is never saved to send later.
 */
export function claimRefusal(err: unknown): ClaimRefusal {
  if (!(err instanceof ApiError)) {
    return {
      key: err instanceof TypeError ? 'claimNeedsConnection' : 'claimRefusedLater',
      refreshPage: false,
    };
  }
  const code = (err.data as { code?: unknown } | null)?.code;
  switch (code) {
    case 'NOT_MET':
      return { key: 'claimRefusedNotMet', refreshPage: true };
    case 'ALREADY_HOMED':
      return { key: 'claimRefusedHomed', refreshPage: true };
    case 'NOT_ON_STREET':
      return { key: 'claimRefusedNotStreet', refreshPage: true };
    case 'NOT_CONFIRMED':
      return { key: 'claimRefusedNotConfirmed', refreshPage: false };
    case 'PIN_TOO_FAR':
      return { key: 'claimRefusedTooFar', refreshPage: false };
    case 'OFFENSIVE_NOTE':
      return { key: 'claimRefusedNote', refreshPage: false };
    case 'CLAIM_LIMIT':
    case 'CLAIM_COOLDOWN':
      return { key: 'claimRefusedLater', refreshPage: false };
    default:
      // The rate limit without a code, a plain 400 (never expected: the app
      // always sends a pin) and anything unforeseen.
      return { key: 'claimRefusedLater', refreshPage: false };
  }
}
