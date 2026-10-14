// SYC-195: a cap on how many brand-new "phones" (device identities) one
// internet address can register.
//
// Registering a device costs nothing: deviceAuth.ts binds whatever id and
// secret it sees first (trust on first use). Without a cap, anyone can mint a
// fresh device, with a fresh per-device matching budget, on every request —
// the adversarial review of PR #64 found a cat's exact position in 33
// requests that way. That costs nothing extra in privacy while GET /cats
// shows exact positions, but it matters once the public map is blurred
// (SYC-41). Data spine spec §6.3 point 2 assumes registering a device is "a
// deliberate act with its own budget"; this is that budget.
//
// Only a device id the server has never seen counts. A phone that is
// already registered is never affected, whatever its address.
//
// When the cap is hit, the new phone is refused with 429 and a Retry-After;
// its id is not bound, so the same phone simply works once the window
// resets. This is NOT the defence against an attacker with many addresses —
// per-IP limits and the blurring itself are — it stops one address turning
// itself into an unlimited number of phones.
//
// The number is a judgement call, not a spec value: see the decision note on
// SYC-195. Change it here; nothing else needs to move.
//
// Counted in Postgres since SYC-105 PR 2.1 (lib/limits.ts), so the cap holds
// across servers and restarts. It relies on `trust proxy` in app.ts so req.ip
// is the real visitor (SYC-100). If the counter fails, `allowNewDevice` throws
// and the route fails closed, except on the cat-in-trouble routes, which pass
// `failOpen` so a hurt-cat report is never lost to a limiter.
import { logger, safeError } from "../lib/logger";
import { _resetBucketForTests, addressKey, consume, peek } from "../lib/limits";

export const NEW_DEVICES_PER_ADDRESS_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;
const BUCKET = "new_device";

// The address is grouped the way express-rate-limit groups it for the other
// limits (an IPv6 address by its /56 network, an IPv4-mapped one as the IPv4
// one; review of PR #93) by addressKey(), then hashed with the day's salt
// inside consume(). Nothing here stores an address.

/**
 * Returns true, and counts it, if `address` may register one more new
 * device now. Returns false once the address has used its allowance for the
 * current hour. A counter failure throws, unless `failOpen`: then it is
 * logged by the caller's catch and the phone is let through.
 */
export async function allowNewDevice(
  address: string,
  now: number = Date.now(),
  opts: { failOpen?: boolean } = {},
): Promise<boolean> {
  try {
    const r = await consume(BUCKET, addressKey(address), NEW_DEVICES_PER_ADDRESS_PER_HOUR, WINDOW_MS, undefined, now);
    return r.allowed;
  } catch (err) {
    if (opts.failOpen) {
      logger.error({ err: safeError(err), bucket: BUCKET }, "rate limit counter failed, letting the request through");
      return true;
    }
    throw err;
  }
}

/** When `address`'s current window resets (ms since epoch), for Retry-After. */
export async function newDeviceResetAt(
  address: string,
  now: number = Date.now(),
): Promise<number | undefined> {
  const r = await peek(BUCKET, addressKey(address), WINDOW_MS, undefined, now);
  return r.hits > 0 ? r.resetAt : undefined;
}

/** Test-only: forget every address's count. */
export async function _resetNewDeviceLimitForTests(): Promise<void> {
  await _resetBucketForTests(BUCKET);
}
