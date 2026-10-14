import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { _forgetSaltsForTests, consume, sharedLimiter, sweepRateLimits } from "./limits";
import { CLAIM_LIMIT, CLAIM_WINDOW_MS, checkClaimLimit } from "../middlewares/rateLimit";
import app from "../app";

// Adversarial review probes for PR #150 (SYC-105 PR 2.1). Not for merge.
// Re-check (14 Oct 2026): R2/R3 now assert the FIXED behaviour; S1-S7 probe
// the sliding-window mode.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterAll(async () => {
  await pool.end();
});

async function rows(bucket: string): Promise<{ key: string; hits: number; ws: string }[]> {
  return (await db.execute(sql`select key, hits, window_start::text as ws from rate_limit_counters where bucket = ${bucket} order by window_start`))
    .rows as { key: string; hits: number; ws: string }[];
}

describe("R1: atomic across concurrent requests", () => {
  it("50 parallel consumes, limit 10 -> exactly 10 allowed (warm salt)", async () => {
    await consume("r1warm", "seed", 10, HOUR);
    const rs = await Promise.all(Array.from({ length: 50 }, () => consume("r1", "k", 10, HOUR)));
    expect(rs.filter((r) => r.allowed)).toHaveLength(10);
    expect(new Set(rs.map((r) => r.hits)).size).toBe(50);
  });

  it("50 parallel consumes from two module graphs on a cold day -> one row, exactly 10 allowed", async () => {
    const t = Date.UTC(2031, 4, 4, 12, 0, 0);
    _forgetSaltsForTests();
    vi.resetModules();
    const other = await import("./limits");
    const otherDb = await import("@workspace/db");
    const rs = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        i % 2 ? consume("r1cold", "k", 10, HOUR, undefined, t) : other.consume("r1cold", "k", 10, HOUR, undefined, t),
      ),
    );
    await otherDb.pool.end();
    expect(rs.filter((r) => r.allowed)).toHaveLength(10);
    expect(await rows("r1cold")).toHaveLength(1);
  });
});

describe("R2 (fixed?): salt made inside a rolled-back transaction", () => {
  it("the salt survives the rollback and a second server lands on the same row", async () => {
    const t = Date.UTC(2032, 6, 7, 12, 0, 0);
    _forgetSaltsForTests();
    await db
      .transaction(async (tx) => {
        await consume("r2", "addr", 5, HOUR, tx, t);
        throw new Error("roll back");
      })
      .catch(() => undefined);
    const salts = (await db.execute(sql`select count(*)::int as n from rate_limit_salts where day = '2032-07-07'`))
      .rows[0] as { n: number };
    expect(salts.n).toBe(1);
    await consume("r2", "addr", 5, HOUR, undefined, t);
    vi.resetModules();
    const other = await import("./limits");
    const otherDb = await import("@workspace/db");
    await other.consume("r2", "addr", 5, HOUR, undefined, t);
    await otherDb.pool.end();
    const r = await rows("r2");
    expect(r).toHaveLength(1);
    expect(Number(r[0]!.hits)).toBe(2); // the rolled-back count is gone, the two later ones share a row
  });
});

describe("R3 (fixed?): a 24h window survives the sweep while live", () => {
  it("a fixed day window is kept at 23:59 the same day and gone two days later", async () => {
    const d = Date.UTC(2033, 2, 3, 0, 0, 0);
    for (let i = 0; i < 15; i++) await consume("r3", "addr", 15, DAY, undefined, d + HOUR);
    await sweepRateLimits(d + DAY - 60_000);
    expect((await consume("r3", "addr", 15, DAY, undefined, d + DAY - 30_000)).allowed).toBe(false);
    await sweepRateLimits(d + 3 * DAY);
    expect(await rows("r3")).toHaveLength(0);
  });
});

describe("R4: fixed windows still allow 2x at a boundary (unchanged, acceptable)", () => {
  it("10 at 10:59:59 and 10 at 11:00:00 are all allowed", async () => {
    const edge = Date.UTC(2033, 1, 1, 11, 0, 0);
    let allowed = 0;
    for (let i = 0; i < 10; i++) if ((await consume("r4", "a", 10, HOUR, undefined, edge - 1000)).allowed) allowed++;
    for (let i = 0; i < 10; i++) if ((await consume("r4", "a", 10, HOUR, undefined, edge)).allowed) allowed++;
    expect(allowed).toBe(20);
  });
});

describe("R5: fail closed off the welfare routes", () => {
  it("name-suggestions, /sightings and DELETE /me answer 503 when the counter table is gone", async () => {
    await db.execute(sql`alter table rate_limit_counters rename to rate_limit_counters_gone`);
    try {
      const r = await request(app).post("/api/cats/name-suggestions").set("X-Forwarded-For", "198.51.100.90").send({});
      expect(r.status).toBe(503);
      expect(r.headers["retry-after"]).toBe("5");
      expect((await request(app).post("/api/sightings").set("X-Forwarded-For", "198.51.100.90").send({})).status).toBe(503);
      expect((await request(app).delete("/api/me").set("X-Forwarded-For", "198.51.100.90").send({})).status).toBe(503);
    } finally {
      await db.execute(sql`alter table rate_limit_counters_gone rename to rate_limit_counters`);
    }
  });
});

// ── Sliding mode ──────────────────────────────────────────────────────────

