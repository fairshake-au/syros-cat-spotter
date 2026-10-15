import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addPerson,
  catsTable,
  db,
  deviceCredentialsTable,
  mailOutboxTable,
  observationsTable,
  photosTable,
  photoVisibilityEventsTable,
  pool,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { deleteTestSightings } from "../test/sightings";

// SYC-44 PR 5.1 (plan docs/superpowers/plans/syc-44-report-an-issue.md, PR 5.1;
// spec docs/specs/report-an-issue.md §5.1, §6, §8, §9.5, §13): POST /api/issues
// and the one-report photo hide. Tests T5-1 … T5-12 (T5-12 is P6-0, run as
// lib/photoVisibility.source.test.ts, plus a check here that this PR's files
// build no photo address). Siteverify is faked at the fetch boundary.
//
// Isolation: the brake counts report-hides island-wide, and the hide log is
// append-only, so every test pins the issue clock to a day of its own
// (`freshDay()`); nothing one test hides can count against another.

const flags = vi.hoisted(() => ({
  failAlert: false,
  failHideCounter: false,
  pushes: [] as unknown[][],
}));

vi.mock("../lib/mail/outbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/mail/outbox")>();
  return {
    ...real,
    enqueueIssueAlert: async (...args: Parameters<typeof real.enqueueIssueAlert>) => {
      if (flags.failAlert) throw new Error("forced outbox failure (test)");
      return real.enqueueIssueAlert(...args);
    },
  };
});

vi.mock("../lib/limits", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/limits")>();
  return {
    ...real,
    consume: async (...args: Parameters<typeof real.consume>) => {
      if (flags.failHideCounter && String(args[0]).startsWith("issue_hide")) {
        throw new Error("forced counter failure (test)");
      }
      return real.consume(...args);
    },
  };
});

vi.mock("../lib/push", () => ({
  sendPushNotification: vi.fn(async (...args: unknown[]) => {
    flags.pushes.push(args);
  }),
}));

import app from "../app";
import { SITEVERIFY_URL } from "../lib/turnstile";
import { settleOutbox } from "../lib/mail/outbox";
import { hiddenPhotoIds } from "../lib/photoVisibility";
import {
  REPORT_HIDES_PER_ATHENS_DAY,
  _setBrakeForTests,
  _setIssueClockForTests,
} from "../lib/issues/hide";
import { _resetUncheckedLimitForTests } from "../lib/uncheckedLimit";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-issue-${RUN}-`;
const SECRET = `vitest-issue-secret-${RUN}-0123456789`;
const TURNSTILE_SECRET = "0x4AAAA-vitest-issue-secret";
const TOKEN = "0.vitest-issue-token";
// Far out at sea, away from every other file's cats.
const ORIGIN = { lat: 33.7711, lng: 23.1188 };
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

// ── The fake network ───────────────────────────────────────────────────────

type Siteverify = (body: { response: string }) => Response | Promise<Response>;
let siteverify: Siteverify;
let siteverifyCalls = 0;

const cf = (body: Record<string, unknown>, status = 200): Siteverify => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/**
 * Cloudflare's "success" for whatever report the token was made for: the
 * test sends `token-for:<clientRef>`, and the fake echoes that clientRef as
 * the cdata, as a real token would.
 */
const passAll: Siteverify = (body) =>
  cf({
    success: true,
    hostname: "apptest.catspotters.com",
    action: "report_issue",
    cdata: body.response.replace(/^token-for:/, ""),
    "error-codes": [],
  })(body);
const timeout: Siteverify = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};

function installFakeNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === SITEVERIFY_URL) {
        siteverifyCalls += 1;
        return siteverify(JSON.parse(String(init?.body)) as { response: string });
      }
      return new Response(JSON.stringify({ id: "re_test" }), { status: 200 });
    }),
  );
}

// ── Time ───────────────────────────────────────────────────────────────────

let dayN = 0;
/** Noon UTC on a day nothing else uses (from 1 Jan 2031). */
function freshDay(): number {
  dayN += 1;
  return Date.UTC(2031, 0, 1, 12) + dayN * 86_400_000;
}
const HOUR = 60 * 60 * 1000;

// ── Seeding ────────────────────────────────────────────────────────────────

let n = 0;
interface SeededPhoto {
  id: number;
  publicId: string;
}
interface SeededCat {
  id: number;
  main: SeededPhoto;
  sightings: SeededPhoto[];
}

async function photo(): Promise<SeededPhoto> {
  n += 1;
  const publicId = `${PREFIX}photo-${n}`;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  return { id: p!.id, publicId };
}

async function seedCat(count = 2): Promise<SeededCat> {
  n += 1;
  const main = await photo();
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: main.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  const sightings: SeededPhoto[] = [];
  for (let i = 0; i < count; i++) {
    const p = await photo();
    await db.insert(sightingsTable).values({
      catId: c!.id,
      deviceId: `${PREFIX}spotter`,
      photoId: p.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      status: "resolved",
    });
    sightings.push(p);
  }
  return { id: c!.id, main, sightings };
}

let staffId: string;
/** The day beforeEach pinned for this test. */
let today: number;

/** A team hide or restore, stamped at `at` (real time by default). */
async function teamEvent(photoId: number, action: "hide" | "restore", at = new Date()) {
  await db.insert(photoVisibilityEventsTable).values({
    photoId,
    action,
    author: staffId,
    personId: staffId,
    reason: "test",
    at,
  });
}

// ── Requests ───────────────────────────────────────────────────────────────

let ipN = 0;
/** An address in a /56 of its own (addresses are counted by their /56). */
function freshIp(): string {
  ipN += 1;
  return `2001:db8:5144:${ipN.toString(16).padStart(2, "0")}00::1`;
}
let devN = 0;
const freshDevice = () => `${PREFIX}dev-${++devN}`;
const clientRef = () => `ref-${randomBytes(8).toString("hex")}`;

type Send = {
  catId: number;
  reason: string;
  photoPublicId?: string | null;
  clientRef?: string;
  deviceId?: string;
  ip?: string;
  /** Default: a token made for this clientRef. null: no token at all. */
  token?: string | null;
  note?: string;
  app?: Express;
};

function send(s: Send) {
  const ref = s.clientRef ?? clientRef();
  const token = s.token === undefined ? `token-for:${ref}` : s.token;
  const body: Record<string, unknown> = {
    deviceId: s.deviceId ?? freshDevice(),
    clientRef: ref,
    reason: s.reason,
    catId: s.catId,
    language: "en",
    note: s.note ?? "a note from the reporter",
  };
  if (s.photoPublicId !== undefined && s.photoPublicId !== null) body["photoPublicId"] = s.photoPublicId;
  if (token !== null) body["turnstileToken"] = token;
  return request(s.app ?? app)
    .post("/api/issues")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", s.ip ?? freshIp())
    .send(body);
}

async function rowFor(ref: string) {
  const [row] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
  return row;
}

async function eventsFor(photoId: number) {
  return db
    .select()
    .from(photoVisibilityEventsTable)
    .where(eq(photoVisibilityEventsTable.photoId, photoId))
    .orderBy(photoVisibilityEventsTable.id);
}

async function isHidden(photoId: number) {
  return (await hiddenPhotoIds([photoId])).has(photoId);
}

async function issueAlertsFor(reportId: number) {
  return db
    .select()
    .from(mailOutboxTable)
    .where(and(eq(mailOutboxTable.reportId, reportId), eq(mailOutboxTable.purpose, "issue_alert")));
}

/** Hide events by reports, seeded straight into the log at `at`. */
async function seedReportHides(count: number, at: Date) {
  for (let i = 0; i < count; i++) {
    const p = await photo();
    await db.insert(photoVisibilityEventsTable).values({
      photoId: p.id,
      action: "hide",
      author: `report:seed-${p.id}`,
      personId: null,
      reason: "photo_private",
      at,
    });
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

async function cleanup() {
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${PREFIX + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${PREFIX}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${PREFIX}%`));
}

