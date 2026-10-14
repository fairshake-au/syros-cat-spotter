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
 * exist. Counter rows go within about an hour of their window ending.
 * A window never straddles two salts: the salt is the one for the day the
 * window STARTS, and `assertWindow` only allows window lengths that divide a
 * day.
 *
 * Fixed windows, aligned to the clock (a window of an hour starts on the
 * hour), so every server picks the same window without talking to the others.
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

const buckets = new Map<string, { limit: number; windowMs: number }>();

/**
 * Remember a bucket's settings; refuse the same bucket name registered with
 * different ones, because two limiters would silently share one budget.
 */
function registerBucket(bucket: string, limit: number, windowMs: number): void {
  assertWindow(windowMs);
  const seen = buckets.get(bucket);
  if (!seen) {
    buckets.set(bucket, { limit, windowMs });
  } else if (seen.limit !== limit || seen.windowMs !== windowMs) {
    throw new Error(`rate limit bucket "${bucket}" registered twice with different settings`);
  }
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

/**
 * Count one request against (bucket, key) and say whether it is within
 * `limit`. One atomic statement, safe across any number of servers. Throws if
 * the database does; the callers below decide whether that fails open or
 * closed. `now` is for tests.
 */
export async function consume(
  bucket: string,
  key: string,
  limit: number,
  windowMs: number,
  tx?: LimitsExecutor,
  now: number = Date.now(),
): Promise<ConsumeResult> {
  registerBucket(bucket, limit, windowMs);
  const exec = tx ?? db;
  const start = windowStartOf(now, windowMs);
  const hashed = await hashKey(key, start);
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

/** How many requests (bucket, key) has in its current window, counting nothing. */
export async function peek(
  bucket: string,
  key: string,
  windowMs: number,
  tx?: LimitsExecutor,
  now: number = Date.now(),
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
  const hits = res.rows[0] ? Number((res.rows[0] as { hits: number | string }).hits) : 0;
  return { hits, resetAt: start + windowMs };
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
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const r = await consume(this.bucket, key, this.limit, this.windowMs);
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
};

/**
 * An `express-rate-limit` middleware whose counts live in Postgres, keyed on
 * the visitor's address grouped the usual way (the library's default key
 * generator, `ipKeyGenerator(req.ip)`) and hashed by `consume`.
 */
export function sharedLimiter(opts: SharedLimiterOptions): RequestHandler {
  registerBucket(opts.bucket, opts.limit, opts.windowMs);
  const failOpen = opts.failOpen ?? false;
  const limiter = rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: opts.message,
    store: new PostgresStore(opts.bucket, opts.limit, failOpen),
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

/** How long a row is kept after its window has ended. */
export const COUNTER_KEEP_AFTER_END_HOURS = 1;

export type LimitsSweepResult = { countersDeleted: number; saltsDeleted: number };

/**
 * Remove windows that have ended (a day-long window lives its whole day),
 * and salts nothing uses any more.
 */
export async function sweepRateLimits(now: number = Date.now()): Promise<LimitsSweepResult> {
  const counters = await db.execute(sql`
    delete from rate_limit_counters
     where window_start + window_ms * interval '1 millisecond'
           < to_timestamp(${now} / 1000.0) - make_interval(hours => ${COUNTER_KEEP_AFTER_END_HOURS})
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