describe("S1: 50 parallel claims on the sliding claim bucket", () => {
  it("exactly CLAIM_LIMIT allowed, one module graph", async () => {
    const t = Date.UTC(2034, 0, 5, 9, 0, 0);
    const rs = await Promise.all(Array.from({ length: 50 }, () => checkClaimLimit("s1-device", t)));
    expect(rs.filter(Boolean)).toHaveLength(CLAIM_LIMIT);
  });

  it("exactly CLAIM_LIMIT allowed across two module graphs, with yesterday's count in play", async () => {
    const d = Date.UTC(2034, 0, 7, 0, 0, 0);
    // 2 claims yesterday at noon.
    await checkClaimLimit("s1b", d - 12 * HOUR);
    await checkClaimLimit("s1b", d - 12 * HOUR);
    // At 06:00 today the previous day weighs 0.75: 2 * 0.75 = 1.5, so 3 more are allowed (1.5 + 3 = 4.5 <= 5; 1.5 + 4 = 5.5 > 5).
    _forgetSaltsForTests();
    vi.resetModules();
    const other = await import("../middlewares/rateLimit");
    const otherDb = await import("@workspace/db");
    const t = d + 6 * HOUR;
    const rs = await Promise.all(
      Array.from({ length: 50 }, (_, i) => (i % 2 ? checkClaimLimit("s1b", t) : other.checkClaimLimit("s1b", t))),
    );
    await otherDb.pool.end();
    expect(rs.filter(Boolean)).toHaveLength(3);
  });
});

describe("S2: <= limit counts correctly", () => {
  it("exactly 5 allowed, the 6th refused, on a fresh key", async () => {
    const t = Date.UTC(2034, 1, 2, 10, 0, 0);
    const got: boolean[] = [];
    for (let i = 0; i < 6; i++) got.push(await checkClaimLimit("s2", t));
    expect(got).toEqual([true, true, true, true, true, false]);
  });
});

describe("S3: across midnight the previous window is found with its own day's salt", () => {
  it("5 claims at 23:00, then at 00:30 (fresh process, salts from the DB) the next is refused", async () => {
    const d = Date.UTC(2034, 2, 10, 0, 0, 0);
    for (let i = 0; i < 5; i++) expect(await checkClaimLimit("s3", d - HOUR)).toBe(true);
    _forgetSaltsForTests();
    vi.resetModules();
    const other = await import("../middlewares/rateLimit");
    const otherDb = await import("@workspace/db");
    const allowed = await other.checkClaimLimit("s3", d + 30 * 60_000);
    await otherDb.pool.end();
    // 5 * (1 - 0.5/24) + 1 = 5.9 > 5
    expect(allowed).toBe(false);
  });
});

describe("S4: the sweep keeps the previous day while it is still read", () => {
  it("yesterday's row survives a sweep at 23:59 today, and is gone the day after", async () => {
    const d = Date.UTC(2034, 3, 10, 0, 0, 0);
    for (let i = 0; i < 5; i++) await checkClaimLimit("s4", d - HOUR); // yesterday 23:00
    await sweepRateLimits(d + DAY - 60_000); // today 23:59
    const kept = (await db.execute(sql`select count(*)::int as n from rate_limit_counters where bucket='claim' and window_start = to_timestamp(${(d - DAY) / 1000})`))
      .rows[0] as { n: number };
    expect(kept.n).toBe(1);
    // Still weighs 5 * (1/1440) ~ 0.003 + 1: allowed, but the row was there to be read.
    await sweepRateLimits(d + DAY + 60_000); // tomorrow 00:01: yesterday's row (2 days old) is no longer needed
    const left = (await db.execute(sql`select count(*)::int as n from rate_limit_counters where bucket='claim' and window_start = to_timestamp(${(d - DAY) / 1000})`))
      .rows[0] as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("S5: refused requests are counted, and carry into the next day", () => {
  it("50 attempts on day 1 (45 refused) keep the phone refused until ~21:36 on day 2", async () => {
    const d = Date.UTC(2034, 4, 10, 0, 0, 0);
    for (let i = 0; i < 50; i++) await checkClaimLimit("s5", d + 10 * HOUR);
    // Day 2, 12:00: 50 * 0.5 + 1 = 26 > 5
    expect(await checkClaimLimit("s5", d + DAY + 12 * HOUR)).toBe(false);
    // Day 2, 21:00: 50 * 0.125 + 2 = 8.25 > 5
    expect(await checkClaimLimit("s5", d + DAY + 21 * HOUR)).toBe(false);
    // The old SYC-130 Map counted nothing once refused, so the phone was free again 24 h after its first claim.
  });
});

describe("S6: 'the 6th call within any 24 hours returns false' is not what sliding does", () => {
  it("5 claims at 23:00, then 2 more allowed at 12:00 the next day: 7 in 13 hours", async () => {
    const d = Date.UTC(2034, 5, 10, 0, 0, 0);
    for (let i = 0; i < 5; i++) expect(await checkClaimLimit("s6", d - HOUR)).toBe(true);
    const t = d + 12 * HOUR;
    const got: boolean[] = [];
    for (let i = 0; i < 3; i++) got.push(await checkClaimLimit("s6", t));
    expect(got).toEqual([true, true, false]);
  });
});

describe("S7: fixed vs sliding registration", () => {
  it("the claim bucket used in fixed mode throws", async () => {
    await expect(consume("claim", "s7", CLAIM_LIMIT, CLAIM_WINDOW_MS, undefined, Date.now(), { sliding: false })).rejects.toThrow(
      /registered twice/,
    );
  });
  it("a second sharedLimiter with the SAME bucket and settings is NOT refused (silently shares the budget)", () => {
    expect(() => sharedLimiter({ bucket: "report", windowMs: HOUR, limit: 10, message: {}, failOpen: true })).not.toThrow();
  });
  it("a window that doesn't divide a day throws", async () => {
    await expect(consume("s7w", "k", 5, 7 * HOUR)).rejects.toThrow(/divides a day/);
  });
});
