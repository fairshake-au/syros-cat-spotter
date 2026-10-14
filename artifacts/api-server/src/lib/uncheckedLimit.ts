// SYC-170 (spec §9.5, §8.1; plan PR 1.1): the "unchecked" limit.
//
// A public report is accepted without a Turnstile verdict only when our
// server couldn't reach Cloudflare. Those rows are fenced in twice:
//
// Per address (429 beyond it):
// - "report": 3 an hour per address, both public report forms together
//   (the cat-in-trouble form now; "Report an issue" joins this bucket in
//   SYC-44 PR 5.1).
// - "draft": 10 an hour per address, its own bucket, so a real report sent
//   during an outage doesn't use up two of its three on its own draft (plan
//   review finding 15).
//
// Island-wide (503 try_again beyond it, which the app retries with no
// strike, so nothing is lost; review of #151, finding 5): at most 30
// unchecked rows an hour across every address, reports and drafts together.
// "Unreachable" can be caused by our own load, or by a Cloudflare 429, so a
// sender with many addresses mustn't be able to turn junk tokens into an
// unbounded unchecked list.
//
// Counted in this server's memory for now. That is correct today because the
// deployment is pinned to one instance (docs/DEPLOYMENT.md, SYC-105 step 1).
// SYC-105 PR 2.1 (PR #150, `sharedLimiter`) moves write limits into Postgres:
// swap the body of `takeUncheckedAllowance` for the shared store; callers
// already await it. **When it moves, this fence must FAIL CLOSED**: a counter
// error answers 503 (retried, no strike), never "let it through". It is the
// outage fence, not the ordinary report limit, so plan review row 16's
// "welfare reports go through on a counter error" does not apply to it
// (review of #151, finding 10).
//
// Addresses are grouped like every other limit: an IPv6 address by its /56,
// an IPv4-mapped address as the IPv4 one (middlewares/newDeviceLimit.ts).
import { ipKeyGenerator } from "express-rate-limit";

export type UncheckedBucket = "report" | "draft";

export const UNCHECKED_PER_ADDRESS_PER_HOUR: Record<UncheckedBucket, number> = {
  report: 3,
  draft: 10,
};
export const UNCHECKED_ISLAND_WIDE_PER_HOUR = 30;
const WINDOW_MS = 60 * 60 * 1000;
const SWEEP_THRESHOLD = 10_000;
const ISLAND_KEY = "island";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

function keyFor(bucket: UncheckedBucket, address: string): string {
  return `${bucket}:${address === "unknown" ? address : ipKeyGenerator(address)}`;
}

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

function current(key: string, now: number): Window | undefined {
  const w = windows.get(key);
  return w && w.resetAt > now ? w : undefined;
}

function count(key: string, now: number): void {
  const w = current(key, now);
  if (w) w.count += 1;
  else windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
}

/**
 * "ok", and counted in both fences, if `address` may have one more unchecked
 * row in `bucket` now. "address" or "island" naming the fence that's full,
 * counting nothing, otherwise.
 */
export async function takeUncheckedAllowance(
  bucket: UncheckedBucket,
  address: string,
  now: number = Date.now(),
): Promise<"ok" | "address" | "island"> {
  if (windows.size > SWEEP_THRESHOLD) sweep(now);
  const key = keyFor(bucket, address);
  if ((current(key, now)?.count ?? 0) >= UNCHECKED_PER_ADDRESS_PER_HOUR[bucket]) return "address";
  if ((current(ISLAND_KEY, now)?.count ?? 0) >= UNCHECKED_ISLAND_WIDE_PER_HOUR) return "island";
  count(key, now);
  count(ISLAND_KEY, now);
  return "ok";
}

/** When `address`'s window in `bucket` resets (ms since epoch), for Retry-After. */
export function uncheckedResetAt(bucket: UncheckedBucket, address: string): number | undefined {
  return windows.get(keyFor(bucket, address))?.resetAt;
}

/** Test-only: forget every count. */
export function _resetUncheckedLimitForTests(): void {
  windows.clear();
}
