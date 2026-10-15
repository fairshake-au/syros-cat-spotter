import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import {
  catsTable,
  db,
  deviceCredentialsTable,
  photosTable,
  pool,
  welfareReportsTable,
} from "@workspace/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import { hiddenPhotoIds } from "../lib/photoVisibility";

// SYC-44 PR 5.1, T5-4 [spec 4] across two servers: the address hide limit
// (5 an hour) is counted in Postgres, so it holds when one address's reports
// land on two app instances. The brake is raised to 50 on both, because with
// the brake at 5 a day on which one address can reach its 6th hide doesn't
// exist (plan review finding 5). No mocks in this file: each instance is its
// own copy of every module (vi.resetModules), as two servers would be, and
// they share only the database. The rest of T5-4 is in issues.test.ts.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-issue2-${RUN}-`;
const SECRET = `vitest-issue2-secret-${RUN}-0123456789`;
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
// A day no other test pins (issues.test.ts uses 2031 onwards).
const DAY = Date.UTC(2030, 5, 15, 12);

type Instance = {
  app: Express;
  pool: { end(): Promise<void> };
  settle: () => Promise<void>;
};
async function newInstance(): Promise<Instance> {
  vi.resetModules();
  const app = (await import("../app")).default;
  const dbModule = await import("@workspace/db");
  const hide = await import("../lib/issues/hide");
  const outbox = await import("../lib/mail/outbox");
  hide._setBrakeForTests(50);
  hide._setIssueClockForTests(DAY);
  return { app, pool: dbModule.pool, settle: outbox.settleOutbox };
}

let a: Instance;
let b: Instance;
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
      lat: 33.7722,
      lng: 23.1199,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  return { id: c!.id, photo: p! };
}

function send(inst: Instance, ip: string, cat: { id: number; photo: { publicId: string } }, ref: string) {
  return request(inst.app)
    .post("/api/issues")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", ip)
    .send({
      deviceId: `${PREFIX}dev`,
      clientRef: ref,
      reason: "photo_private",
      catId: cat.id,
      photoPublicId: cat.photo.publicId,
      language: "en",
      turnstileToken: `token-for:${ref}`,
    });
}

const saved = { ...process.env };
async function cleanup() {
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${PREFIX + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

beforeAll(async () => {
  await cleanup();
  process.env["TURNSTILE_MODE"] = "enforce";
  process.env["TURNSTILE_SECRET_KEY"] = "0x4AAAA-vitest-issue2-secret";
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
  a = await newInstance();
  b = await newInstance();
});
afterAll(async () => {
  for (const inst of [a, b]) {
    await inst.settle();
    await inst.pool.end();
  }
  vi.unstubAllGlobals();
  process.env = { ...saved };
  await cleanup();
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  if (cats.length) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  await pool.end();
});

describe("T5-4 [spec 4], two instances", () => {
  it("the 6th hide from one address (one /56) in an hour doesn't hide, across two app instances", async () => {
    // Two addresses in one /56 count as one.
    const ips = ["2001:db8:5145:ff00::1", "2001:db8:5145:ff12::99"];
    for (let i = 0; i < 5; i++) {
      const cat = await seedCat();
      const res = await send(i % 2 ? b : a, ips[i % 2]!, cat, `ref-${RUN}-${i}`);
      expect(res.status, `hide ${i + 1}`).toBe(201);
      expect(res.body.hidden, `hide ${i + 1}`).toBe(true);
    }
    const cat = await seedCat();
    const ref = `ref-${RUN}-6th`;
    const res = await send(b, ips[0]!, cat, ref);
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(false);
    const [row] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
    expect(row).toMatchObject({ hiddenByReport: false, hideSkipped: "address_limit" });
    expect((await hiddenPhotoIds([cat.photo.id])).has(cat.photo.id)).toBe(false);
  });
});
