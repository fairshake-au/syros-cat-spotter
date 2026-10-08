import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, customFetch } from '@workspace/api-client-react';
import type { Language } from './i18n';

/**
 * "Keep my spots safe" and "Get your spots back" (SYC-3 plan, Slice 1 step 8).
 *
 * Every call needs a connection: adding an address and restoring are the two
 * things here that can't work offline. Spotting itself still does.
 */

/** Which wording the person saw (email-capture.md §5.6): bump when the §3.0 copy changes. */
export const KEEP_SAFE_WORDING_VERSION = 'keep_safe.v1';

export type KeepSafeSurface = 'onboarding' | 'settings' | 'first_badge';

export type KeepSafeState =
  | { status: 'none' }
  | { status: 'pending' | 'confirmed'; addressMask: string };

export type RestoreSpotter = { deviceId: string; username: string | null };

export function getKeepSafe(deviceId: string): Promise<KeepSafeState> {
  return customFetch<KeepSafeState>(`/api/keep-safe/${encodeURIComponent(deviceId)}`, {
    method: 'GET',
    responseType: 'json',
  });
}

export function addKeepSafe(
  deviceId: string,
  input: { email: string; language: Language; surface: KeepSafeSurface },
): Promise<KeepSafeState> {
  return customFetch<KeepSafeState>(`/api/keep-safe/${encodeURIComponent(deviceId)}`, {
    method: 'POST',
    body: JSON.stringify({ ...input, wordingVersion: KEEP_SAFE_WORDING_VERSION }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
  });
}

export function removeKeepSafe(deviceId: string): Promise<void> {
  return customFetch<void>(`/api/keep-safe/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
}

/** Always answers the same way, known address or not. */
export async function requestRestore(deviceId: string, email: string): Promise<void> {
  await customFetch(`/api/restore/request`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, email }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
  });
  await rememberRestoreAsked();
}

export function peekRestore(deviceId: string, token: string): Promise<{ spotters: RestoreSpotter[] }> {
  return customFetch(`/api/restore/peek`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, token }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
  });
}

export function redeemRestore(
  deviceId: string,
  input: { token: string; spotterDeviceId: string; abandonCurrent: boolean },
): Promise<{ deviceId: string; username: string | null }> {
  return customFetch(`/api/restore/redeem`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, ...input }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
  });
}

export function isLinkNotValid(error: unknown): boolean {
  return error instanceof ApiError && (error.data as { error?: unknown } | null)?.error === 'link_not_valid';
}

export function isInvalidEmail(error: unknown): boolean {
  return error instanceof ApiError && (error.data as { error?: unknown } | null)?.error === 'invalid_email';
}

/** The same shape check the server makes, so a typo is caught before sending. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/.test(value.trim());
}

// ── Local memory ───────────────────────────────────────────────────────────

/**
 * Whether this phone has been offered "keep my spots safe" (plan step 8):
 * - unset: not yet; the screen shows (at the end of onboarding, or once for
 *   a spotter who already had a name when this version arrived);
 * - `skipped-onboarding`: skipped at onboarding; offered once more when they
 *   first have a badge (email-capture.md §8.3);
 * - `done`: saved, or declined at the one-time offer. Never asked again.
 */
export const KEEP_SAFE_OFFER_KEY = 'cat-spotter/keep-safe-offer';
export type KeepSafeOffer = null | 'skipped-onboarding' | 'done';

export async function readKeepSafeOffer(): Promise<KeepSafeOffer> {
  const value = await AsyncStorage.getItem(KEEP_SAFE_OFFER_KEY);
  return value === 'skipped-onboarding' || value === 'done' ? value : null;
}

export async function writeKeepSafeOffer(value: Exclude<KeepSafeOffer, null>): Promise<void> {
  await AsyncStorage.setItem(KEEP_SAFE_OFFER_KEY, value);
}

/**
 * When this browser last asked for a restore link. The link only works on the
 * phone that asked (Decision 2), and the server answers every failure the same
 * way, so this is how the /restore page tells "wrong browser" apart from
 * "expired or used".
 */
const RESTORE_ASKED_KEY = 'cat-spotter/restore-asked-at';
const LINK_LIFE_MS = 15 * 60 * 1000;

async function rememberRestoreAsked(): Promise<void> {
  await AsyncStorage.setItem(RESTORE_ASKED_KEY, String(Date.now()));
}

export async function askedForRestoreRecently(): Promise<boolean> {
  const value = Number(await AsyncStorage.getItem(RESTORE_ASKED_KEY));
  return Number.isFinite(value) && value > 0 && Date.now() - value < LINK_LIFE_MS + 60_000;
}
