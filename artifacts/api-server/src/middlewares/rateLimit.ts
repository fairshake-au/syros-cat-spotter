import rateLimit from "express-rate-limit";
import {
  _resetBucketForTests,
  addressKey,
  consume,
  declareLimit,
  type LimitsExecutor,
  peek,
  sharedLimiter,
} from "../lib/limits";
import { teamPerson } from "./requireTeam";

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

// SYC-36 (match-wait plan PR 1): GET /api/app-settings/:deviceId/signals,
// which a phone asks on start, on returning to the app and on reconnect. Cheap,
// but it reads the database for any id it's given. Generous, so a ferry or a
// café sharing one address doesn't trip it; a refusal only costs a phone its
// daily one-liner.
export const signalsLimiter = sharedLimiter({
  bucket: "app_settings_signals",
  message: { error: "Too many requests. Please try again later." },
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

// SYC-706 badge routes: GET /profiles/:deviceId/moments, POST .../moments/:id/celebrated
// and POST .../badges/seen. The app asks for moments on open and on resume
// and marks each moment once, so a heavy day is perhaps a few dozen calls from
// one phone.
//
// Two limits, as on POST /sightings (aiLimiter, then the per-device one):
// - A loose per-IP guard in front. The device id in the path is unverified
//   until the secret check, so the guard is what stops an address spraying
//   made-up ids at the database. It must stay loose: many phones share one
//   address on Greek mobile networks and hotel wifi, and a tight IP cap would
//   starve their celebrations.
// - The real limit, per device (120 per 15 minutes), counted only AFTER
//   requireDeviceAuth has verified the secret, so a phone is limited by its
//   own use and never by its neighbours', and a caller cannot pick a fresh
//   bucket by inventing ids. See requireBadgeDevice in routes/profiles.ts.
export const badgeMomentsIpGuard = sharedLimiter({
  bucket: "badge_moments_ip",
  message: common.message,
  windowMs: 15 * 60 * 1000,
  limit: 1000,
});

export const BADGE_MOMENTS_DEVICE_LIMIT = 120;
export const BADGE_MOMENTS_DEVICE_WINDOW_MS = 15 * 60 * 1000;
const BADGE_MOMENTS_DEVICE_BUCKET = "badge_moments_device";
declareLimit(BADGE_MOMENTS_DEVICE_BUCKET, BADGE_MOMENTS_DEVICE_LIMIT, BADGE_MOMENTS_DEVICE_WINDOW_MS);

/**
 * True if the verified `deviceId` may make another badge-route call now, and
 * records it. The 121st call in a window returns false. Throws if the counter
 * fails; the route fails closed (503).
 */
export async function checkBadgeMomentsDeviceLimit(
  deviceId: string,
  now: number = Date.now(),
): Promise<{ allowed: boolean; resetAt: number }> {
  const r = await consume(
    BADGE_MOMENTS_DEVICE_BUCKET,
    deviceId,
    BADGE_MOMENTS_DEVICE_LIMIT,
    BADGE_MOMENTS_DEVICE_WINDOW_MS,
    undefined,
    now,
  );
  return { allowed: r.allowed, resetAt: r.resetAt };
}

/** Test-only: clears every device's badge-route count. */
export async function _resetBadgeMomentsDeviceLimitForTests(): Promise<void> {
  await _resetBucketForTests(BADGE_MOMENTS_DEVICE_BUCKET);
}

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

// SYC-709: a spotter naming a cat Syros Cats left unnamed. 3 saved names per
// phone a day, so one person can't name a whole vet visit batch. A FIXED
// day (UTC midnight, 02:00 or 03:00 in Greece), not sliding: the refusal
// says "today", and a fixed window makes that true. Counted INSIDE the
// naming transaction, last, so a refused or failed name rolls its count
// back with it and two saves at once from one phone queue on the counter
// row. Keyed on a device id only after verifyDeviceSecret. The caller must
// warmSalts() before its transaction (lib/limits.ts). Fails closed.
export const NAME_CAT_LIMIT = 3;
export const NAME_CAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const NAME_CAT_BUCKET = "name_cat";
declareLimit(NAME_CAT_BUCKET, NAME_CAT_LIMIT, NAME_CAT_WINDOW_MS);

/**
 * Counts one saved name for `deviceId` through `tx` and says whether it is
 * within the day's 3, with when the day's count starts again. Throws if the
 * counter fails.
 */
export async function countNameCat(
  tx: LimitsExecutor,
  deviceId: string,
  now: number = Date.now(),
): Promise<{ allowed: boolean; resetAt: number }> {
  const r = await consume(NAME_CAT_BUCKET, deviceId, NAME_CAT_LIMIT, NAME_CAT_WINDOW_MS, tx, now);
  return { allowed: r.allowed, resetAt: r.resetAt };
}

/** Test-only: clears every phone's naming count. */
export async function _resetNameCatLimitForTests(): Promise<void> {
  await _resetBucketForTests(NAME_CAT_BUCKET);
}

// SYC-624: following and unfollowing a cat. A courtesy cap, not a security
// control: 50 calls (follow or unfollow, a re-follow counts) per phone and
// 300 per address in a rolling 24 hours, so a stuck button or a script
// can't hammer the table. Keyed on a device id only AFTER the route's
// verifyDeviceSecret has proved it. Counted in Postgres, sliding. Fails
// closed (the route answers 503) if the counter breaks.
export const FOLLOW_DEVICE_LIMIT = 50;
export const FOLLOW_ADDRESS_LIMIT = 300;
export const FOLLOW_WINDOW_MS = 24 * 60 * 60 * 1000;
const FOLLOW_DEVICE_BUCKET = "follow_device";
declareLimit(FOLLOW_DEVICE_BUCKET, FOLLOW_DEVICE_LIMIT, FOLLOW_WINDOW_MS, { sliding: true });

/**
 * A one-minute burst guard per address on both follow routes: 30 calls, well
 * above anyone tapping a button. In memory per server, like photoLimiter (a
 * burst cap protects nothing that must survive a restart); the daily caps
 * below are the ones counted in Postgres. Uses express-rate-limit directly,
 * which is the limiter CodeQL's "missing rate limiting" check recognises.
 */
export const FOLLOW_BURST_LIMIT = 30;
export const followBurstLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: FOLLOW_BURST_LIMIT,
});

