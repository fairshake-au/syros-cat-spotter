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
// Counted in Postgres (lib/limits.ts, SYC-105 PR 2.1), so the fence holds
// across servers and restarts. **This fence FAILS CLOSED**: if the counter
// breaks, takeUncheckedAllowance throws and the route answers 503 try_again
// (retried, no strike), never "let it through". It is the outage fence, not
// the ordinary report limit, so the cat-in-trouble routes' fail-open rule
// does not apply to it (review of #151, finding 10).
//
// A refusal counts nothing: the address and island counts are taken in one
// transaction that is rolled back when either fence is full, as the old
// in-memory version did.
//
// Addresses are grouped like every other limit: an IPv6 address by its /56,
// an IPv4-mapped address as the IPv4 one (middlewares/newDeviceLimit.ts).
import { db } from "@workspace/db";
import {
  _resetBucketForTests,
  addressKey,
  consume,
  declareLimit,
  peek,
} from "./limits";

export type UncheckedBucket = "report" | "draft";

export const UNCHECKED_PER_ADDRESS_PER_HOUR: Record<UncheckedBucket, number> = {
  report: 3,
  draft: 10,
};
export const UNCHECKED_ISLAND_WIDE_PER_HOUR = 30;
const WINDOW_MS = 60 * 60 * 1000;
const ISLAND_KEY = "island";
const ISLAND_BUCKET = "unchecked_island";
const ADDRESS_BUCKET: Record<UncheckedBucket, string> = {
  report: "unchecked_report",
  draft: "unchecked_draft",
};

// Declared once at load: a clash with another limiter throws on import.
declareLimit(ADDRESS_BUCKET.report, UNCHECKED_PER_ADDRESS_PER_HOUR.report, WINDOW_MS);
declareLimit(ADDRESS_BUCKET.draft, UNCHECKED_PER_ADDRESS_PER_HOUR.draft, WINDOW_MS);
declareLimit(ISLAND_BUCKET, UNCHECKED_ISLAND_WIDE_PER_HOUR, WINDOW_MS);

class FenceFull extends Error {
  constructor(readonly fence: "address" | "island") {
    super(`unchecked fence full: ${fence}`);
  }
}

/**
 * "ok", and counted in both fences, if `address` may have one more unchecked
 * row in `bucket` now. "address" or "island" naming the fence that's full,
 * counting nothing, otherwise. Throws if the counter fails; the caller fails
 * closed (503).
 */
export async function takeUncheckedAllowance(
  bucket: UncheckedBucket,
  address: string,
  now: number = Date.now(),
): Promise<"ok" | "address" | "island"> {
  try {
    await db.transaction(async (tx) => {
      const a = await consume(
        ADDRESS_BUCKET[bucket],
        addressKey(address),
        UNCHECKED_PER_ADDRESS_PER_HOUR[bucket],
        WINDOW_MS,
        tx,
        now,
      );
      if (!a.allowed) throw new FenceFull("address");
      const i = await consume(ISLAND_BUCKET, ISLAND_KEY, UNCHECKED_ISLAND_WIDE_PER_HOUR, WINDOW_MS, tx, now);
      if (!i.allowed) throw new FenceFull("island");
    });
    return "ok";
  } catch (err) {
    if (err instanceof FenceFull) return err.fence;
    throw err;
  }
}

/** When `address`'s window in `bucket` resets (ms since epoch), for Retry-After. */
export async function uncheckedResetAt(
  bucket: UncheckedBucket,
  address: string,
  now: number = Date.now(),
): Promise<number | undefined> {
  const r = await peek(ADDRESS_BUCKET[bucket], addressKey(address), WINDOW_MS, undefined, now);
  return r.hits > 0 ? r.resetAt : undefined;
}

/** Test-only: forget every count. */
export async function _resetUncheckedLimitForTests(): Promise<void> {
  await _resetBucketForTests(ADDRESS_BUCKET.report);
  await _resetBucketForTests(ADDRESS_BUCKET.draft);
  await _resetBucketForTests(ISLAND_BUCKET);
}
