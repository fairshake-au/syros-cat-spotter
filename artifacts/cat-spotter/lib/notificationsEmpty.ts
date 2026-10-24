/**
 * SYC-508 §4.1 (from SYC-578): which empty-inbox line to show. "Spot a cat to
 * follow its updates!" only to someone who hasn't spotted one; unknown (no
 * profile yet) gets the plain line, never a guess.
 */
export function notificationsEmptyKey(
  profile: { catsSpotted?: number } | undefined,
): 'noNotifications' | 'noNotificationsHasSpots' | 'noNotificationsYet' {
  const spotted = profile?.catsSpotted;
  if (typeof spotted !== 'number') return 'noNotificationsYet';
  return spotted > 0 ? 'noNotificationsHasSpots' : 'noNotifications';
}

/**
 * SYC-508 §3.3: nothing usable has loaded and the last try failed, or the
 * reply wasn't a list (a captive portal answering 200 with HTML). A failed
 * poll after a good load keeps the list, so it never counts.
 */
export function notificationsLoadFailed(query: { data: unknown; isError: boolean }): boolean {
  return !Array.isArray(query.data) && (query.isError || query.data !== undefined);
}