/**
 * The per-address half, as middleware on both follow routes (it runs before
 * the secret check, so it is keyed on the address alone). Fails closed: if
 * the counter breaks, sharedLimiter answers 503 with Retry-After: 5.
 */
export const followAddressLimiter = sharedLimiter({
  bucket: "follow_address",
  message: common.message,
  windowMs: FOLLOW_WINDOW_MS,
  limit: FOLLOW_ADDRESS_LIMIT,
  sliding: true,
});

/**
 * Returns true if this phone may make another follow or unfollow call now,
 * and records that it did. Throws if the counter fails.
 */
export async function checkFollowLimit(
  deviceId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const r = await consume(FOLLOW_DEVICE_BUCKET, deviceId, FOLLOW_DEVICE_LIMIT, FOLLOW_WINDOW_MS, undefined, now, {
    sliding: true,
  });
  return r.allowed;
}

/** Test-only: clears every phone's and address's follow count. */
export async function _resetFollowLimitForTests(): Promise<void> {
  await _resetBucketForTests(FOLLOW_DEVICE_BUCKET);
  await _resetBucketForTests("follow_address");
}

/** Test-only: clears the burst count for one address (tests all come from ::1). */
export async function _resetFollowBurstForTests(address: string): Promise<void> {
  await followBurstLimiter.resetKey(addressKey(address));
}

