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
// Same caveats as the other in-memory limits in rateLimit.ts: per process
// (SYC-105 moves counts into Postgres), and it relies on `trust proxy` in
// app.ts so req.ip is the real visitor (SYC-100).
import { ipKeyGenerator } from "express-rate-limit";

export const NEW_DEVICES_PER_ADDRESS_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;

// Group addresses the way express-rate-limit does for the other limits: an
// IPv6 address is counted by its /56 network, since anyone with an IPv6
// connection can pick a fresh address from their block on every request
// (review of PR #93); an IPv4-mapped address counts as the IPv4 one.
function keyFor(address: string): string {
  return address === "unknown" ? address : ipKeyGenerator(address);
}

type AddressWindow = { count: number; resetAt: number };
const windows = new Map<string, AddressWindow>();

// Same lazy sweep as rateLimit.ts's device windows: no timer, just drop
// expired entries once the Map has grown large.
const SWEEP_THRESHOLD = 10_000;

function sweep(now: number): void {
  for (const [address, window] of windows) {
    if (window.resetAt <= now) windows.delete(address);
  }
}

/**
 * Returns true, and counts it, if `address` may register one more new
 * device now. Returns false, counting nothing, once the address has used
 * its allowance for the current hour.
 */
export function allowNewDevice(address: string, now: number = Date.now()): boolean {
  if (windows.size > SWEEP_THRESHOLD) sweep(now);
  address = keyFor(address);
  const existing = windows.get(address);
  if (!existing || existing.resetAt <= now) {
    windows.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (existing.count >= NEW_DEVICES_PER_ADDRESS_PER_HOUR) return false;
  existing.count += 1;
  return true;
}

/** When `address`'s current window resets (ms since epoch), for Retry-After. */
export function newDeviceResetAt(address: string): number | undefined {
  return windows.get(keyFor(address))?.resetAt;
}

/** Test-only: forget every address's count. */
export function _resetNewDeviceLimitForTests(): void {
  windows.clear();
}
