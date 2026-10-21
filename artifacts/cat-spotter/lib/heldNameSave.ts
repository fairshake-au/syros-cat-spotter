import { isFirmRejection } from './usernameClaim';
import { usernameKey } from './usernameNormalize';

/** SYC-506: why the spotter ended up with a different name. */
export type HeldNameNote = { from: string; to: string; reason: 'taken' | 'refused' };

export type HeldNameResult =
  | { kind: 'saved'; username: string; note: HeldNameNote | null }
  /** No connection, a server error, or an unclear answer: keep the held name and try again later. */
  | { kind: 'retryLater' };

export interface HeldNameDeps {
  /** The name the server already has for this phone, if any. */
  read: (deviceId: string) => Promise<{ username?: string | null }>;
  claim: (deviceId: string, body: { username: string }) => Promise<{ username?: string | null }>;
  /** The held name with a number added (SunnyTabby → SunnyTabby47). */
  numbered: (name: string) => string;
  /** A fresh suggested name. */
  suggest: () => string;
}

/** Numbered tries after the held name is taken, then fresh suggestions. */
export const NUMBERED_TRIES = 3;
export const SUGGESTION_TRIES = 2;

/**
 * SYC-506: save a name chosen offline, once there's a connection.
 *
 * - Read first: if an earlier try landed (the app was closed before the
 *   answer arrived), the server's name is adopted and nothing is sent.
 * - One request at a time, each awaited to the end (the transport timeout
 *   bounds it). No screen is waiting, so there is no UI deadline, and no
 *   earlier request can still be open when another name is tried.
 * - Another name is tried only after a firm "no" for this one: 409 (taken)
 *   tries the name with a number, 400 (refused or invalid) a suggestion.
 * - Anything unclear stops the run with the held name kept. The next run
 *   reads first, so retrying is always safe.
 */
export async function saveHeldName(
  deviceId: string,
  held: string,
  deps: HeldNameDeps,
): Promise<HeldNameResult> {
  let existing: string | null | undefined;
  try {
    existing = (await deps.read(deviceId)).username;
  } catch {
    return { kind: 'retryLater' };
  }
  if (existing) {
    return {
      kind: 'saved',
      username: existing,
      note: usernameKey(existing) === usernameKey(held) ? null : { from: held, to: existing, reason: 'taken' },
    };
  }

  let candidate = held;
  let reason: HeldNameNote['reason'] | null = null;
  let numberedLeft = NUMBERED_TRIES;
  let suggestionsLeft = SUGGESTION_TRIES;

  for (;;) {
    try {
      const result = await deps.claim(deviceId, { username: candidate });
      const saved = result.username;
      if (!saved) return { kind: 'retryLater' };
      return {
        kind: 'saved',
        username: saved,
        note: reason && usernameKey(saved) !== usernameKey(held) ? { from: held, to: saved, reason } : null,
      };
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      if (!isFirmRejection(error)) {
        // No status, 5xx, 429: the write may have landed. Ask the server.
        try {
          const read = (await deps.read(deviceId)).username;
          if (read && usernameKey(read) === usernameKey(candidate)) {
            return {
              kind: 'saved',
              username: read,
              note: reason ? { from: held, to: read, reason } : null,
            };
          }
        } catch {
          // still unknown
        }
        return { kind: 'retryLater' };
      }
      if (status === 409 && numberedLeft > 0) {
        numberedLeft--;
        reason ??= 'taken';
        candidate = deps.numbered(held);
        continue;
      }
      if ((status === 409 || status === 400) && suggestionsLeft > 0) {
        suggestionsLeft--;
        if (status === 400 && reason === null) reason = 'refused';
        reason ??= 'taken';
        candidate = deps.suggest();
        continue;
      }
      // 401/403 (this phone's credential), or every try used up.
      return { kind: 'retryLater' };
    }
  }
}
