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

/** One spotter on a restore link's picker: an opaque choice id, never a device id (Decision 12). */
export type RestoreSpotter = { choice: string; username: string | null };

export type RestorePeek = {
  spotters: RestoreSpotter[];
  /** False when this isn't the phone or browser that asked for the link (Decision 12). */
  openedOnAskingPhone: boolean;
  /** This phone already is the spotter the link would move. */
  alreadyHere: { username: string | null } | null;
};

export function getKeepSafe(deviceId: string): Promise<KeepSafeState> {
  return customFetch<KeepSafeState>(`/api/keep-safe/${encodeURIComponent(deviceId)}`, {
    method: 'GET',
    responseType: 'json',
  });
}

/**
 * `options.timeoutMs` (SYC-524): a transport timeout for callers that must not
 * hang (onboarding); without it the client's default applies.
 */
export function addKeepSafe(
  deviceId: string,
  input: { email: string; language: Language; surface: KeepSafeSurface },
  options?: { timeoutMs?: number },
): Promise<KeepSafeState> {
  return customFetch<KeepSafeState>(`/api/keep-safe/${encodeURIComponent(deviceId)}`, {
    method: 'POST',
    body: JSON.stringify({ ...input, wordingVersion: KEEP_SAFE_WORDING_VERSION }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
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
}

export function peekRestore(deviceId: string, token: string): Promise<RestorePeek> {
  return customFetch(`/api/restore/peek`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, token }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
  });
}

/** Swaps the 8-digit emailed code for a handle that peek and redeem accept in place of the link token. */
export function exchangeRestoreCode(deviceId: string, code: string): Promise<{ handle: string }> {
  return customFetch(`/api/restore/code`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, code }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
  });
}

/** What people paste or type: spaces and line breaks dropped. */
export function normaliseCode(input: string): string {
  return input.replace(/\s+/g, '');
}

export function redeemRestore(
  deviceId: string,
  input: { token: string; choice: string; abandonCurrent: boolean; deleteCurrent?: boolean },
  options?: { timeoutMs?: number },
): Promise<{ deviceId: string; username: string | null }> {
  return customFetch(`/api/restore/redeem`, {
    method: 'POST',
    body: JSON.stringify({ deviceId, ...input }),
    headers: { 'content-type': 'application/json' },
    responseType: 'json',
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}

export function isLinkNotValid(error: unknown): boolean {
  return error instanceof ApiError && (error.data as { error?: unknown } | null)?.error === 'link_not_valid';
}

/** The server said no (any 4xx), as opposed to a network error, timeout or 5xx, which may be worth asking again. */
export function isDefiniteRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

export function isCodeNotValid(error: unknown): boolean {
  return error instanceof ApiError && (error.data as { error?: unknown } | null)?.error === 'code_not_valid';
}

export function isTooManyTries(error: unknown): boolean {
  return error instanceof ApiError && (error.data as { error?: unknown } | null)?.error === 'too_many_tries';
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
 * Where the website's password page leaves a restore link's token when the
 * tester has to sign in first (Decision 12, review finding 5): the token rides
 * in the URL fragment, which a login POST can't carry. Read once, then deleted.
 */
export const RESTORE_TOKEN_SESSION_KEY = 'cat-spotter/restore-token';
