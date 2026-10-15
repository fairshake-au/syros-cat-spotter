import { createHash, randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import rateLimit, {
  ipKeyGenerator,
  type IncrementResponse,
  type Options,
  type Store,
} from "express-rate-limit";
import type { RequestHandler } from "express";
import { logger, safeError } from "./logger";

/**
 * SYC-105 PR 2.1: rate limits counted in Postgres.
 *
 * Until now every limit lived in one server's memory, so a restart reset it
 * and a second copy of the server doubled it. Here one row per
 * (bucket, key, window) counts the requests, and the count is a single atomic
 * `insert … on conflict do update … returning hits`, so any number of servers
 * share it.
 *
 * Privacy: an address is never stored in the clear. A caller passes the key
 * already grouped the way the limits group addresses (see `addressKey`);
 * `consume` hashes it with that day's salt (a random value the server makes
 * itself, one row per day in `rate_limit_salts`, so there is no secret to
 * configure) before it touches the table. The salt lives in the same database
 * as the hashed keys, for up to about 48 hours, so someone who can read the
 * database could still test a guessed address against a key while both rows
 * exist. Counter rows for hourly and shorter windows go within about an
 * hour of their window ending; day-long rows are kept about two days in all
 * (a sliding limit still reads the previous window).
 * A window never straddles two salts: the salt is the one for the day the
 * window STARTS, and `assertWindow` only allows window lengths that divide a
 * day.
 *
 * Two modes. Both use windows aligned to the clock (a window of an hour
 * starts on the hour), so every server picks the same window without talking
 * to the others.
 *
 * - Fixed (the default; the 15-minute and hourly limits): the count starts
 *   again at each window boundary, so a caller can spend the whole limit just
 *   before a boundary and again just after it.
 * - Sliding (`sliding: true`; the day-long, sensitive limits): the previous
 *   window's count is weighted by how much of it still lies inside the last
 *   window length, so a boundary hands out no fresh allowance. It is an
 *   estimate (the previous window is treated as if its requests were evenly
 *   spread), so the limit is "about N per rolling window", not exactly N in
 *   any window-length stretch.
 */

/** Anything with `execute`: the pool-backed `db`, or a transaction. */
export type LimitsExecutor = Pick<typeof db, "execute">;

export type ConsumeResult = {
  /** Requests counted in this window, including this one. */
  hits: number;
  /** `hits <= limit`. */
  allowed: boolean;
  /** When this window ends and the count starts again (ms since epoch). */
  resetAt: number;
};

/**
 * Group an address the way express-rate-limit does for every other limit: an
 * IPv6 address counts by its /56 network (anyone with IPv6 can pick a fresh
 * address from their block on every request, review of PR #93), and an
 * IPv4-mapped address counts as the IPv4 one (review finding 4). Must run
 * BEFORE the hash; hashing the raw address would give every address of a /56
 * its own count.
 */
export function addressKey(address: string | undefined): string {
  return !address || address === "unknown" ? "unknown" : ipKeyGenerator(address);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Windows must divide a day, so one never straddles two salts (and none outlives the sweep). */
function assertWindow(windowMs: number): void {
  if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > DAY_MS || DAY_MS % windowMs !== 0) {
    throw new Error(`rate limit window must be a whole number of milliseconds that divides a day: ${windowMs}`);
  }
}

const buckets = new Map<string, { limit: number; windowMs: number; sliding: boolean }>();

/**
 * Remember a bucket's settings; refuse the same bucket name registered with
 * different ones, because two limiters would silently share one budget.
 */
function registerBucket(bucket: string, limit: number, windowMs: number, sliding = false): void {
  assertWindow(windowMs);
  const seen = buckets.get(bucket);
  if (!seen) {
    buckets.set(bucket, { limit, windowMs, sliding });
  } else if (seen.limit !== limit || seen.windowMs !== windowMs || seen.sliding !== sliding) {
    throw new Error(`rate limit bucket "${bucket}" registered twice with different settings`);
  }
}

const owners = new Set<string>();

/**
 * Claim a bucket name for one limiter, once, at module load: the three
 * function-call limiters (device match, new device, claim) call this at the
 * top of their module, and `sharedLimiter` calls it when it is made. A second
 * claim on the same name throws, even with the same settings, because two
 * limiters would silently share one budget; and a settings clash with a later
 * `consume` call throws at boot-time registration rather than as a 503 (or,
 * on a welfare route, no limit at all) on the first request.
 */
export function declareLimit(
  bucket: string,
  limit: number,
  windowMs: number,
  opts: WindowOptions = {},
): void {
  if (owners.has(bucket)) throw new Error(`rate limit bucket "${bucket}" already has an owner`);
  registerBucket(bucket, limit, windowMs, opts.sliding ?? false);
  owners.add(bucket);
}

const saltCache = new Map<string, string>();

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Always read or create the day's salt on the pool, never on a caller's
// transaction: if that transaction rolled back, the salt row would vanish
// while this process kept it cached, and another server would make a second
// salt for the same day, splitting one address into two counters. On the pool
// the insert commits on its own before the salt is cached.
async function saltFor(day: string): Promise<string> {
  const cached = saltCache.get(day);
  if (cached) return cached;
  await db.execute(sql`
    insert into rate_limit_salts (day, salt)
    values (${day}::date, ${randomBytes(32).toString("base64url")})
    on conflict (day) do nothing
  `);
  const res = await db.execute(sql`select salt from rate_limit_salts where day = ${day}::date`);
  const salt = (res.rows[0] as { salt: string } | undefined)?.salt;
  if (!salt) throw new Error("rate limit salt missing");
  saltCache.set(day, salt);
  return salt;
}

async function hashKey(key: string, windowStart: number): Promise<string> {
  const salt = await saltFor(dayOf(windowStart));
  return createHash("sha256").update(`${salt}|${key}`).digest("hex");
}

function windowStartOf(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

export type WindowOptions = {
  /** `peek` only, sliding: the limit, so `resetAt` can say when a refused caller is next allowed. */
  limit?: number;
  /**
   * Sliding-window counter instead of a fixed window. A fixed window lets a
   * caller spend the whole limit just before the boundary and again just
   * after it (5 claims at 23:59 and 5 more at 00:01). Sliding weights the
   * previous window's count by how much of it still lies inside the last
   * `windowMs`: allowed while
   * `previousHits * (1 - elapsed / windowMs) + currentHits <= limit`, where
   * currentHits includes this request. Use it for the day-long, sensitive
   * limits (the claim limit, the address hide limit); the 15-minute and
   * hourly limits stay on fixed windows.
   */
  sliding?: boolean;
};

/**
 * Count one request against (bucket, key) and say whether it is within
 * `limit`. One atomic statement (in sliding mode the previous window is read
 * in the same statement), safe across any number of servers. Throws if the
 * database does; the callers below decide whether that fails open or closed.
 * `now` is for tests.
 */
export async function consume(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  tx?: LimitsExecutor,
  now: number = Date.now(),
  opts: WindowOptions = {},
): Promise<ConsumeResult> {
  const sliding = opts.sliding ?? false;
  registerBucket(bucket, limit, windowMs, sliding);
  const exec = tx ?? db;
  const start = windowStartOf(now, windowMs);
  const hashed = await hashKey(key, start);
  if (!sliding) {
    const res = await exec.execute(sql`
      insert into rate_limit_counters (bucket, key, window_start, window_ms, hits)
      values (${bucket}, ${hashed}, to_timestamp(${start} / 1000.0), ${windowMs}, 1)
      on conflict (bucket, key, window_start)
      do update set hits = rate_limit_counters.hits + 1
      returning hits
    `);
    const hits = Number((res.rows[0] as { hits: number | string }).hits);
    return { hits, allowed: hits <= limit, resetAt: start + windowMs };
  }
  // The stored count stops at limit + 1 (above): a refused retry storm can
  // carry over into the next window as "one over", never as 50 over, so the
  // phone is free about a window after its first attempts, as a plain
  // rolling limit would leave it.
  // The previous window's key is hashed with ITS day's salt.
  const prevStart = start - windowMs;
  const prevHashed = await hashKey(key, prevStart);
  const res = await exec.execute(sql`
    with cur as (
      insert into rate_limit_counters (bucket, key, window_start, window_ms, hits)
      values (${bucket}, ${hashed}, to_timestamp(${start} / 1000.0), ${windowMs}, 1)
      on conflict (bucket, key, window_start)
      do update set hits = least(rate_limit_counters.hits + 1, ${limit + 1})
      returning hits
    )
    select cur.hits as hits,
           coalesce((select hits from rate_limit_counters
                      where bucket = ${bucket} and key = ${prevHashed}
                        and window_start = to_timestamp(${prevStart} / 1000.0)), 0) as prev_hits
      from cur
  `);
  const row = res.rows[0] as { hits: number | string; prev_hits: number | string };
  const estimate = slidingEstimate(Number(row.prev_hits), Number(row.hits), now - start, windowMs);
  const allowed = estimate <= limit;
  return {
    hits: Math.ceil(estimate),
    allowed,
    resetAt: allowed
      ? start + windowMs
      : slidingResetAt(Number(row.prev_hits), Number(row.hits), limit, start, now, windowMs),
  };
}

/**
 * The earliest time a refused caller's next attempt can be allowed: when
 * `prev * (1 - t / W) + (cur + 1) <= limit` (the retry itself counts, so it
 * is `cur + 1`), capped at the window end, after which a lower bound is all
 * that can be said (the next window weighs this one again). Used for
 * Retry-After.
 */
function slidingResetAt(
  prevHits: number,
  curHits: number,
  limit: number,
  start: number,
  now: number,
  windowMs: number,
): number {
  const end = start + windowMs;
  const room = limit - (curHits + 1);
  if (room < 0 || prevHits <= 0) return end;
  const t = start + windowMs * (1 - room / prevHits);
  return Math.min(end, Math.max(now, t));
}

function slidingEstimate(prevHits: number, curHits: number, elapsedMs: number, windowMs: number): number {
  return prevHits * (1 - elapsedMs / windowMs) + curHits;
}

/** How many requests (bucket, key) has in its current window, counting nothing. */
export async function peek(
  bucket: string,
  key: string,
  windowMs: number,
  tx?: LimitsExecutor,
  now: number = Date.now(),
  opts: WindowOptions = {},
): Promise<{ hits: number; resetAt: number }> {
  assertWindow(windowMs);
  const exec = tx ?? db;
  const start = windowStartOf(now, windowMs);
  const hashed = await hashKey(key, start);
  const res = await exec.execute(sql`
    select hits from rate_limit_counters
     where bucket = ${bucket} and key = ${hashed}
       and window_start = to_timestamp(${start} / 1000.0)
  `);
  const cur = res.rows[0] ? Number((res.rows[0] as { hits: number | string }).hits) : 0;
  if (!opts.sliding) return { hits: cur, resetAt: start + windowMs };
  const prevStart = start - windowMs;
  const prevHashed = await hashKey(key, prevStart);
  const prevRes = await exec.execute(sql`
    select hits from rate_limit_counters
     where bucket = ${bucket} and key = ${prevHashed}
       and window_start = to_timestamp(${prevStart} / 1000.0)
  `);
  const prev = prevRes.rows[0] ? Number((prevRes.rows[0] as { hits: number | string }).hits) : 0;
  const estimate = slidingEstimate(prev, cur, now - start, windowMs);
  const resetAt =
    opts.limit !== undefined && estimate > opts.limit
      ? slidingResetAt(prev, cur, opts.limit, start, now, windowMs)
      : start + windowMs;
  return { hits: Math.ceil(estimate), resetAt };
}

/** Forget one key's count in its current window. */
export async function reset(
  bucket: string,
  key: string,
  windowMs: number,
  tx?: LimitsExecutor,
  now: number = Date.now(),
): Promise<void> {
  assertWindow(windowMs);
  const exec = tx ?? db;
  const start = windowStartOf(now, windowMs);
  const hashed = await hashKey(key, start);
  await exec.execute(sql`
    delete from rate_limit_counters
     where bucket = ${bucket} and key = ${hashed}
       and window_start = to_timestamp(${start} / 1000.0)
  `);
}

/** Test-only: forget the counts of one bucket, or of every bucket. */
export async function _resetBucketForTests(bucket?: string): Promise<void> {
  if (bucket === undefined) {
    await db.execute(sql`delete from rate_limit_counters`);
  } else {
    await db.execute(sql`delete from rate_limit_counters where bucket = ${bucket}`);
  }
}

/** Test-only: forget the salts this process has cached. */
export function _forgetSaltsForTests(): void {
  saltCache.clear();
}

/**
 * An `express-rate-limit` Store on `consume`. When the counter throws:
 *
 * - `failOpen` (the cat-in-trouble routes): log it and let the request
 *   through uncounted, because a hurt-cat report must never be lost to a
 *   limiter (review finding 16);
 * - otherwise: rethrow, and `sharedLimiter` answers 503, since a limit that
 *   cannot count must not become no limit on a paid or abusable route.
 */
export class PostgresStore implements Store {
  localKeys = false;
  private windowMs = 60_000;

  constructor(
    private readonly bucket: string,
    private readonly limit: number,
    private readonly failOpen: boolean,
    private readonly sliding: boolean = false,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const r = await consume(this.bucket, key, this.limit, this.windowMs, undefined, Date.now(), {
        sliding: this.sliding,
      });
      return { totalHits: r.hits, resetTime: new Date(r.resetAt) };
    } catch (err) {
      logger.error(
        { err: safeError(err), bucket: this.bucket, failOpen: this.failOpen },
        "rate limit counter failed",
      );
      if (this.failOpen) {
        return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
      }
      throw err;
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const start = windowStartOf(Date.now(), this.windowMs);
      const hashed = await hashKey(key, start);
      await db.execute(sql`
        update rate_limit_counters set hits = greatest(hits - 1, 0)
         where bucket = ${this.bucket} and key = ${hashed}
           and window_start = to_timestamp(${start} / 1000.0)
      `);
    } catch (err) {
      logger.error({ err: safeError(err), bucket: this.bucket }, "rate limit decrement failed");
    }
  }

  async resetKey(key: string): Promise<void> {
    await reset(this.bucket, key, this.windowMs);
  }
}

type SharedLimiterOptions = {
  bucket: string;
  windowMs: number;
  limit: number;
  /** The 429 body. */
  message: object;
  /** See `PostgresStore`. True only for the cat-in-trouble routes. */
  failOpen?: boolean;
  /** Sliding window instead of a fixed one; see `WindowOptions`. */
  sliding?: boolean;
};

/**
 * An `express-rate-limit` middleware whose counts live in Postgres, keyed on
 * the visitor's address grouped the usual way (the library's default key
 * generator, `ipKeyGenerator(req.ip)`) and hashed by `consume`.
 */
export function sharedLimiter(opts: SharedLimiterOptions): RequestHandler {
  declareLimit(opts.bucket, opts.limit, opts.windowMs, { sliding: opts.sliding });
  const failOpen = opts.failOpen ?? false;
  const limiter = rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: opts.message,
    store: new PostgresStore(opts.bucket, opts.limit, failOpen, opts.sliding ?? false),
  });
  return (req, res, next) => {
    void limiter(req, res, (err?: unknown) => {
      if (err) {
        // Only reachable when the counter threw and this limiter fails closed.
        if (!res.headersSent) {
          res.setHeader("Retry-After", "5");
          res.status(503).json({ error: "Please try again in a moment." });
        }
        return;
      }
      next();
    });
  };
}

