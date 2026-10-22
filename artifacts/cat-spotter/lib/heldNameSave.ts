import { isFirmRejection } from './usernameClaim';
import { usernameKey } from './usernameNormalize';

/** SYC-506: why the spotter ended up with a different name. */
export type HeldNameNote = { from: string; to: string; reason: 'taken' | 'refused' };

export type HeldNameResult =
  | { kind: 'saved'; username: string; note: HeldNameNote | null }
  /** No connection, a server error, or an unclear answer: keep the held name and try again later. */
  | { kind: 'retryLater' }
  /** The phone became another spotter mid-run ("Delete my data", restore): change nothing. */
  | { kind: 'abandoned' };

export interface HeldNameDeps {
  /** The name the server already has for this phone, if any. */
  read: (deviceId: string) => Promise<{ username?: string | null }>;
  claim: (deviceId: string, body: { username: string }) => Promise<{ username?: string | null }>;
  /** The held name with a number added (SunnyTabby → SunnyTabby47). */
  numbered: (name: string) => string;
  /** A fresh suggested name. */
  suggest: () => string;
  /** False once the phone is another spotter; checked before every request. */
  stillCurrent?: () => boolean;
}

/** Numbered tries after the held name is taken, then fresh suggestions. */
export const NUMBERED_TRIES = 3;
export const SUGGESTION_TRIES = 2;
/** How many times to draw a name before accepting a repeat (review F6). */
const FRESH_DRAWS = 10;

/**
 * SYC-506: save a name chosen offline, once there's a connection.
 *
 * - Read first: if the server already has a name for this phone (an earlier
 *   try landed before the app was closed, or another tab claimed one), it is
 *   adopted quietly and nothing is sent.
 * - One request at a time, each awaited to the end (the transport timeout
 *   bounds it). No screen is waiting, so there is no UI deadline, and no
 *   earlier request can still be open when another name is tried.
 * - Another name is tried only after a firm "no" for this one. A taken held
 *   name gets a number (up to three); a refused one, or a taken suggestion,
 *   gets a fresh suggestion (up to two). A refused name is never numbered.
 * - Anything unclear stops the run with the held name kept. The next run
 *   reads first, so retrying is always safe.
 * - Before every request it checks the phone is still the same spotter.
 */
export async function saveHeldName(
  deviceId: string,
  held: string,
  deps: HeldNameDeps,
): Promise<HeldNameResult> {
  const current = deps.stillCurrent ?? (() => true);
  if (!current()) return { kind: 'abandoned' };

  let existing: string | null | undefined;
  try {
    existing = (await deps.read(deviceId)).username;
  } catch {
    return { kind: 'retryLater' };
  }
  if (!current()) return { kind: 'abandoned' };
  // Review F4: this phone already has a name. Nobody "took" the held one.
  if (existing) return { kind: 'saved', username: existing, note: null };

  const tried = new Set<string>([usernameKey(held)]);
  const fresh = (make: () => string) => {
    let name = make();
    for (let i = 1; i < FRESH_DRAWS && tried.has(usernameKey(name)); i++) name = make();
    tried.add(usernameKey(name));
    return name;
  };

  let candidate = held;
  let onSuggestions = false;
  let reason: HeldNameNote['reason'] | null = null;
  let numberedLeft = NUMBERED_TRIES;
  let suggestionsLeft = SUGGESTION_TRIES;

  const savedAs = (username: string): HeldNameResult => ({
    kind: 'saved',
    username,
    note: reason && usernameKey(username) !== usernameKey(held) ? { from: held, to: username, reason } : null,
  });

  for (;;) {
    if (!current()) return { kind: 'abandoned' };
    try {
      const result = await deps.claim(deviceId, { username: candidate });
      if (!current()) return { kind: 'abandoned' };
      return result.username ? savedAs(result.username) : { kind: 'retryLater' };
    } catch (error) {
      if (!current()) return { kind: 'abandoned' };
      const status = (error as { status?: unknown } | null)?.status;
      if (!isFirmRejection(error)) {
        // No status, 5xx, 429: the write may have landed. Ask the server.
        try {
          const read = (await deps.read(deviceId)).username;
          if (!current()) return { kind: 'abandoned' };
          if (read && usernameKey(read) === usernameKey(candidate)) return savedAs(read);
        } catch {
          // still unknown
        }
        return { kind: 'retryLater' };
      }
      // 401/403: this phone's credential, not the name.
      if (status !== 409 && status !== 400) return { kind: 'retryLater' };
      reason ??= status === 409 ? 'taken' : 'refused';

      // Only a taken held name (or a taken numbered one) gets a number.
      if (status === 409 && !onSuggestions && reason === 'taken' && numberedLeft > 0) {
        numberedLeft--;
        candidate = fresh(() => deps.numbered(held));
        continue;
      }
      if (suggestionsLeft > 0) {
        suggestionsLeft--;
        onSuggestions = true;
        candidate = fresh(deps.suggest);
        continue;
      }
      return { kind: 'retryLater' };
    }
  }
}
