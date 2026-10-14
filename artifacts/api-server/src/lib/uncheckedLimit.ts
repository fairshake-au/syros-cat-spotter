// SYC-170 (spec §9.5, §8.1; plan PR 1.1): the "unchecked" limit.
//
// A public report is accepted without a Turnstile verdict only when our
// server couldn't reach Cloudflare. Those rows are fenced in by their own,
// much lower per-address limit:
//
// - "report": 3 an hour per address, both public report forms together
//   (the cat-in-trouble form now; "Report an issue" joins this bucket in
//   SYC-44 PR 5.1).
// - "draft": 10 an hour per address, its own bucket, so a real report sent
//   during an outage doesn't use up two of its three on its own draft (plan
//   review finding 15).
//
// Counted in this server's memory for now. That is correct today because the
// deployment is pinned to one instance (docs/DEPLOYMENT.md, SYC-105 step 1).
// SYC-105 PR 2.1 moves write limits into Postgres: swap the body of
// `takeUncheckedAllowance` for the shared store; callers already await it.
//
// Addresses are grouped like every other limit: an IPv6 address by its /56,
// an IPv4-mapped address as the IPv4 one (middlewares/newDeviceLimit.ts).
import { ipKeyGenerator } from "express-rate-limit";

export type UncheckedBucket = "report" | "draft";

export const UNCHECKED_PER_ADDRESS_PER_HOUR: Record<UncheckedBucket, number> = {
  report: 3,
  draft: 10,
};
const WINDOW_MS = 60 * 60 * 1000;
const SWEEP_THRESHOLD = 10_000;

type AddressWindow = { count: number; resetAt: number };
const windows = new Map<string, AddressWindow>();

function keyFor(bucket: UncheckedBucket, address: string): string {
  return `${bucket}:${address === "unknown" ? address : ipKeyGenerator(address)}`;
}

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * True, and counted, if `address` may have one more unchecked row in
 * `bucket` now. False, counting nothing, once the hour's allowance is used.
 */
export async function takeUncheckedAllowance(
  bucket: UncheckedBucket,
  address: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (windows.size > SWEEP_THRESHOLD) sweep(now);
  const key = keyFor(bucket, address);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (existing.count >= UNCHECKED_PER_ADDRESS_PER_HOUR[bucket]) return false;
  existing.count += 1;
  return true;
}

/** When `address`'s window in `bucket` resets (ms since epoch), for Retry-After. */
export function uncheckedResetAt(bucket: UncheckedBucket, address: string): number | undefined {
  return windows.get(keyFor(bucket, address))?.resetAt;
}

/** Test-only: forget every count. */
export function _resetUncheckedLimitForTests(): void {
  windows.clear();
}
