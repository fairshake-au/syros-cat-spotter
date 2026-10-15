import rateLimit from "express-rate-limit";
import { _resetBucketForTests, consume, declareLimit, peek, sharedLimiter } from "../lib/limits";

// Per-IP throttles for public, unauthenticated endpoints.
//
// SYC-105 PR 2.1: every limit here is counted in Postgres (lib/limits.ts), so
// it holds across servers and restarts, EXCEPT the photo route's, which stays
// in each server's memory (see photoLimiter). When the counter itself fails,
// these limiters refuse with 503 (fail closed); only the cat-in-trouble
// routes (routes/reports.ts) fail open.
//
// The AI-backed endpoints (POST /api/sightings, POST /api/cats/name-suggestions)
// each trigger paid OpenAI calls, so an anonymous flood can exhaust API credits
// and take AI matching down for everyone. These limits keep normal spotting
// usage comfortable (a person spots a handful of cats per hour) while stopping
// tight-loop abuse from a single address.
//
// app.ts sets `trust proxy: 4`, measured on the live deployment
// (SYC-100, 3 Oct 2026). With it, req.ip is the real visitor, so each
// visitor gets their own limiter bucket. With a value that's too low, every
// visitor would share a Replit proxy's address and one bucket.

const common = {
  standardHeaders: true as const,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
};

// Expensive AI endpoints: strict budget.
export const aiLimiter = sharedLimiter({
  bucket: "ai",
  message: common.message,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

// The public photo route, routes/photos.ts (hosting-and-photo-storage.md §6.2 item 2): the
// route serves usage-billed compute with no auth and, until unguessable ids
// land (SYC-46/SYC-98), an enumerable integer id. This budget is generous
// enough that a tourist browsing the whole catalogue in one sitting never
// notices — a few hundred photos in fifteen minutes — while making a loop
// that walks the id range unattractive.
//
// STAYS IN MEMORY, per server, on purpose (SYC-105 PR 2.1, plan "small calls"):
// every photo on every cat list passes this limiter, so a database write per
// photo would cost more than the limit protects. It is only a cost ceiling on
// enumeration; losing it on a restart, or having it multiplied by the number
// of servers, costs nothing a visitor or the charity would notice. The write
// limits are the ones that must hold, and they are in Postgres.
//
// This is a per-IP budget, so it stands or falls on the trust-proxy hop
// count above being right for production. If it's wrong in the direction
// of "fewer hops configured than actually exist", every visitor shares one
// bucket and photos start 429ing for everyone, not just an abusive one —
// worth remembering the first time this route's rate limit looks too
// aggressive in the wild.
export const photoLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 300,
});