const saved = { ...process.env };
beforeAll(async () => {
  await cleanup();
  staffId = (
    await addPerson({ email: `vitest-issue-${RUN}@example.com`, name: "Staff", addedBy: "cli:vitest", roles: ["staff"] })
  ).id;
});
beforeEach(async () => {
  siteverify = passAll;
  siteverifyCalls = 0;
  flags.failAlert = false;
  flags.failHideCounter = false;
  flags.pushes.length = 0;
  _setBrakeForTests();
  today = freshDay();
  _setIssueClockForTests(today);
  await _resetUncheckedLimitForTests();
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  process.env["WELFARE_ALERT_TO"] = "alerts@example.org";
  process.env["TURNSTILE_MODE"] = "enforce";
  process.env["TURNSTILE_SECRET_KEY"] = TURNSTILE_SECRET;
  delete process.env["TURNSTILE_HOSTNAMES"];
  installFakeNetwork();
});
afterEach(async () => {
  await settleOutbox();
  vi.unstubAllGlobals();
  _setIssueClockForTests(null);
  process.env = { ...saved };
});
afterAll(async () => {
  await cleanup();
  const cats = await db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  if (cats.length) await db.delete(catsTable).where(inArray(catsTable.id, cats.map((c) => c.id)));
  await pool.end();
});

// ── T5-1 ───────────────────────────────────────────────────────────────────