// The team map's pictures, GET /api/team/map-tiles/:tile (SYC-209 PR 3.1).
// Behind a session, so this is a courtesy cap on the server's work, not a
// security control (what we ask OpenStreetMap for is held down by the cache
// and the backoff in lib/mapTiles/tileCache.ts). A map page draws its one
// picture at five sizes (one per screen-width band; a browser may fetch
// them all), so 5 a page; 5000 leaves room for a team in one office
// panning quickly. Pictures seen again in the same hour come from the
// browser's own cache and don't count.
//
// STAYS IN MEMORY, per server, like photoLimiter and for the same reason
// (SYC-105 PR 2.1): a page loads five pictures, so a database write per
// picture would cost more than this courtesy cap protects. It sits behind a
// signed-in session; nothing security depends on rests on it.
export const mapTileLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 5000,
});

// The island map's single squares, GET /api/team/map-square/:token (SYC-396
// PR 1.5; spec §6.3; plan Decision 7): at most 300 squares per PERSON per 10
// minutes, to protect OpenStreetMap's goodwill and our 200 MB picture cache.
// Counted per signed-in person, never per address: a team sharing an office
// connection must not share one budget, and one person on two devices must
// not get two. In Postgres, so it holds across servers and restarts. It runs
// after requireTeam, so the person is known; squares seen again within the
// hour come from the browser's own cache and don't count.
export const MAP_SQUARES_BUCKET = "map_squares";
export const MAP_SQUARES_LIMIT = 300;
export const MAP_SQUARES_WINDOW_MS = 10 * 60 * 1000;
// Sliding, so a window boundary never hands out a second 300 at once
// (adversarial review of PR #230, finding 4).
export const mapSquareLimiter = sharedLimiter({
  bucket: MAP_SQUARES_BUCKET,
  message: { error: "Too many map pictures. Please try again in a few minutes." },
  windowMs: MAP_SQUARES_WINDOW_MS,
  limit: MAP_SQUARES_LIMIT,
  sliding: true,
  key: (_req, res) => `person:${teamPerson(res).id}`,
});

// The square-token requests, POST /api/team/map-squares (review of PR #230,
// finding 3). Minting is cheap (no picture is fetched), but it shouldn't be
// free without end: 120 asks per person per 10 minutes is far more than a
// map ever makes (one or two per pan or zoom), at up to 64 squares each.
export const MAP_SQUARE_TOKENS_BUCKET = "map_square_tokens";
export const MAP_SQUARE_TOKENS_LIMIT = 120;
export const mapSquareTokensLimiter = sharedLimiter({
  bucket: MAP_SQUARE_TOKENS_BUCKET,
  message: { error: "Too many map requests. Please try again in a few minutes." },
  windowMs: MAP_SQUARES_WINDOW_MS,
  limit: MAP_SQUARE_TOKENS_LIMIT,
  key: (_req, res) => `person:${teamPerson(res).id}`,
});

// Find from a photo (SYC-396 PR 2.5; dashboard spec §5.2): each search makes
// up to 4 paid AI calls, so searches are capped at 20 a day for each team
// member and 100 a day across the team. Counted per signed-in PERSON, never
// per address, in Postgres (one count across servers and restarts). SLIDING,
// as the claim limit is, so spending the cap just before 00:00 UTC hands out
// no fresh one just after it. What it guarantees exactly: at most 20 (100)
// in any one UTC day. It is an estimate across the day's edge, so a long
// rolling stretch can see more: 20 at 23:59 and 19 more the next evening is
// 39 in 23 hours (adversarial review of #252, finding 3; SYC-496). The spec
// sets the numbers after a week of measured cost; these are the starting caps.
export const FIND_PHOTO_PERSON_LIMIT = 20;
export const FIND_PHOTO_TEAM_LIMIT = 100;
export const FIND_PHOTO_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIND_PHOTO_PERSON_BUCKET = "find_photo_person";
const FIND_PHOTO_TEAM_BUCKET = "find_photo_team";
const FIND_PHOTO_TEAM_KEY = "team";
declareLimit(FIND_PHOTO_PERSON_BUCKET, FIND_PHOTO_PERSON_LIMIT, FIND_PHOTO_WINDOW_MS, { sliding: true });
declareLimit(FIND_PHOTO_TEAM_BUCKET, FIND_PHOTO_TEAM_LIMIT, FIND_PHOTO_WINDOW_MS, { sliding: true });