// POST /api/team/handoff (SYC-43 part 1 plan §5): a courtesy cap on
// signature-checking work, not a security control. Each pass is single-use in
// Postgres and every session is re-checked against the list, so nothing that
// security depends on rests on this count.
export const handoffLimiter = sharedLimiter({
  bucket: "handoff",
  message: common.message,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

// DELETE /api/me (SYC-63): a person deletes themselves once, and a retry
// after a dropped connection is safe, so a handful is plenty. Per IP rather
// than per device, because the device id here is unverified until the
// secret check, and keying on it would let a caller pick a fresh bucket.
export const deleteMeLimiter = sharedLimiter({
  bucket: "delete_me",
  message: common.message,
  windowMs: 15 * 60 * 1000,
  limit: 10,
});

// Data spine PR 5 (DECISIONS.md Part 2h; docs/superpowers/plans/data-spine.md
// §PR 5): POST /sightings' candidate matching needs BOTH limiters, for two
// different reasons, restored after an adversarial review of PR #64 found
// `aiLimiter` had been dropped from the route entirely:
//
// - `aiLimiter` (IP-keyed, above) is the cost ceiling: it caps paid OpenAI
//   vision calls and the photo/sighting rows each request writes, which a
//   freely-mintable device id (TOFU in deviceAuth.ts) can't be trusted to
//   cap on its own — nothing stops an attacker minting a fresh device per
//   request to dodge a device-only budget.
// - The per-device limiter below is the fairness fix on top of that: it
//   stops one misbehaving device from using up a whole shared address's
//   (a café's, a ferry terminal's) `aiLimiter` budget and throttling its
//   neighbours. It does NOT replace `aiLimiter` — a device that mints fresh
//   ids still hits the IP ceiling, same as before this PR. The
//   number of fresh devices one address can mint is capped by SYC-195
//   (newDeviceLimit.ts).
//
// Keyed on a device id ONLY after routes/sightings.ts has called
// verifyDeviceSecret() (SYC-107) and gotten it back — never on the raw,
// unverified body.deviceId, and never on the IP. This is a plain
// counter call rather than express-rate-limit, because the key is only known
// partway through the handler (after the secret check), not at the point
// Express picks middleware.
//
// Same budget as `aiLimiter` (20 per 15 minutes) — this PR adds a key, not a
// new shape. SYC-105 PR 2.1 moved the count into Postgres, so the budget is
// one number across every app instance and survives a restart. The key is
// hashed with the day's salt before it is stored, like an address.
export const DEVICE_MATCH_LIMIT = 20;
export const DEVICE_MATCH_WINDOW_MS = 15 * 60 * 1000;
const DEVICE_MATCH_BUCKET = "device_match";
// Declared once at load, so a clash with another limiter throws on import.
declareLimit(DEVICE_MATCH_BUCKET, DEVICE_MATCH_LIMIT, DEVICE_MATCH_WINDOW_MS);

/**
 * Returns true if `deviceId` may make another candidate-matching request
 * right now, and records that it did. Returns false once the device has used
 * its budget for the current window — i.e. the 21st call within a window
 * returns false, and the 20th returns true. Throws if the counter fails; the
 * caller (POST /sightings, not a cat-in-trouble route) fails closed.
 */
export async function checkDeviceMatchLimit(
  deviceId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const r = await consume(
    DEVICE_MATCH_BUCKET,
    deviceId,
    DEVICE_MATCH_LIMIT,
    DEVICE_MATCH_WINDOW_MS,
    undefined,
    now,
  );
  return r.allowed;
}

/**
 * The time (ms since epoch) at which `deviceId`'s current window resets, if
 * it has counted anything in it yet. Used only to put an accurate
 * `Retry-After` on a 429 — never to decide whether the request is allowed
 * (that's `checkDeviceMatchLimit`).
 */
export async function deviceMatchResetAt(
  deviceId: string,
  now: number = Date.now(),
): Promise<number | undefined> {
  const r = await peek(DEVICE_MATCH_BUCKET, deviceId, DEVICE_MATCH_WINDOW_MS, undefined, now);
  return r.hits > 0 ? r.resetAt : undefined;
}

/** Test-only: clears every device's count so tests don't leak into each other. */
export async function _resetDeviceMatchLimitForTests(): Promise<void> {
  await _resetBucketForTests(DEVICE_MATCH_BUCKET);
}

// SYC-130 (claiming-a-cat.md §8, §11; review 2 HIGH-1): claims are limited
// per phone, so a phone can't claim and let go in a loop, or move a pin
// about to learn where the PIN_TOO_FAR edge is. Every attempt counts,
// refusals included. Keyed on a device id only AFTER the claim route's
// verifyDeviceSecret has proved it, never on the raw body, as above.
// Counted in Postgres since SYC-105 PR 2.1, so it holds across servers and
// restarts. It is a SLIDING window (lib/limits.ts), so spending the limit just
// before 00:00 UTC does not hand a fresh allowance just after it: claiming is
// sensitive (an owner outranks a guardian). Fails closed (the route answers
// 503) if the counter breaks.
export const CLAIM_LIMIT = 5;
export const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLAIM_BUCKET = "claim";
declareLimit(CLAIM_BUCKET, CLAIM_LIMIT, CLAIM_WINDOW_MS, { sliding: true });

/**
 * Returns true if `deviceId` may make another claim attempt now, and
 * records that it did. About 5 per rolling 24 hours (a sliding-window estimate, lib/limits.ts):
 * the 6th call in quick succession returns false, and spending the limit
 * just before 00:00 UTC does not hand out a fresh one just after it. Throws if
 * the counter fails.
 */
export async function checkClaimLimit(
  deviceId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const r = await consume(CLAIM_BUCKET, deviceId, CLAIM_LIMIT, CLAIM_WINDOW_MS, undefined, now, {
    sliding: true,
  });
  return r.allowed;
}

/** Test-only: clears every device's claim count. */
export async function _resetClaimLimitForTests(): Promise<void> {
  await _resetBucketForTests(CLAIM_BUCKET);
}
