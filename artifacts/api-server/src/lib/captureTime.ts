/**
 * Capture-time handling for sightings.
 *
 * A sighting's row timestamp used to be `defaultNow()` — the moment it reached
 * the server. That is wrong for the offline path this app deliberately pushes
 * users into: spot a cat on Monday with no signal, reconnect on Wednesday, and
 * Wednesday got the credit. Streaks and day buckets were silently wrong for
 * exactly the users the feature is for, and wrong in the flattering direction.
 *
 * The client now sends the capture time it already records on every queued
 * item. That value is client-supplied and therefore spoofable, so it is clamped
 * rather than trusted: the prize is a vanity streak, and the clamp bounds how
 * much of one anybody can manufacture.
 *
 * Clamping, not rejecting, is deliberate — refusing a sighting because a phone's
 * clock is wrong would throw away the user's photo.
 */

/** How far back a client may date a sighting. */
export const MAX_BACKDATE_MS = 30 * 86_400_000;

/** Tolerance for a phone clock that runs slightly fast. */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Resolve the timestamp to store for a sighting.
 *
 * Falls back to `now` when the client sends nothing or sends garbage, so an
 * older client (or a malformed value) behaves exactly as before this change.
 */
export function clampCaptureTime(
  capturedAt: string | null | undefined,
  now: Date = new Date(),
): Date {
  if (!capturedAt) return now;

  const parsed = Date.parse(capturedAt);
  if (Number.isNaN(parsed)) return now;

  const nowMs = now.getTime();
  // A future capture time is never legitimate; treat it as "just now" rather
  // than letting a fast clock reserve tomorrow's streak day.
  if (parsed > nowMs + MAX_FUTURE_SKEW_MS) return now;
  if (parsed < nowMs - MAX_BACKDATE_MS) return new Date(nowMs - MAX_BACKDATE_MS);

  return new Date(parsed);
}