describe("T5-1 [spec 1]: a confirmed hiding report hides in the same transaction", () => {
  it("photo_private on the main photo: hidden, logged as report:<id>, gone from the public, alert queued", async () => {
    const cat = await seedCat();
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ publicId: expect.any(String), hidden: true });

    const row = await rowFor(ref);
    expect(row).toMatchObject({
      kind: "content",
      reason: "photo_private",
      photoId: cat.main.id,
      catId: cat.id,
      hiddenByReport: true,
      hideSkipped: null,
      tokenChecked: true,
      photoState: "none",
      severity: "attention",
      isLitter: false,
      lat: null,
      lng: null,
    });
    const events = await eventsFor(cat.main.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "hide",
      author: `report:${row!.id}`,
      personId: null,
      reason: "photo_private",
    });
    expect(await issueAlertsFor(row!.id)).toHaveLength(1);

    // Gone from every public place (the readers all go through
    // publicPhotoUrl; P6-1…P6-9 prove each reader for any hide event).
    expect((await request(app).get(`/api/photos/${cat.main.publicId}`)).status).toBe(404);
    const detail = await request(app).get(`/api/cats/${cat.id}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain(cat.main.publicId);
    const list = await request(app).get(`/api/cats?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
    expect((list.body.cats as { id: number }[]).some((c) => c.id === cat.id)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(cat.main.publicId);
  });

  it("photo_inappropriate on a sighting photo hides too", async () => {
    const cat = await seedCat();
    const target = cat.sightings[1]!;
    const res = await send({ catId: cat.id, reason: "photo_inappropriate", photoPublicId: target.publicId });
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(true);
    expect(await isHidden(target.id)).toBe(true);
    expect(await isHidden(cat.main.id)).toBe(false);
    expect((await request(app).get(`/api/photos/${target.publicId}`)).status).toBe(404);
  });

  it("atomic: when queueing the alert fails, there is no row and no hide", async () => {
    const cat = await seedCat();
    const ref = clientRef();
    flags.failAlert = true;
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(500);
    expect(await rowFor(ref)).toBeUndefined();
    expect(await eventsFor(cat.main.id)).toHaveLength(0);
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  it("a report about a photo that is already hidden is still recorded (spec §13), as already_hidden", async () => {
    const cat = await seedCat();
    await teamEvent(cat.main.id, "hide");
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(true);
    expect(await rowFor(ref)).toMatchObject({ hiddenByReport: false, hideSkipped: "already_hidden" });
    expect(await eventsFor(cat.main.id)).toHaveLength(1); // no second hide
  });
});

// ── T5-2 ───────────────────────────────────────────────────────────────────

describe("T5-2 [spec 2]: a token that isn't good is 428 and writes nothing", () => {
  const bad: [string, Siteverify, string | null][] = [
    ["missing", passAll, null],
    ["success: false", cf({ success: false, "error-codes": ["invalid-input-response"] }), TOKEN],
    ["the wrong action", cf({ success: true, hostname: "apptest.catspotters.com", action: "welfare_report", cdata: "x", "error-codes": [] }), TOKEN],
    ["another report's cdata", cf({ success: true, hostname: "apptest.catspotters.com", action: "report_issue", cdata: "ref-someone-else", "error-codes": [] }), TOKEN],
    ["hostname team.catspotters.com", (b) => cf({ success: true, hostname: "team.catspotters.com", action: "report_issue", cdata: b.response.replace(/^token-for:/, ""), "error-codes": [] })(b), undefined as unknown as string],
    ["a reused token", cf({ success: false, "error-codes": ["timeout-or-duplicate"] }), TOKEN],
    ["over 2,048 characters", passAll, "x".repeat(2049)],
  ];

  it.each(bad)("%s", async (_name, reply, token) => {
    const cat = await seedCat(0);
    siteverify = reply;
    const ref = clientRef();
    const res = await send({
      catId: cat.id,
      reason: "photo_private",
      photoPublicId: cat.main.publicId,
      clientRef: ref,
      ...(token === undefined ? {} : { token }),
    });
    expect(res.status).toBe(428);
    expect(res.body).toEqual({ error: "challenge_required" });
    expect(await rowFor(ref)).toBeUndefined();
    expect(await eventsFor(cat.main.id)).toHaveLength(0);
  });

  it.each([
    ["a siteverify timeout", timeout],
    ["a siteverify 503", cf({}, 503)],
  ])("%s: an unchecked row that does not hide", async (_name, reply) => {
    const cat = await seedCat(0);
    siteverify = reply;
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: false, hiddenByReport: false, hideSkipped: "unchecked" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  it("the unchecked fence is shared with the cat-in-trouble form: the 4th from one address in an hour is 429", async () => {
    const cat = await seedCat(0);
    siteverify = timeout;
    const ip = freshIp();
    for (let i = 0; i < 3; i++) {
      expect((await send({ catId: cat.id, reason: "wrong_name", ip })).status).toBe(201);
    }
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "wrong_name", ip, clientRef: ref });
    expect(res.status).toBe(429);
    expect(await rowFor(ref)).toBeUndefined();
  });

  it("sends that save nothing don't use up the shared unchecked fence (review finding 6)", async () => {
    const cat = await seedCat(0);
    siteverify = timeout;
    const ip = freshIp();
    const deviceId = freshDevice();
    for (let i = 0; i < 3; i++) {
      expect((await send({ ip, deviceId, catId: 2_000_000_000, reason: "cat_died" })).status).toBe(404);
      expect((await send({ ip, deviceId, catId: cat.id, reason: "photo_private", photoPublicId: `${PREFIX}nope` })).status).toBe(404);
    }
    const ref = clientRef();
    const res = await send({ ip, deviceId, clientRef: ref, catId: cat.id, reason: "wrong_name" });
    expect(res.status).toBe(201);
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: false });
  });

  it("our own key wrong is 503 turnstile_not_configured, never unchecked", async () => {
    const cat = await seedCat(0);
    siteverify = cf({ success: false, "error-codes": ["invalid-input-secret"] });
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "turnstile_not_configured" });
    expect(await rowFor(ref)).toBeUndefined();
  });

  it.each(["observe", "off"])("TURNSTILE_MODE=%s: refuses nothing, and never hides, even with a good token", async (mode) => {
    process.env["TURNSTILE_MODE"] = mode;
    const cat = await seedCat(0);
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hiddenByReport: false, hideSkipped: "unchecked" });
    expect(await isHidden(cat.main.id)).toBe(false);
    // A rejected token isn't refused outside enforce either.
    siteverify = cf({ success: false, "error-codes": ["invalid-input-response"] });
    const res2 = await send({ catId: cat.id, reason: "photo_inappropriate", photoPublicId: cat.main.publicId });
    expect(res2.status).toBe(201);
    expect(res2.body.hidden).toBe(false);
  });
});

