import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { _forgetSaltsForTests, consume, sweepRateLimits } from "./limits";
import app from "../app";

// Adversarial review probes for PR #150 (SYC-105 PR 2.1). Not for merge.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

afterAll(async () => {
  await pool.end();
});

describe("R1: atomic across concurrent requests", () => {
  it("50 parallel consumes, limit 10 -> exactly 10 allowed (warm salt)", async () => {
    await consume("r1warm", "seed", 10, HOUR); // warm the salt
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
    const rows = (await db.execute(sql`select count(*)::int as n from rate_limit_counters where bucket='r1cold'`)).rows[0] as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });
});

describe("R2: salt cached from a rolled-back transaction", () => {
  it("splits one key's count across two servers for the rest of the day", async () => {
    const t = Date.UTC(2032, 6, 7, 12, 0, 0);
    _forgetSaltsForTests();
    await db
      .transaction(async (tx) => {
        await consume("r2", "addr", 5, HOUR, tx, t);
        throw new Error("roll back, like a refused report");
      })
      .catch(() => undefined);
    const salts = (await db.execute(sql`select count(*)::int as n from rate_limit_salts where day = '2032-07-07'`))
      .rows[0] as { n: number };
    // The salt row was rolled back...
    expect(salts.n).toBe(0);
    // ...but this process still has it cached. Server 1 counts with it:
    await consume("r2", "addr", 5, HOUR, undefined, t);
    // Server 2 (fresh module graph) has to make a new salt for that day:
    vi.resetModules();
    const other = await import("./limits");
    const otherDb = await import("@workspace/db");
    await other.consume("r2", "addr", 5, HOUR, undefined, t);
    await otherDb.pool.end();
    const rows = (await db.execute(sql`select key, hits from rate_limit_counters where bucket='r2'`)).rows as {
      key: string;
      hits: number;
    }[];
    // One address, one window, but two rows: the limit is doubled.
    expect(rows.length).toBe(2);
  });
});

describe("R3: a window longer than COUNTER_KEEP_HOURS is swept while live", () => {
  it("a 24h window (Slice 5's '15 a day') is deleted by the hourly sweep after 03:00 UTC", async () => {
    const now = Date.now();
    const start = Math.floor(now / DAY) * DAY;
    const ageH = (now - start) / HOUR;
    for (let i = 0; i < 15; i++) await consume("r3", "addr", 15, DAY, undefined, now);
    expect((await consume("r3", "addr", 15, DAY, undefined, now)).allowed).toBe(false);
    await sweepRateLimits();
    const after = await consume("r3", "addr", 15, DAY, undefined, now);
    if (ageH > 3) {
      // The daily count is gone: the 17th of the day is allowed again.
      expect(after.allowed).toBe(true);
      expect(after.hits).toBe(1);
    } else {
      expect(after.allowed).toBe(false);
    }
  });
});

describe("R4: fixed clock-aligned windows let 2x limit through at a boundary", () => {
  it("10 at 10:59:59 and 10 at 11:00:00 are all allowed", async () => {
    const edge = Date.UTC(2033, 1, 1, 11, 0, 0);
    let allowed = 0;
    for (let i = 0; i < 10; i++) if ((await consume("r4", "a", 10, HOUR, undefined, edge - 1000)).allowed) allowed++;
    for (let i = 0; i < 10; i++) if ((await consume("r4", "a", 10, HOUR, undefined, edge)).allowed) allowed++;
    expect(allowed).toBe(20);
  });
});

describe("R5: fail closed on the AI limiter and name suggestions", () => {
  it("aiLimiter answers 503 (not 500, not a hang) when the counter table is gone", async () => {
    await db.execute(sql`alter table rate_limit_counters rename to rate_limit_counters_gone`);
    try {
      const r = await request(app)
        .post("/api/cats/name-suggestions")
        .set("X-Forwarded-For", "198.51.100.90")
        .send({});
      expect(r.status).toBe(503);
      expect(r.headers["retry-after"]).toBe("5");
      const s = await request(app).post("/api/sightings").set("X-Forwarded-For", "198.51.100.90").send({});
      expect(s.status).toBe(503);
      const d = await request(app).delete("/api/me").set("X-Forwarded-For", "198.51.100.90").send({});
      expect(d.status).toBe(503);
    } finally {
      await db.execute(sql`alter table rate_limit_counters_gone rename to rate_limit_counters`);
    }
  });
});