export type FindLimit = "ok" | "person" | "team";

/**
 * Counts one search against both caps and says whether it may run. The
 * person's cap is consumed FIRST, and the team's only if the person is still
 * within theirs: a person who has used their 20 can't use up the team's 100
 * by trying again. And while the team's 100 are used up, a try is refused
 * before the person's count is touched, so waiting for the team's cap to
 * free up doesn't cost anyone their own searches (review finding 4). Throws
 * if the counter fails; the route answers with its own page (fails closed).
 */
export async function checkFindLimits(personId: string, now: number = Date.now()): Promise<FindLimit> {
  const teamNow = await peek(FIND_PHOTO_TEAM_BUCKET, FIND_PHOTO_TEAM_KEY, FIND_PHOTO_WINDOW_MS, undefined, now, {
    sliding: true,
    limit: FIND_PHOTO_TEAM_LIMIT,
  });
  if (teamNow.hits >= FIND_PHOTO_TEAM_LIMIT) return "team";
  const mine = await consume(
    FIND_PHOTO_PERSON_BUCKET,
    `person:${personId}`,
    FIND_PHOTO_PERSON_LIMIT,
    FIND_PHOTO_WINDOW_MS,
    undefined,
    now,
    { sliding: true },
  );
  if (!mine.allowed) return "person";
  const team = await consume(
    FIND_PHOTO_TEAM_BUCKET,
    FIND_PHOTO_TEAM_KEY,
    FIND_PHOTO_TEAM_LIMIT,
    FIND_PHOTO_WINDOW_MS,
    undefined,
    now,
    { sliding: true },
  );
  return team.allowed ? "ok" : "team";
}

/** A person's count so far (an estimate, as every sliding count is). For tests. */
export async function findPersonHits(personId: string, now: number = Date.now()): Promise<number> {
  return (
    await peek(FIND_PHOTO_PERSON_BUCKET, `person:${personId}`, FIND_PHOTO_WINDOW_MS, undefined, now, {
      sliding: true,
      limit: FIND_PHOTO_PERSON_LIMIT,
    })
  ).hits;
}

/**
 * Whether a cap is already reached, without counting anything: the form
 * says so before a photo is chosen (§5.2, "the page shows the cap once it's
 * reached"). Never decides whether a search runs; `checkFindLimits` does.
 */
export async function findLimitReached(personId: string, now: number = Date.now()): Promise<FindLimit> {
  const opts = (limit: number) => ({ sliding: true, limit });
  const mine = await peek(FIND_PHOTO_PERSON_BUCKET, `person:${personId}`, FIND_PHOTO_WINDOW_MS, undefined, now, opts(FIND_PHOTO_PERSON_LIMIT));
  if (mine.hits >= FIND_PHOTO_PERSON_LIMIT) return "person";
  const team = await peek(FIND_PHOTO_TEAM_BUCKET, FIND_PHOTO_TEAM_KEY, FIND_PHOTO_WINDOW_MS, undefined, now, opts(FIND_PHOTO_TEAM_LIMIT));
  return team.hits >= FIND_PHOTO_TEAM_LIMIT ? "team" : "ok";
}

/** The team's count so far (an estimate, as every sliding count is). For tests. */
export async function findTeamHits(now: number = Date.now()): Promise<number> {
  return (await peek(FIND_PHOTO_TEAM_BUCKET, FIND_PHOTO_TEAM_KEY, FIND_PHOTO_WINDOW_MS, undefined, now, { sliding: true, limit: FIND_PHOTO_TEAM_LIMIT })).hits;
}