// ── The sweep ──────────────────────────────────────────────────────────────

/**
 * How long a row is kept after its window has ended: an hour, or a whole
 * window if that is longer. A sliding limit still reads the previous window
 * while the current one runs, so a row must outlive its window by one more
 * window. (A day-long row therefore lives about two days; a 15-minute or
 * hourly one about an hour or two.)
 */
export const COUNTER_KEEP_AFTER_END_MIN_MS = 60 * 60 * 1000;

export type LimitsSweepResult = { countersDeleted: number; saltsDeleted: number };

/**
 * Remove windows that have ended (a day-long window lives its whole day),
 * and salts nothing uses any more.
 */
export async function sweepRateLimits(now: number = Date.now()): Promise<LimitsSweepResult> {
  const counters = await db.execute(sql`
    delete from rate_limit_counters
     where window_start + (window_ms + greatest(window_ms, ${COUNTER_KEEP_AFTER_END_MIN_MS})) * interval '1 millisecond'
           < to_timestamp(${now} / 1000.0)
  `);
  // A salt is only read while a window that started that day is live, so
  // yesterday's is already unused once today's first windows are over.
  const salts = await db.execute(sql`
    delete from rate_limit_salts where day < (to_timestamp(${now} / 1000.0) at time zone 'utc')::date - 1
  `);
  return { countersDeleted: counters.rowCount ?? 0, saltsDeleted: salts.rowCount ?? 0 };
}

const SWEEP_EVERY_MS = 60 * 60 * 1000;
let lastSweep = 0;

/** At most once an hour per server; never throws (same pattern as the keep-safe sweep). */
export async function sweepRateLimitsIfDue(
  log: { error: (o: object, m: string) => void },
): Promise<LimitsSweepResult | null> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return null;
  lastSweep = now;
  try {
    return await sweepRateLimits();
  } catch (err) {
    log.error({ err: safeError(err) }, "rate limit sweep failed");
    return null;
  }
}

/** Test-only: let the next `sweepRateLimitsIfDue` run. */
export function _resetLimitsSweepForTests(): void {
  lastSweep = 0;
}
