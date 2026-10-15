import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import type { Express } from "express";
import { db, pool, deviceCredentialsTable, welfareReportsTable } from "@workspace/db";
import { like, sql } from "drizzle-orm";
import {
  _forgetSaltsForTests,
  _resetLimitsSweepForTests,
  addressKey,
  consume,
  peek,
  sharedLimiter,
  sweepRateLimits,
  sweepRateLimitsIfDue,
} from "./limits";
import { CLAIM_LIMIT, checkClaimLimit } from "../middlewares/rateLimit";

// SYC-105 PR 2.1 tests T2-1 to T2-6 (docs/superpowers/plans/syc-44-report-an-issue.md,
// Slice 2): limits counted in Postgres, not in a server's memory.

const DEVICE = `vitest-limits-${randomBytes(4).toString("hex")}`;
const SECRET = "vitest-limits-secret-0123456789";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Two instances of the app, as two servers would be: each is its own copy of
// every module (so its own memory), and the two share only the database.
type Instance = { app: Express; pool: { end(): Promise<void> } };
async function newInstance(): Promise<Instance> {
  vi.resetModules();
  const app = (await import("../app")).default;
  const dbModule = await import("@workspace/db");
  return { app, pool: dbModule.pool };
}

let a: Instance;
let b: Instance;

async function cleanup() {
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${DEVICE + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${DEVICE}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
}

beforeAll(async () => {
  await cleanup();
  a = await newInstance();
  b = await newInstance();
});
afterAll(async () => {
  await cleanup();
  await a.pool.end();
  await b.pool.end();
  await pool.end();
});

function report(inst: Instance, ip: string) {
  return request(inst.app)
    .post("/api/reports")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", ip)
    .send({
      deviceId: DEVICE,
      clientRef: `ref-${randomBytes(8).toString("hex")}`,
      severity: "urgent",
      isLitter: false,
      lat: 37.4441234,
      lng: 24.9412345,
      note: "Limping near the bakery",
      language: "en",
      hasPhoto: true,
    });
}

describe("T2-1: two app instances share one limit", () => {
  it("the 11th report from one address across both is 429", async () => {
    expect(a.app).not.toBe(b.app);
    const ip = "198.51.100.21";
    for (let i = 0; i < 5; i++) expect((await report(a, ip)).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await report(b, ip)).status).toBe(201);
    expect((await report(a, ip)).status).toBe(429);
    expect((await report(b, ip)).status).toBe(429);
  });
});

describe("T2-2: a restart does not reset a window", () => {
  it("a brand-new instance still counts the old instance's reports", async () => {
    const ip = "198.51.100.22";
    for (let i = 0; i < 10; i++) expect((await report(a, ip)).status).toBe(201);
    const restarted = await newInstance();
    try {
      expect((await report(restarted, ip)).status).toBe(429);
    } finally {
      await restarted.pool.end();
    }
  });
});

describe("T2-3: the stored key is not the address", () => {
  it("is a salted hash, and differs from one day to the next", async () => {
    const ip = "198.51.100.23";
    await report(a, ip);
    const rows = (await db.execute(sql`select bucket, key from rate_limit_counters where bucket = 'report'`))
      .rows as { bucket: string; key: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key).toMatch(/^[0-9a-f]{64}$/);
      expect(row.key).not.toContain("198");
      // Not even an unsalted hash of the address.
      expect(row.key).not.toBe(createHash("sha256").update(ip).digest("hex"));
      expect(row.key).not.toBe(createHash("sha256").update(addressKey(ip)).digest("hex"));
    }

    const day1 = Date.UTC(2026, 0, 10, 12, 0, 0);
    const day2 = Date.UTC(2026, 0, 11, 12, 0, 0);
    await consume("t23", addressKey(ip), 5, HOUR, undefined, day1);
    await consume("t23", addressKey(ip), 5, HOUR, undefined, day2);
    const keys = (await db.execute(sql`select key from rate_limit_counters where bucket = 't23' order by window_start`))
      .rows as { key: string }[];
    expect(keys).toHaveLength(2);
    expect(keys[0]!.key).not.toBe(keys[1]!.key);
    // The same address on the same day lands on the same row.
    expect((await consume("t23", addressKey(ip), 5, HOUR, undefined, day1 + 1000)).hits).toBe(2);
    // The salt table holds one row per day and no address.
    const salts = (await db.execute(sql`select day::text as day, salt from rate_limit_salts`)).rows as {
      day: string;
      salt: string;
    }[];
    expect(new Set(salts.map((s) => s.day)).size).toBe(salts.length);
    for (const s of salts) expect(s.salt).not.toContain("198.51");
  });
});