// ── T5-3 ───────────────────────────────────────────────────────────────────

describe("T5-3 [spec 3]: a photo the team has ever restored is never hidden by a report", () => {
  it("hidden and restored once", async () => {
    const cat = await seedCat(0);
    await teamEvent(cat.main.id, "hide", new Date(Date.now() - 2 * HOUR));
    await teamEvent(cat.main.id, "restore", new Date(Date.now() - HOUR));
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hiddenByReport: false, hideSkipped: "restored_before" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  it("restored, hidden again by the team, and restored a second time", async () => {
    const cat = await seedCat(0);
    const t = Date.now();
    await teamEvent(cat.main.id, "hide", new Date(t - 4 * HOUR));
    await teamEvent(cat.main.id, "restore", new Date(t - 3 * HOUR));
    await teamEvent(cat.main.id, "hide", new Date(t - 2 * HOUR));
    await teamEvent(cat.main.id, "restore", new Date(t - HOUR));
    const ref = clientRef();
    const res = await send({ catId: cat.id, reason: "photo_inappropriate", photoPublicId: cat.main.publicId, clientRef: ref });
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hideSkipped: "restored_before" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });
});

// ── T5-4 ───────────────────────────────────────────────────────────────────

// The hourly limit across two app instances is issues.instances.test.ts (no
// mocks there: fresh app instances need the real limits module).
describe("T5-4 [spec 4]: the address hide limits (5 an hour, 15 a day), with the brake raised", () => {
  it("15 a day: the 16th hide in a day doesn't hide, though its hour is fresh", async () => {
    _setBrakeForTests(50);
    const day = freshDay() - 11 * HOUR; // 01:00 UTC
    const ip = freshIp();
    // Two hours apart: the hourly limit is sliding, so the hour just before
    // still weighs on the next one.
    for (let h = 0; h < 6; h += 2) {
      _setIssueClockForTests(day + h * HOUR);
      for (let i = 0; i < 5; i++) {
        const cat = await seedCat(0);
        const res = await send({ ip, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
        expect(res.body.hidden, `hour ${h} hide ${i + 1}`).toBe(true);
      }
    }
    _setIssueClockForTests(day + 6 * HOUR);
    const cat = await seedCat(0);
    const ref = clientRef();
    const res = await send({ ip, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hideSkipped: "address_limit" });
  });

  it("a report that rolls back uses none of the address's hides", async () => {
    _setBrakeForTests(50);
    const ip = freshIp();
    flags.failAlert = true;
    for (let i = 0; i < 5; i++) {
      const cat = await seedCat(0);
      expect((await send({ ip, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId })).status).toBe(500);
    }
    flags.failAlert = false;
    for (let i = 0; i < 5; i++) {
      const cat = await seedCat(0);
      const res = await send({ ip, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
      expect(res.body.hidden, `hide ${i + 1} after the rolled-back five`).toBe(true);
    }
  });

  it("the hourly limit slides: 5 just before the hour and a 6th just after it doesn't hide (review finding 9)", async () => {
    _setBrakeForTests(50);
    const hourStart = freshDay(); // noon UTC, on the hour
    const ip = freshIp();
    _setIssueClockForTests(hourStart - 60_000);
    for (let i = 0; i < 5; i++) {
      const cat = await seedCat(0);
      expect((await send({ ip, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId })).body.hidden).toBe(true);
    }
    _setIssueClockForTests(hourStart + 60_000);
    const cat = await seedCat(0);
    const ref = clientRef();
    const res = await send({ ip, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hideSkipped: "address_limit" });
  });

  it("a hide counter that fails is a closed door: the report is saved, the photo isn't hidden", async () => {
    flags.failHideCounter = true;
    const cat = await seedCat(0);
    const ref = clientRef();
    const res = await send({ clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(res.status).toBe(201);
    expect(res.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hideSkipped: "address_limit" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });
});

// ── T5-5 ───────────────────────────────────────────────────────────────────

describe("T5-5 [spec 5]: the brake: 5 report-hides a day, Athens time, no resume", () => {
  // Sunday 25 Oct 2026: Athens moves from EEST (UTC+3) to EET (UTC+2) at
  // 04:00 local (01:00 UTC). That day is 25 hours long: midnight Athens is
  // 21:00 UTC on the 24th, and the next midnight is 22:00 UTC on the 25th.
  const at = (iso: string) => Date.parse(iso);

  async function hideAt(iso: string) {
    _setIssueClockForTests(at(iso));
    const cat = await seedCat(0);
    const ref = clientRef();
    const res = await send({ clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(res.status).toBe(201);
    return { res, ref, cat };
  }

  it("counts report-hides from midnight Athens, across the clock change", async () => {
    expect(REPORT_HIDES_PER_ATHENS_DAY).toBe(5);
    // 00:10 Athens on the 25th (still summer time).
    expect((await hideAt("2026-10-24T21:10:00Z")).res.body.hidden).toBe(true);
    // After the clocks go back.
    expect((await hideAt("2026-10-25T02:00:00Z")).res.body.hidden).toBe(true);
    expect((await hideAt("2026-10-25T10:00:00Z")).res.body.hidden).toBe(true);
    expect((await hideAt("2026-10-25T15:00:00Z")).res.body.hidden).toBe(true);
    // A TEAM hide that day doesn't count toward the brake.
    const teamCat = await seedCat(0);
    await teamEvent(teamCat.main.id, "hide", new Date(at("2026-10-25T16:00:00Z")));
    // The 5th report-hide still goes.
    expect((await hideAt("2026-10-25T18:00:00Z")).res.body.hidden).toBe(true);

    // 23:50 Athens on the 25th (21:50 UTC): the 6th is saved, not hidden.
    // (A rolling 24 hours would no longer count the 00:10 hide, and a fixed
    // UTC+3 day would already be the 26th: either would hide here.)
    const sixth = await hideAt("2026-10-25T21:50:00Z");
    expect(sixth.res.body.hidden).toBe(false);
    expect(await rowFor(sixth.ref)).toMatchObject({ hiddenByReport: false, hideSkipped: "brake" });
    expect(await isHidden(sixth.cat.main.id)).toBe(false);

    // 00:05 Athens on the 26th (22:05 UTC on the 25th): hides again, on its own.
    expect((await hideAt("2026-10-25T22:05:00Z")).res.body.hidden).toBe(true);
  });

  it("on the database's own clock (production's path): the 6th report-hide today is braked, and a hide is stamped now (review finding 7)", async () => {
    _setIssueClockForTests(null);
    const first = await seedCat(0);
    const res = await send({ catId: first.id, reason: "photo_private", photoPublicId: first.main.publicId });
    expect(res.body.hidden).toBe(true);
    const [event] = await eventsFor(first.main.id);
    expect(Math.abs(event!.at.getTime() - Date.now())).toBeLessThan(60_000);
    // Four more report-hides today, Athens time (stamped now, which is today).
    await seedReportHides(REPORT_HIDES_PER_ATHENS_DAY - 1, new Date());
    const sixth = await seedCat(0);
    const ref = clientRef();
    const res6 = await send({ clientRef: ref, catId: sixth.id, reason: "photo_private", photoPublicId: sixth.main.publicId });
    expect(res6.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ hideSkipped: "brake" });
  });

  it("the team can still hide by hand while the brake is on", async () => {
    await seedReportHides(5, new Date(today));
    const cat = await seedCat(0);
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(res.body.hidden).toBe(false);
    await teamEvent(cat.main.id, "hide");
    expect(await isHidden(cat.main.id)).toBe(true);
  });

  it("there is no resume: no route anywhere names the brake or a resume", () => {
    const routesDir = fileURLToPath(new URL(".", import.meta.url));
    for (const f of readdirSync(routesDir).filter((x) => x.endsWith(".ts") && !x.includes(".test."))) {
      const text = readFileSync(join(routesDir, f), "utf8");
      expect(text, f).not.toMatch(/router\.(post|get|put|patch|delete)\([^)]*(resume|brake)/i);
    }
  });
});

// ── T5-6 ───────────────────────────────────────────────────────────────────

describe("T5-6 [spec 6]: every refusal answers hidden: false, read from the row", () => {
  it.each(["address_limit", "restored_before", "brake", "unchecked"] as const)("%s", async (why) => {
    const cat = await seedCat(0);
    const ip = freshIp();
    if (why === "address_limit") {
      _setBrakeForTests(50);
      for (let i = 0; i < 5; i++) {
        const c = await seedCat(0);
        expect((await send({ ip, catId: c.id, reason: "photo_private", photoPublicId: c.main.publicId })).body.hidden).toBe(true);
      }
    }
    if (why === "restored_before") {
      await teamEvent(cat.main.id, "hide", new Date(Date.now() - 2 * HOUR));
      await teamEvent(cat.main.id, "restore", new Date(Date.now() - HOUR));
    }
    if (why === "brake") await seedReportHides(5, new Date(today));
    if (why === "unchecked") siteverify = timeout;
    const ref = clientRef();
    const res = await send({ ip, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ publicId: expect.any(String), hidden: false });
    expect(await rowFor(ref)).toMatchObject({ hiddenByReport: false, hideSkipped: why });
    expect(await isHidden(cat.main.id)).toBe(false);
  });
});

// ── T5-7 ───────────────────────────────────────────────────────────────────

describe("T5-7 [spec 7]: died, name, info and location reports change nothing public", () => {
  it.each(["cat_died", "wrong_name", "wrong_info", "location_revealing", "other", "wrong_cat", "photo_not_cat"])(
    "%s",
    async (reason) => {
      const cat = await seedCat();
      const before = await request(app).get(`/api/cats/${cat.id}`);
      const observationsBefore = await db.select({ id: observationsTable.id }).from(observationsTable).where(eq(observationsTable.catId, cat.id));
      const photoReason = reason === "photo_not_cat" || reason === "wrong_cat";
      const res = await send({
        catId: cat.id,
        reason,
        photoPublicId: photoReason ? cat.sightings[0]!.publicId : undefined,
      });
      expect(res.status).toBe(201);
      expect(res.body.hidden).toBe(false);
      const after = await request(app).get(`/api/cats/${cat.id}`);
      expect(after.status).toBe(200);
      expect(JSON.stringify(after.body)).toBe(JSON.stringify(before.body));
      expect(flags.pushes).toHaveLength(0);
      const observationsAfter = await db.select({ id: observationsTable.id }).from(observationsTable).where(eq(observationsTable.catId, cat.id));
      expect(observationsAfter).toEqual(observationsBefore);
      for (const p of [cat.main, ...cat.sightings]) expect(await eventsFor(p.id)).toHaveLength(0);
      const row = await rowFor((await db.select({ ref: welfareReportsTable.clientRef }).from(welfareReportsTable).where(eq(welfareReportsTable.publicId, res.body.publicId)))[0]!.ref);
      expect(row).toMatchObject({ hideSkipped: null, hiddenByReport: false });
      expect(await issueAlertsFor(row!.id)).toHaveLength(0);
    },
  );
});

// ── T5-8 ───────────────────────────────────────────────────────────────────

describe("T5-8 [spec 14, server]: resends, and the upgrade case", () => {
  it("a second send of the same clientRef is one report, with the stored answer, even with no token", async () => {
    const cat = await seedCat(0);
    const ref = clientRef();
    const deviceId = freshDevice();
    const first = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(first.status).toBe(201);
    const calls = siteverifyCalls;
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, token: null });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(siteverifyCalls).toBe(calls);
    const rows = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
    expect(rows).toHaveLength(1);
  });

  it("the stored answer stands even after the team restores the photo", async () => {
    const cat = await seedCat(0);
    const ref = clientRef();
    const deviceId = freshDevice();
    const first = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(first.body.hidden).toBe(true);
    await teamEvent(cat.main.id, "restore");
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(again.status).toBe(200);
    expect(again.body.hidden).toBe(true);
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  // With real Cloudflare the two sends would carry one single-use token, so the
  // slower usually gets 428 (timeout-or-duplicate) and the app resends and
  // gets the stored answer. This fake passes both, to prove the database
  // side: one row, and the loser answers with the winner's (review finding 8).
  it("two sends of one clientRef at the same moment make one report, and both get its answer", async () => {
    const cat = await seedCat(0);
    const ref = clientRef();
    const deviceId = freshDevice();
    // Bind the device first, so the two don't race to register it.
    await send({ deviceId, catId: cat.id, reason: "other" });
    const [a, b] = await Promise.all([
      send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId }),
      send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body).toEqual(b.body);
    expect(await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref))).toHaveLength(1);
    expect((await eventsFor(cat.main.id)).filter((e) => e.action === "hide")).toHaveLength(1);
  });

  async function uncheckedFirst() {
    const cat = await seedCat(0);
    const ref = clientRef();
    const deviceId = freshDevice();
    siteverify = timeout;
    const first = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(first.status).toBe(201);
    expect(first.body.hidden).toBe(false);
    siteverify = passAll;
    return { cat, ref, deviceId, first };
  }

  it("a resend with a good token upgrades an unchecked, undecided, never-restored report to a hide", async () => {
    const { cat, ref, deviceId, first } = await uncheckedFirst();
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ publicId: first.body.publicId, hidden: true });
    const row = await rowFor(ref);
    expect(row).toMatchObject({ tokenChecked: true, hiddenByReport: true, hideSkipped: null });
    expect(await isHidden(cat.main.id)).toBe(true);
    expect(await issueAlertsFor(row!.id)).toHaveLength(1);
  });

  it("a resend with no token, or a bad one, keeps the stored answer and writes nothing", async () => {
    const { cat, ref, deviceId } = await uncheckedFirst();
    const noToken = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId, token: null });
    expect(noToken.status).toBe(200);
    expect(noToken.body.hidden).toBe(false);
    siteverify = cf({ success: false, "error-codes": ["invalid-input-response"] });
    const badToken = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(badToken.status).toBe(200);
    expect(badToken.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: false, hideSkipped: "unchecked" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  it.each([
    ["our key is wrong", cf({ success: false, "error-codes": ["invalid-input-secret"] }), "turnstile_not_configured"],
    ["Cloudflare is unreachable again", timeout, "try_again"],
  ] as const)("an upgrade resend when %s is 503, so the app tries again (review finding 5)", async (_name, reply, error) => {
    const { cat, ref, deviceId } = await uncheckedFirst();
    siteverify = reply;
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(again.status).toBe(503);
    expect(again.body).toEqual({ error });
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: false, hideSkipped: "unchecked" });
  });

  it.each(["done", "nothing_needed"])("a report the team has decided (%s) is not upgraded", async (state) => {
    const { cat, ref, deviceId } = await uncheckedFirst();
    await db.update(welfareReportsTable).set({ state }).where(eq(welfareReportsTable.clientRef, ref));
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(again.status).toBe(200);
    expect(again.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: false, hideSkipped: "unchecked" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  it("a report whose photo the team has since restored is not upgraded", async () => {
    const { cat, ref, deviceId } = await uncheckedFirst();
    await teamEvent(cat.main.id, "hide", new Date(Date.now() - HOUR));
    await teamEvent(cat.main.id, "restore");
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(again.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: false, hideSkipped: "unchecked" });
    expect(await isHidden(cat.main.id)).toBe(false);
  });

  it("an upgrade still meets the brake", async () => {
    const { cat, ref, deviceId } = await uncheckedFirst();
    await seedReportHides(5, new Date(today));
    const again = await send({ deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(again.body.hidden).toBe(false);
    expect(await rowFor(ref)).toMatchObject({ tokenChecked: true, hideSkipped: "brake" });
  });
});

// ── Courtesy, attempts, the address limit ─────────────────────────────────

describe("the other limits in the order (plan PR 5.1 steps 3, 4 and 6)", () => {
  it("courtesy: the same device, photo and reason within 24 hours is that report", async () => {
    _setIssueClockForTests(null); // the courtesy window is the real 24 hours
    const cat = await seedCat(0);
    const deviceId = freshDevice();
    const first = await send({ deviceId, catId: cat.id, reason: "photo_not_cat", photoPublicId: cat.main.publicId });
    expect(first.status).toBe(201);
    const again = await send({ deviceId, catId: cat.id, reason: "photo_not_cat", photoPublicId: cat.main.publicId });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const other = await send({ deviceId, catId: cat.id, reason: "wrong_cat", photoPublicId: cat.main.publicId });
    expect(other.status).toBe(201);
  });

  it("attempts: the 61st call from an address in an hour is 429, before any call to Cloudflare", async () => {
    const cat = await seedCat(0);
    const ip = freshIp();
    const deviceId = freshDevice(); // one phone: the new-phone cap is 20 an hour
    siteverify = cf({ success: false, "error-codes": ["invalid-input-response"] });
    for (let i = 0; i < 60; i++) {
      expect((await send({ ip, deviceId, catId: cat.id, reason: "other", token: TOKEN })).status, `call ${i + 1}`).toBe(428);
    }
    const calls = siteverifyCalls;
    const res = await send({ ip, deviceId, catId: cat.id, reason: "other", token: TOKEN });
    expect(res.status).toBe(429);
    expect(siteverifyCalls).toBe(calls);
  });

  it("20 issue reports an hour per address: the 21st is 429 and writes nothing", async () => {
    const cat = await seedCat(0);
    const ip = freshIp();
    const deviceId = freshDevice();
    for (let i = 0; i < 20; i++) {
      expect((await send({ ip, deviceId, catId: cat.id, reason: "other" })).status, `report ${i + 1}`).toBe(201);
    }
    const ref = clientRef();
    const res = await send({ ip, deviceId, clientRef: ref, catId: cat.id, reason: "other" });
    expect(res.status).toBe(429);
    expect(await rowFor(ref)).toBeUndefined();
  });
});

// ── T5-9 ───────────────────────────────────────────────────────────────────

describe("T5-9 [spec 11]: nothing about the reporter leaves, or is kept beyond the device", () => {
  it("the reply is exactly { publicId, hidden }, and the row holds no address", async () => {
    const cat = await seedCat(0);
    const ip = "2001:db8:5144:fe00::abcd";
    const deviceId = freshDevice();
    const ref = clientRef();
    const res = await send({ ip, deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(Object.keys(res.body).sort()).toEqual(["hidden", "publicId"]);
    expect(JSON.stringify(res.body)).not.toContain(deviceId);
    const raw = await db.execute(sql`select row_to_json(w)::text as j from welfare_reports w where client_ref = ${ref}`);
    const json = (raw.rows[0] as { j: string }).j;
    expect(json).not.toContain("2001:db8:5144:fe00");
    expect(json).not.toMatch(/"ip"|"address"|remote/);
    // A repeat answer is the same shape.
    const again = await send({ ip, deviceId, clientRef: ref, catId: cat.id, reason: "photo_private", photoPublicId: cat.main.publicId });
    expect(Object.keys(again.body).sort()).toEqual(["hidden", "publicId"]);
  });
});

// ── T5-10 ──────────────────────────────────────────────────────────────────

describe("T5-10: two reports racing for the 5th brake slot: exactly one hides", () => {
  it("20 rounds", async () => {
    for (let round = 0; round < 20; round++) {
      const day = freshDay();
      _setIssueClockForTests(day);
      await seedReportHides(REPORT_HIDES_PER_ATHENS_DAY - 1, new Date(day));
      const c1 = await seedCat(0);
      const c2 = await seedCat(0);
      const [a, b] = await Promise.all([
        send({ catId: c1.id, reason: "photo_private", photoPublicId: c1.main.publicId }),
        send({ catId: c2.id, reason: "photo_inappropriate", photoPublicId: c2.main.publicId }),
      ]);
      expect([a.status, b.status], `round ${round}`).toEqual([201, 201]);
      expect([a.body.hidden, b.body.hidden].filter(Boolean), `round ${round}`).toHaveLength(1);
      const hidden = [await isHidden(c1.main.id), await isHidden(c2.main.id)];
      expect(hidden.filter(Boolean), `round ${round}`).toHaveLength(1);
    }
  });
});

// ── T5-11 ──────────────────────────────────────────────────────────────────

describe("T5-11: only this cat's photo, and only a real one", () => {
  it("a photo of another cat is 422 and writes nothing", async () => {
    const mine = await seedCat(1);
    const theirs = await seedCat(1);
    for (const target of [theirs.main, theirs.sightings[0]!]) {
      const ref = clientRef();
      const res = await send({ clientRef: ref, catId: mine.id, reason: "photo_private", photoPublicId: target.publicId });
      expect(res.status).toBe(422);
      expect(await rowFor(ref)).toBeUndefined();
      expect(await isHidden(target.id)).toBe(false);
    }
  });

  it("a photo on one of the cat's sightings that isn't resolved is 422", async () => {
    const cat = await seedCat(0);
    const p = await photo();
    await db.insert(sightingsTable).values({
      catId: cat.id,
      deviceId: `${PREFIX}spotter`,
      photoId: p.id,
      lat: ORIGIN.lat,
      lng: ORIGIN.lng,
      status: "pending",
    });
    const res = await send({ catId: cat.id, reason: "photo_private", photoPublicId: p.publicId });
    expect(res.status).toBe(422);
  });

  it("an unknown photo id, or an unknown cat, is 404", async () => {
    const cat = await seedCat(0);
    expect((await send({ catId: cat.id, reason: "photo_private", photoPublicId: `${PREFIX}no-such-photo` })).status).toBe(404);
    expect((await send({ catId: 2_000_000_000, reason: "cat_died" })).status).toBe(404);
  });

  it("a NUL character anywhere is 400, never 500, and is refused before anything is counted (review finding 4)", async () => {
    const cat = await seedCat(0);
    const calls = siteverifyCalls;
    for (const bad of [
      { clientRef: "ref-nul-\u0000-xx" },
      { photoPublicId: `${PREFIX}x\u0000` },
      { note: "a\u0000b" },
    ]) {
      const res = await request(app)
        .post("/api/issues")
        .set("X-Device-Secret", SECRET)
        .set("X-Forwarded-For", freshIp())
        .send({ deviceId: freshDevice(), clientRef: clientRef(), reason: "photo_private", catId: cat.id, photoPublicId: cat.main.publicId, language: "en", turnstileToken: TOKEN, ...bad });
      expect(res.status, JSON.stringify(Object.keys(bad))).toBe(400);
    }
    expect(siteverifyCalls).toBe(calls);
  });

  it("a photo reason needs a photo, and a cat reason refuses one (400)", async () => {
    const cat = await seedCat(0);
    expect((await send({ catId: cat.id, reason: "photo_private" })).status).toBe(400);
    expect((await send({ catId: cat.id, reason: "cat_died", photoPublicId: cat.main.publicId })).status).toBe(400);
    expect((await send({ catId: cat.id, reason: "not_a_reason" })).status).toBe(400);
    expect((await send({ catId: 2 ** 31, reason: "cat_died" })).status).toBe(400);
  });
});

// ── T5-12 ──────────────────────────────────────────────────────────────────

describe("T5-12 [spec 20]: this PR builds no photo address by hand (P6-0 covers the rest)", () => {
  it("routes/issues.ts and lib/issues/hide.ts never write /api/photos/", () => {
    const src = fileURLToPath(new URL("..", import.meta.url));
    for (const f of ["routes/issues.ts", "lib/issues/hide.ts"]) {
      expect(readFileSync(join(src, f), "utf8"), f).not.toContain("/api/photos/");
    }
  });
});
