import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import type { Express } from "express";
import { db, pool, deviceCredentialsTable, welfareReportsTable } from "@workspace/db";
import { like, sql } from "drizzle-orm";
import {
  _resetLimitsSweepForTests,
  addressKey,
  consume,
  peek,
  sweepRateLimits,
  sweepRateLimitsIfDue,
} from "./limits";

// SYC-105 PR 2.1 tests T2-1 to T2-6 (docs/superpowers/plans/syc-44-report-an-issue.md,
// Slice 2): limits counted in Postgres, not in a server's memory.

const DEVICE = `vitest-limits-${randomBytes(4).toString("hex")}`;
const SECRET = "vitest-limits-secret-0123456789";
const HOUR = 60 * 60 * 1000;

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
    } finally {
      await db.execute(sql`alter table rate_limit_counters_gone rename to rate_limit_counters`);
    }
  });
});