describe("T2-4: old windows are swept", () => {
  it("deletes windows past their time and salts nothing uses, keeps live ones, runs at most hourly", async () => {
    const now = Date.now();
    await consume("t24", "old", 5, HOUR, undefined, now - 5 * HOUR);
    await consume("t24", "live", 5, HOUR, undefined, now);
    await consume("t24", "ancient", 5, HOUR, undefined, now - 10 * 24 * HOUR);
    const result = await sweepRateLimits();
    expect(result.countersDeleted).toBeGreaterThanOrEqual(2);
    expect(result.saltsDeleted).toBeGreaterThanOrEqual(1);
    const left = (await db.execute(sql`select count(*)::int as n from rate_limit_counters where bucket = 't24'`))
      .rows[0] as { n: number };
    expect(left.n).toBe(1);
    expect((await peek("t24", "live", HOUR, undefined, now)).hits).toBe(1);
    const oldSalts = (
      await db.execute(sql`select count(*)::int as n from rate_limit_salts where day < (now() at time zone 'utc')::date - 1`)
    ).rows[0] as { n: number };
    expect(oldSalts.n).toBe(0);

    _resetLimitsSweepForTests();
    const log = { error: vi.fn() };
    expect(await sweepRateLimitsIfDue(log)).not.toBeNull();
    expect(await sweepRateLimitsIfDue(log)).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("T2-5: IPv6 addresses in one /56 share a count", () => {
  it("counts them together, groups IPv4-mapped as IPv4, and leaves other networks alone", async () => {
    // 2001:db8:aa:00XX::/56: the last byte of the fourth group is free.
    for (let i = 1; i <= 10; i++) {
      expect((await report(a, `2001:db8:aa:${i.toString(16).padStart(2, "0")}::1`)).status).toBe(201);
    }
    expect((await report(a, "2001:db8:aa:ff::99")).status).toBe(429);
    // A different /56 has its own count.
    expect((await report(a, "2001:db8:ab:01::1")).status).toBe(201);
    expect(addressKey("::ffff:198.51.100.77")).toBe(addressKey("198.51.100.77"));
  });
});

describe("T2-6: a broken counter never costs a cat-in-trouble report", () => {
  it("the report is still accepted (fail open), a new phone too, while other limiters answer 503 (fail closed)", async () => {
    // Break the counter for real: the table is not there.
    await db.execute(sql`alter table rate_limit_counters rename to rate_limit_counters_gone`);
    try {
      const fresh = `${DEVICE}-fresh`;
      const ok = await request(a.app)
        .post("/api/reports")
        .set("X-Device-Secret", SECRET)
        .set("X-Forwarded-For", "198.51.100.26")
        .send({
          deviceId: fresh,
          clientRef: `ref-${randomBytes(8).toString("hex")}`,
          severity: "urgent",
          isLitter: false,
          lat: 37.4441234,
          lng: 24.9412345,
          note: "Hurt cat",
          language: "en",
          hasPhoto: true,
        });
      // Accepted, from a device never seen before, with the limiter and the
      // new-phone cap both unable to count.
      expect(ok.status).toBe(201);

      const draft = await request(a.app)
        .post("/api/reports/draft")
        .set("X-Device-Secret", SECRET)
        .set("X-Forwarded-For", "198.51.100.26")
        .send({
          deviceId: fresh,
          clientRef: `ref-${randomBytes(8).toString("hex")}`,
          severity: "urgent",
          lat: 37.4441234,
          lng: 24.9412345,
          language: "en",
        });
      expect(draft.status).toBe(204);

      // Not a cat-in-trouble route: refuses rather than going unlimited.
      const peekRes = await request(a.app)
        .post("/api/restore/peek")
        .set("X-Device-Secret", SECRET)
        .set("X-Forwarded-For", "198.51.100.26")
        .send({ deviceId: fresh, token: "A".repeat(43) });
      expect(peekRes.status).toBe(503);
      expect(peekRes.headers["retry-after"]).toBe("5");

      // The photo route is a cat-in-trouble route too: from a never-seen
      // phone it is not refused for want of a counter (404: no such report).
      const photo = await request(a.app)
        .put("/api/reports/no-such-report/photo")
        .set("X-Device-Secret", SECRET)
        .set("X-Forwarded-For", "198.51.100.27")
        .send({ deviceId: `${DEVICE}-photo`, photoBase64: "AAAA" });
      expect(photo.status).toBe(404);
    } finally {
      await db.execute(sql`alter table rate_limit_counters_gone rename to rate_limit_counters`);
    }
  });
});

describe("fail closed with 503 + Retry-After, off the welfare routes (review finding 7)", () => {
  it("AI limiter (both routes), delete-me, and the new-phone cap on an ordinary route", async () => {
    await db.execute(sql`alter table rate_limit_counters rename to rate_limit_counters_gone`);
    try {
      const ip = "198.51.100.28";
      const calls = [
        request(a.app).post("/api/cats/name-suggestions").set("X-Forwarded-For", ip).send({}),
        request(a.app).post("/api/sightings").set("X-Forwarded-For", ip).send({}),
        request(a.app).delete("/api/me").set("X-Forwarded-For", ip).send({}),
        // A never-seen phone registering on a non-welfare route: the new-phone cap.
        request(a.app)
          .get(`/api/notifications/${DEVICE}-newphone`)
          .set("X-Device-Secret", SECRET)
          .set("X-Forwarded-For", ip),
      ];
      for (const call of calls) {
        const res = await call;
        expect(res.status).toBe(503);
        expect(res.headers["retry-after"]).toBe("5");
      }
    } finally {
      await db.execute(sql`alter table rate_limit_counters_gone rename to rate_limit_counters`);
    }
  });
});

describe("a day-long window survives the sweep until it has ended (review finding 2, probe R3)", () => {
  it("a 24-hour window is still counting at 05:00, after a sweep, and goes once it has ended", async () => {
    const day = Date.UTC(2041, 2, 3);
    for (let i = 0; i < 15; i++) await consume("daily", "addr", 15, DAY, undefined, day + 1000);
    expect((await consume("daily", "addr", 15, DAY, undefined, day + 2000)).allowed).toBe(false);
    // Hour 5 of that day: the old 3-hour rule would have deleted it here.
    await sweepRateLimits(day + 5 * HOUR);
    const after = await consume("daily", "addr", 15, DAY, undefined, day + 5 * HOUR);
    expect(after.allowed).toBe(false);
    expect(after.hits).toBe(17);
    // Well after it has ended, it is swept.
    // (A row outlives its window by one more window, for sliding limits.)
    await sweepRateLimits(day + DAY + 2 * HOUR);
    expect((await peek("daily", "addr", DAY, undefined, day + 5 * HOUR)).hits).toBe(17);
    await sweepRateLimits(day + 2 * DAY + 2 * HOUR);
    expect((await peek("daily", "addr", DAY, undefined, day + 5 * HOUR)).hits).toBe(0);
  });
});

describe("the day's salt is made on the pool, not in the caller's transaction (review finding 3, probe R2)", () => {
  it("a rolled-back transaction does not split one address into two counters", async () => {
    const t = Date.UTC(2042, 6, 7, 12, 0, 0);
    _forgetSaltsForTests();
    await db
      .transaction(async (tx) => {
        await consume("rollback", "addr", 5, HOUR, tx, t);
        throw new Error("roll back, like a refused report");
      })
      .catch(() => undefined);
    // The counter rolled back; the salt did not, so every server shares it.
    const salts = (await db.execute(sql`select count(*)::int as n from rate_limit_salts where day = '2042-07-07'`))
      .rows[0] as { n: number };
    expect(salts.n).toBe(1);
    await consume("rollback", "addr", 5, HOUR, undefined, t);
    vi.resetModules();
    const other = await import("./limits");
    const otherDb = await import("@workspace/db");
    await other.consume("rollback", "addr", 5, HOUR, undefined, t);
    await otherDb.pool.end();
    const rows = (await db.execute(sql`select hits from rate_limit_counters where bucket = 'rollback'`))
      .rows as { hits: number }[];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.hits)).toBe(2);
  });
});

describe("guards (review finding 6)", () => {
  it("refuses a window that does not divide a day, or is longer than one", async () => {
    await expect(consume("badwin", "k", 5, 7 * 60 * 1000)).rejects.toThrow(/divides a day/);
    await expect(consume("badwin", "k", 5, 2 * DAY)).rejects.toThrow(/divides a day/);
    await expect(peek("badwin", "k", 7 * 60 * 1000)).rejects.toThrow(/divides a day/);
    expect(() =>
      sharedLimiter({ bucket: "badwin2", windowMs: 7 * 60 * 1000, limit: 5, message: {} }),
    ).toThrow(/divides a day/);
  });

  it("a second sharedLimiter on the same bucket throws, even with the same settings", () => {
    sharedLimiter({ bucket: "dup", windowMs: HOUR, limit: 5, message: {} });
    expect(() => sharedLimiter({ bucket: "dup", windowMs: HOUR, limit: 5, message: {} })).toThrow(/already has an owner/);
    expect(() => sharedLimiter({ bucket: "dup", windowMs: HOUR, limit: 6, message: {} })).toThrow(/already has an owner/);
  });

  it("consume refuses settings that clash with the bucket's registration, but repeats of the same are fine", async () => {
    await consume("clash", "k", 5, HOUR);
    await consume("clash", "k", 5, HOUR);
    await expect(consume("clash", "k", 6, HOUR)).rejects.toThrow(/registered twice/);
    await expect(consume("clash", "k", 5, 15 * 60 * 1000)).rejects.toThrow(/registered twice/);
    await expect(consume("clash", "k", 5, HOUR, undefined, Date.now(), { sliding: true })).rejects.toThrow(
      /registered twice/,
    );
  });

  it("the function-call limiters are declared when their module loads, so a clash throws at registration", async () => {
    vi.resetModules();
    const fresh = await import("./limits");
    const freshDb = await import("@workspace/db");
    try {
      // Nothing declared yet: any settings are accepted for a new name.
      fresh.declareLimit("claim-clash-probe", 1, HOUR);
      await import("../middlewares/rateLimit");
      await import("../middlewares/newDeviceLimit");
      // Loading those modules declared "claim", "device_match" and "new_device":
      // declaring them again throws now, not on the first request.
      expect(() => fresh.declareLimit("claim", 5, DAY, { sliding: true })).toThrow(/already has an owner/);
      expect(() => fresh.declareLimit("device_match", 20, 15 * 60 * 1000)).toThrow(/already has an owner/);
      expect(() => fresh.declareLimit("new_device", 20, HOUR)).toThrow(/already has an owner/);
      // And a request-time call with the wrong mode is refused before touching a count.
      await expect(fresh.consume("claim", "k", 5, DAY, undefined, Date.now(), { sliding: false })).rejects.toThrow(
        /registered twice/,
      );
    } finally {
      await freshDb.pool.end();
    }
  });
});

describe("the claim limit is a sliding window (about 5 per rolling 24 hours, not 5 per calendar day)", () => {
  const day = Date.UTC(2043, 4, 5);
  const lateOnDay1 = day + 23 * HOUR + 59 * 60 * 1000; // 23:59 UTC
  const earlyOnDay2 = day + DAY + 60 * 1000; // 00:01 UTC, two minutes later

  it("5 claims at 23:59 UTC and a 6th at 00:01 is refused; allowed again 24 hours after the first", async () => {
    expect(CLAIM_LIMIT).toBe(5);
    for (let i = 0; i < CLAIM_LIMIT; i++) expect(await checkClaimLimit("slide-a", lateOnDay1)).toBe(true);
    // A fixed window would hand a fresh allowance here.
    expect(await checkClaimLimit("slide-a", earlyOnDay2)).toBe(false);
    // 24 hours after the five claims, they no longer count (the refusal above does, a little).
    expect(await checkClaimLimit("slide-a", lateOnDay1 + DAY + 60_000)).toBe(true);
  });

  it("the previous window survives the sweep while the current one runs", async () => {
    for (let i = 0; i < CLAIM_LIMIT; i++) await checkClaimLimit("slide-b", lateOnDay1);
    await sweepRateLimits(day + DAY + 30 * 60 * 1000);
    expect(await checkClaimLimit("slide-b", earlyOnDay2)).toBe(false);
  });

  it("a retry storm does not lock the phone out of the next day (the stored count stops at limit + 1)", async () => {
    // 50 attempts at 10:00 on day 1; 45 are refused. The first claim was at 10:00.
    for (let i = 0; i < 50; i++) await checkClaimLimit("slide-storm", day + 10 * HOUR);
    // About 24 hours after the first attempt, the phone is free again.
    expect(await checkClaimLimit("slide-storm", day + DAY + 10 * HOUR + 60_000)).toBe(true);
  });

  it("holds across two app instances", async () => {
    vi.resetModules();
    const other = await import("../middlewares/rateLimit");
    const otherDb = await import("@workspace/db");
    try {
      for (let i = 0; i < 3; i++) expect(await checkClaimLimit("slide-c", lateOnDay1)).toBe(true);
      for (let i = 0; i < 2; i++) expect(await other.checkClaimLimit("slide-c", lateOnDay1)).toBe(true);
      expect(await other.checkClaimLimit("slide-c", earlyOnDay2)).toBe(false);
      expect(await checkClaimLimit("slide-c", earlyOnDay2)).toBe(false);
    } finally {
      await otherDb.pool.end();
    }
  });

  it("resetAt for a refused caller is when the estimate next drops to the limit, capped at the window end", async () => {
    const t0 = Date.UTC(2044, 0, 2); // day 2 starts here
    const prevDay = t0 - HOUR; // 23:00 on day 1
    for (let i = 0; i < 5; i++) await consume("slidereset", "k", 5, DAY, undefined, prevDay, { sliding: true });
    const noon = t0 + 12 * HOUR;
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await consume("slidereset", "k", 5, DAY, undefined, noon, { sliding: true }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    // 3 counted today: a retry makes 4, so 5 * (1 - t/W) + 4 <= 5 from t/W = 0.8.
    expect(results[2]!.resetAt).toBe(t0 + 0.8 * DAY);
    // And that is when it is indeed allowed (peek shows the same).
    expect((await peek("slidereset", "k", DAY, undefined, noon, { sliding: true, limit: 5 })).resetAt).toBe(
      t0 + 0.8 * DAY,
    );
    // An allowed caller is told the window end.
    expect(results[0]!.resetAt).toBe(t0 + DAY);
    // Past the window end it is capped there.
    for (let i = 0; i < 9; i++) await consume("slidereset2", "k", 5, DAY, undefined, noon, { sliding: true });
    expect((await consume("slidereset2", "k", 5, DAY, undefined, noon, { sliding: true })).resetAt).toBe(t0 + DAY);
  });

  it("a fixed-window limit is unchanged: it still resets at the boundary", async () => {
    for (let i = 0; i < 5; i++) await consume("fixedday", "k", 5, DAY, undefined, lateOnDay1);
    expect((await consume("fixedday", "k", 5, DAY, undefined, earlyOnDay2)).allowed).toBe(true);
  });
});
