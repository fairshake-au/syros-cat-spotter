/**
 * Wait, if need be, until the current fixed rate-limit window has `needMs`
 * left in it.
 *
 * lib/limits.ts counts a fixed window from the real clock (15 minutes for the
 * per-device match limit, so the window turns over at :00, :15, :30, :45). A
 * test that sends the whole budget plus one request and straddles that moment
 * is counted in two windows and its refusal never comes: SYC-327 failed once
 * that way. Call this first, with the window's length, before such a burst.
 * It waits only when the burst could straddle the boundary (rarely, and never
 * longer than `needMs`).
 */
export async function waitForRoomInWindow(windowMs: number, needMs = 10_000, now: () => number = Date.now): Promise<number> {
  const left = windowMs - (now() % windowMs);
  if (left >= needMs) return 0;
  const waitMs = left + 50;
  await new Promise((r) => setTimeout(r, waitMs));
  return waitMs;
}