/** Test-only: clears both Find-from-a-photo counts. */
export async function _resetFindLimitsForTests(): Promise<void> {
  await _resetBucketForTests(FIND_PHOTO_PERSON_BUCKET);
  await _resetBucketForTests(FIND_PHOTO_TEAM_BUCKET);
}

// Vet visit batches, photo search (SYC-677 Task 5): a round of up to 40 cats
// is matched one photo at a time, so it has its own, larger counts, kept
// apart from the single-photo page's 20 and 100. A name or SYR lookup is not
// a search and is never counted here.
export const BATCH_FIND_PERSON_LIMIT = 60;
export const BATCH_FIND_TEAM_LIMIT = 200;
const BATCH_FIND_PERSON_BUCKET = "batch_find_person";
const BATCH_FIND_TEAM_BUCKET = "batch_find_team";
const BATCH_FIND_TEAM_KEY = "team";
declareLimit(BATCH_FIND_PERSON_BUCKET, BATCH_FIND_PERSON_LIMIT, FIND_PHOTO_WINDOW_MS, { sliding: true });
declareLimit(BATCH_FIND_TEAM_BUCKET, BATCH_FIND_TEAM_LIMIT, FIND_PHOTO_WINDOW_MS, { sliding: true });

/** As `checkFindLimits`, for a batch cat's photo search: counts one search against the 60 and 200. */
export async function checkBatchFindLimits(personId: string, now: number = Date.now()): Promise<FindLimit> {
  const teamNow = await peek(BATCH_FIND_TEAM_BUCKET, BATCH_FIND_TEAM_KEY, FIND_PHOTO_WINDOW_MS, undefined, now, {
    sliding: true,
    limit: BATCH_FIND_TEAM_LIMIT,
  });
  if (teamNow.hits >= BATCH_FIND_TEAM_LIMIT) return "team";
  const mine = await consume(
    BATCH_FIND_PERSON_BUCKET,
    `person:${personId}`,
    BATCH_FIND_PERSON_LIMIT,
    FIND_PHOTO_WINDOW_MS,
    undefined,
    now,
    { sliding: true },
  );
  if (!mine.allowed) return "person";
  const team = await consume(
    BATCH_FIND_TEAM_BUCKET,
    BATCH_FIND_TEAM_KEY,
    BATCH_FIND_TEAM_LIMIT,
    FIND_PHOTO_WINDOW_MS,
    undefined,
    now,
    { sliding: true },
  );
  return team.allowed ? "ok" : "team";
}

/** A person's batch-search count so far. For tests. */
export async function batchFindPersonHits(personId: string, now: number = Date.now()): Promise<number> {
  return (
    await peek(BATCH_FIND_PERSON_BUCKET, `person:${personId}`, FIND_PHOTO_WINDOW_MS, undefined, now, {
      sliding: true,
      limit: BATCH_FIND_PERSON_LIMIT,
    })
  ).hits;
}

/** Whether a batch cap is already reached, without counting anything. */
export async function batchFindLimitReached(personId: string, now: number = Date.now()): Promise<FindLimit> {
  const opts = (limit: number) => ({ sliding: true, limit });
  const mine = await peek(BATCH_FIND_PERSON_BUCKET, `person:${personId}`, FIND_PHOTO_WINDOW_MS, undefined, now, opts(BATCH_FIND_PERSON_LIMIT));
  if (mine.hits >= BATCH_FIND_PERSON_LIMIT) return "person";
  const team = await peek(BATCH_FIND_TEAM_BUCKET, BATCH_FIND_TEAM_KEY, FIND_PHOTO_WINDOW_MS, undefined, now, opts(BATCH_FIND_TEAM_LIMIT));
  return team.hits >= BATCH_FIND_TEAM_LIMIT ? "team" : "ok";
}

/** Test-only: clears both batch-search counts. */
export async function _resetBatchFindLimitsForTests(): Promise<void> {
  await _resetBucketForTests(BATCH_FIND_PERSON_BUCKET);
  await _resetBucketForTests(BATCH_FIND_TEAM_BUCKET);
}
