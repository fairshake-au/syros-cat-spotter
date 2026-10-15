import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { catsTable, db, deviceCredentialsTable, photosTable, pool, welfareReportsTable } from "@workspace/db";
import { inArray, like, sql } from "drizzle-orm";

// SYC-44 PR 5.1, review finding 1 (the blocker), kept as a regression test.
// Adapted from the Opus reviewer's probe.
//
// Inside a report's transaction, with the brake's advisory lock held, the
// address hide limits are counted. If counting needed a SECOND pool
// connection (a rate-limit salt not yet cached, as after a restart), and
// every pool connection were held by another report waiting on the same
// lock, nothing could ever move, and every route would wait for ever. The
// fix works out the salts before the transaction opens (`prepareHide`), and
// the brake lock has a timeout that fails closed.
//
// This file makes a fresh app instance (vi.resetModules, so an empty salt
// cache), holds the brake lock briefly so reports pile up behind it, and
// sends more hide reports at once than the pool has connections (10).

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-issuepool-${RUN}-`;
const SECRET = `vitest-issuepool-secret-${RUN}-0123456789`;
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
// A day no other test pins (issues.test.ts: 2031 on; issues.instances: June 2030).
const DAY = Date.UTC(2032, 2, 3, 12);
const BRAKE_LOCK = 44_051;

let app: Express;
let instancePool: { end(): Promise<void> };
let settle: () => Promise<void>;
let n = 0;

async function seedCat() {
  n += 1;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo-${n}`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: 33.7733,
      lng: 23.1177,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  return { id: c!.id, photo: p! };
}

const saved = { ...process.env };
beforeAll(async () => {
  process.env["TURNSTILE_MODE"] = "enforce";
  process.env["TURNSTILE_SECRET_KEY"] = "0x4AAAA-vitest-issuepool";
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  process.env["WELFARE_ALERT_TO"] = "alerts@example.org";
  delete process.env["TURNSTILE_HOSTNAMES"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("siteverify")) {
        const token = (JSON.parse(String(init?.body)) as { response: string }).response;
        return new Response(
          JSON.stringify({
            success: true,
            hostname: "apptest.catspotters.com",
            action: "report_issue",
            cdata: token.replace(/^token-for:/, ""),
            "error-codes": [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ id: "re_test" }), { status: 200 });
    }),
  );
  // A fresh copy of every module: an empty salt cache, as after a restart.
  vi.resetModules();
  app = (await import("../app")).default;
  instancePool = (await import("@workspace/db")).pool;
  settle = (await import("../lib/mail/outbox")).settleOutbox;
  const hide = await import("../lib/issues/hide");
  hide._setBrakeForTests(50);
  hide._setIssueClockForTests(DAY);
});

afterAll(async () => {
  await settle();
  await instancePool.end();
  vi.unstubAllGlobals();
  process.env = { ...saved };
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${PREFIX + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (cats.length) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  await pool.end();
});

describe("review finding 1: hide reports at once, right after a restart, never lock up the pool", () => {
  it("12 concurrent hide reports behind a held brake lock all finish", async () => {
    const cats = [];
    for (let i = 0; i < 12; i++) cats.push(await seedCat());

    // Hold the brake lock, as a slow first hide would, so the others pile up
    // behind it holding their pool connections.
    const holder = await pool.connect();
    await holder.query("begin");
    await holder.query(`select pg_advisory_xact_lock(${BRAKE_LOCK})`);

    const sends = cats.map((cat, i) => {
      const ref = `ref-${RUN}-${i}`;
      return request(app)
        .post("/api/issues")
        .set("X-Device-Secret", SECRET)
        .set("X-Forwarded-For", `2001:db8:7799:${i.toString(16).padStart(2, "0")}00::1`)
        .send({
          deviceId: `${PREFIX}dev-${i}`,
          clientRef: ref,
          reason: "photo_private",
          catId: cat.id,
          photoPublicId: cat.photo.publicId,
          language: "en",
          turnstileToken: `token-for:${ref}`,
        })
        .then((r) => ({ status: r.status, hidden: r.body.hidden as boolean }))
        .catch(() => ({ status: -1, hidden: false }));
    });
    await new Promise((r) => setTimeout(r, 300));
    await holder.query("commit");
    holder.release();

    const outcome = await Promise.race([
      Promise.all(sends).then((s) => ({ done: true as const, results: s })),
      new Promise<{ done: false }>((r) => setTimeout(() => r({ done: false }), 15_000)),
    ]);
    if (!outcome.done) {
      // Free the database for the rest of the run before failing.
      await db.execute(sql`
        select pg_terminate_backend(pid) from pg_stat_activity
         where datname = current_database() and wait_event = 'advisory'
      `);
    }
    expect(outcome.done).toBe(true);
    if (outcome.done) {
      expect(outcome.results.map((r) => r.status)).toEqual(Array(12).fill(201));
      expect(outcome.results.every((r) => r.hidden)).toBe(true);
    }
  }, 30_000);
});
