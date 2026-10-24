import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import {
  catsTable,
  db,
  pool,
  deviceCredentialsTable,
  mailOutboxTable,
  photosTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";

// SYC-42 plan, Slice 1 items 1.2–1.5 and 1.7. Plan tests 7–13 and 17–19
// (spec §8.6 #8, #12 public half, #13).

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

// Test 19 captures every log line, using the production redaction settings.
vi.mock("../lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  const logger = pino(
    { level: "trace", redact: actual.REDACT_PATHS, serializers: actual.LOG_SERIALIZERS },
    { write: (line: string) => void spies.logLines.push(line) },
  );
  return { ...actual, logger };
});

import app from "../app";
import * as proximity from "../lib/feedingSiteProximity";
import { deleteTestFeedingSites, northOf, seedFeedingSite } from "../test/feedingSites";
import { drainDue, settleOutbox } from "../lib/mail/outbox";

const DEVICE = `vitest-report-${randomBytes(4).toString("hex")}`;
const OTHER_DEVICE = `${DEVICE}-other`;
const SECRET = "vitest-report-secret-aaaaaaaa";
const OTHER_SECRET = "vitest-report-secret-bbbbbbbb";
const NOTE = "Limping badly near the bakery on Miaouli square";
const LAT = 37.4441234;
const LNG = 24.9412345;

type Sent = { body: Record<string, unknown>; idempotencyKey: string | null };
let sent: Sent[] = [];
let failMail = false;

function installFakeResend() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (failMail) throw new Error("network down");
      const headers = new Headers(init?.headers);
      sent.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        idempotencyKey: headers.get("Idempotency-Key"),
      });
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
    }),
  );
}

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function clientRef() {
  return `ref-${randomBytes(8).toString("hex")}`;
}

function submit(
  body: Partial<Record<string, unknown>> = {},
  opts: { secret?: string; ip?: string } = {},
) {
  return request(app)
    .post("/api/reports")
    .set("X-Device-Secret", opts.secret ?? SECRET)
    .set("X-Forwarded-For", opts.ip ?? freshIp())
    .send({
      deviceId: DEVICE,
      clientRef: clientRef(),
      severity: "urgent",
      isLitter: false,
      lat: LAT,
      lng: LNG,
      note: NOTE,
      language: "en",
      hasPhoto: true,
      ...body,
    });
}

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: "#a33" } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Copyright: "vitest" },
        GPS: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 26/1 24/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "24/1 56/1 0/1",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    .toBuffer();
}

async function reportRow(publicId: string) {
  const [row] = await db
    .select()
    .from(welfareReportsTable)
    .where(eq(welfareReportsTable.publicId, publicId));
  return row!;
}

async function outboxFor(reportId: number) {
  return db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, reportId));
}

/** Send everything that's due (other tests leave due rows behind). */
async function drainAll() {
  for (let i = 0; i < 50; i++) {
    if ((await drainDue(50)).claimed === 0) return;
  }
}

/** Pretend the 10-minute photo wait has passed for every queued alert. */
async function makeAllDue() {
  await db.execute(
    sql`update mail_outbox set next_attempt_at = now() - interval '1 second' where state = 'queued'`,
  );
}

/** A cat the report can name (SYC-504). Cleaned up with the rest. */
async function seedCat(): Promise<number> {
  const k = randomBytes(4).toString("hex");
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${DEVICE}-photo-${k}`, data: "ZmFrZQ==", mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${DEVICE}-cat-${k}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${DEVICE}-spotter`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

function draft(body: Partial<Record<string, unknown>> & { clientRef: string }) {
  return request(app)
    .post("/api/reports/draft")
    .set("X-Device-Secret", SECRET)
    .send({ deviceId: DEVICE, severity: "attention", lat: LAT, lng: LNG, language: "en", ...body });
}

async function cleanup() {
  await deleteTestFeedingSites();
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${DEVICE + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${DEVICE}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${DEVICE}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${DEVICE}%`));
}

const saved = { ...process.env };
beforeAll(cleanup);
beforeEach(() => {
  sent = [];
  failMail = false;
  spies.logLines.length = 0;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  process.env["WELFARE_ALERT_TO"] = "alerts@example.org";
  installFakeResend();
});
afterEach(async () => {
  await deleteTestFeedingSites();
  await settleOutbox();
  vi.unstubAllGlobals();
  process.env = { ...saved };
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /api/reports", () => {
  it("writes the report and queues one alert in the same transaction, then replies 201 { publicId }", async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    expect(res.body.publicId).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const row = await reportRow(res.body.publicId);
    expect(row.isDraft).toBe(false);
    expect(row.severity).toBe("urgent");
    expect(row.note).toBe(NOTE);
    expect(row.reporterDevice).toBe(DEVICE);
    expect(row.photoState).toBe("pending");
    const outbox = await outboxFor(row.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.purpose).toBe("welfare_alert");
    expect(JSON.stringify(outbox[0]!.payload)).not.toContain("alerts@example.org");
    // SYC-179: the keyed fingerprint, never an unkeyed hash.
    expect(outbox[0]!.recipientHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("test 7 [§8.6 #8]: a report submitted while every mail path fails still writes the row", async () => {
    failMail = true;
    const res = await submit({ hasPhoto: false });
    expect(res.status).toBe(201);
    await settleOutbox();
    const row = await reportRow(res.body.publicId);
    expect(row).toBeTruthy();
    const [alert] = await outboxFor(row.id);
    expect(alert!.state).toBe("queued");
    expect(alert!.attempts).toBeGreaterThanOrEqual(1);
    expect(alert!.lastError).toBeTruthy();
  });

  it("test 7: with no mail key at all, the row is still written", async () => {
    delete process.env["RESEND_API_KEY"];
    const res = await submit({ hasPhoto: false });
    expect(res.status).toBe(201);
    await settleOutbox();
    const row = await reportRow(res.body.publicId);
    expect(row).toBeTruthy();
    expect(sent).toHaveLength(0);
    // S2 (review of #55): a configuration gap keeps the alert queued (so the
    // overdue check still sees it and the drain fails loudly), never failed.
    const [alert] = await outboxFor(row.id);
    expect(alert!.state).toBe("queued");
    expect(alert!.lastError).toContain("not_configured");
  });

  it("S2: with no WELFARE_ALERT_TO, the alert stays queued (bad_recipient), never failed", async () => {
    delete process.env["WELFARE_ALERT_TO"];
    const res = await submit({ hasPhoto: false });
    expect(res.status).toBe(201);
    await settleOutbox();
    const row = await reportRow(res.body.publicId);
    const [alert] = await outboxFor(row.id);
    expect(alert!.state).toBe("queued");
    expect(alert!.lastError).toContain("bad_recipient");
    expect(sent).toHaveLength(0);
  });

  it("test 13: sending the same clientRef twice makes one report and one alert", async () => {
    const ref = clientRef();
    const a = await submit({ clientRef: ref });
    const b = await submit({ clientRef: ref });
    expect(a.status).toBe(201);
    expect([200, 201]).toContain(b.status);
    expect(b.body.publicId).toBe(a.body.publicId);
    const rows = await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.clientRef, ref));
    expect(rows).toHaveLength(1);
    expect(await outboxFor(rows[0]!.id)).toHaveLength(1);
  });

  it("test 13: two simultaneous submits of the same clientRef still make one report", async () => {
    const ref = clientRef();
    const [a, b] = await Promise.all([submit({ clientRef: ref }), submit({ clientRef: ref })]);
    expect(a.body.publicId).toBe(b.body.publicId);
    const rows = await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.clientRef, ref));
    expect(rows).toHaveLength(1);
    expect(await outboxFor(rows[0]!.id)).toHaveLength(1);
  });

  it("refuses without the device secret (a courtesy check, spec §4.4)", async () => {
    const res = await request(app)
      .post("/api/reports")
      .set("X-Forwarded-For", freshIp())
      .send({ deviceId: DEVICE, clientRef: clientRef(), severity: "urgent", lat: LAT, lng: LNG, language: "en", hasPhoto: false });
    expect(res.status).toBe(401);
  });

  it("refuses a severity outside the two choices, and impossible coordinates", async () => {
    expect((await submit({ severity: "dying" })).status).toBe(400);
    expect((await submit({ lat: 91 })).status).toBe(400);
  });

  it("test 18 [§2.6]: 429 after 10 an hour from one address; every accepted report is written", async () => {
    const ip = "198.51.100.77";
    const accepted: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await submit({ hasPhoto: false }, { ip });
      expect(res.status).toBe(201);
      accepted.push(res.body.publicId);
    }
    const eleventh = await submit({ hasPhoto: false }, { ip });
    expect(eleventh.status).toBe(429);
    for (const id of accepted) expect(await reportRow(id)).toBeTruthy();
  });
});

describe("POST /api/reports/draft (spec §4.2)", () => {
  it("writes a draft once severity and location are set, and sends nothing", async () => {
    const ref = clientRef();
    const res = await request(app)
      .post("/api/reports/draft")
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, clientRef: ref, severity: "attention", lat: LAT, lng: LNG, language: "fr" });
    expect(res.status).toBe(204);
    const [row] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
    expect(row!.isDraft).toBe(true);
    expect(row!.severity).toBe("attention");
    expect(await outboxFor(row!.id)).toHaveLength(0);
  });

  it("the draft becomes the report when it's sent, keeping one row", async () => {
    const ref = clientRef();
    await request(app)
      .post("/api/reports/draft")
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, clientRef: ref, severity: "attention", lat: LAT, lng: LNG, language: "en" });
    const res = await submit({ clientRef: ref, severity: "urgent" });
    expect(res.status).toBe(201);
    const rows = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isDraft).toBe(false);
    expect(rows[0]!.severity).toBe("urgent");
  });

  it("a late draft call never turns a sent report back into a draft", async () => {
    const ref = clientRef();
    const res = await submit({ clientRef: ref });
    await request(app)
      .post("/api/reports/draft")
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, clientRef: ref, severity: "attention", lat: 1, lng: 1, language: "en" });
    const row = await reportRow(res.body.publicId);
    expect(row.isDraft).toBe(false);
    expect(row.severity).toBe("urgent");
    expect(row.lat).toBe(LAT);
  });
});

describe("SYC-504: the cat the report was sent from", () => {
  it("a known catId sets reporter_cat_id and leaves cat_id null", async () => {
    const cat = await seedCat();
    const res = await submit({ catId: cat });
    expect(res.status).toBe(201);
    const row = await reportRow(res.body.publicId);
    expect(row.reporterCatId).toBe(cat);
    expect(row.catId).toBeNull();
  });

  it("an unknown or garbage catId gives null and a 201", async () => {
    // Not coerced: a real cat's id as a string, or `true`, is not a number.
    const cat = await seedCat();
    for (const catId of [999_999_998, 0, -4, 1.5, "abc", {}, [], 1_000_000_000, true, String(cat)]) {
      const res = await submit({ catId });
      expect(res.status, JSON.stringify(catId)).toBe(201);
      const row = await reportRow(res.body.publicId);
      expect(row.reporterCatId, JSON.stringify(catId)).toBeNull();
      expect(row.catId).toBeNull();
    }
  });

  it("no catId, or null, gives null", async () => {
    const a = await submit();
    expect((await reportRow(a.body.publicId)).reporterCatId).toBeNull();
    const b = await submit({ catId: null });
    expect((await reportRow(b.body.publicId)).reporterCatId).toBeNull();
  });

  it("a draft with a cat, then a submit with catId null, ends null", async () => {
    const cat = await seedCat();
    const ref = clientRef();
    expect((await draft({ clientRef: ref, catId: cat })).status).toBe(204);
    const [d] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
    expect(d!.reporterCatId).toBe(cat);
    const res = await submit({ clientRef: ref, catId: null });
    expect(res.status).toBe(201);
    const row = await reportRow(res.body.publicId);
    expect(row.reporterCatId).toBeNull();
    expect(row.catId).toBeNull();
  });

  it("a draft with a cat, then a submit with the same cat, keeps it", async () => {
    const cat = await seedCat();
    const ref = clientRef();
    await draft({ clientRef: ref, catId: cat });
    const res = await submit({ clientRef: ref, catId: cat });
    expect((await reportRow(res.body.publicId)).reporterCatId).toBe(cat);
  });

  it("the draft route stores and clears the suggestion the same way", async () => {
    const cat = await seedCat();
    const ref = clientRef();
    const get = async () =>
      (await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref)))[0]!;
    await draft({ clientRef: ref, catId: cat });
    expect((await get()).reporterCatId).toBe(cat);
    await draft({ clientRef: ref, catId: null });
    expect((await get()).reporterCatId).toBeNull();
    await draft({ clientRef: ref, catId: cat });
    expect((await get()).reporterCatId).toBe(cat);
    await draft({ clientRef: ref, catId: 999_999_998 });
    const row = await get();
    expect(row.reporterCatId).toBeNull();
    expect(row.catId).toBeNull();
  });

  it("a resend of a sent report changes nothing, and a late draft cannot change the cat", async () => {
    const cat = await seedCat();
    const other = await seedCat();
    const ref = clientRef();
    const first = await submit({ clientRef: ref, catId: cat });
    const again = await submit({ clientRef: ref, catId: other });
    expect(again.status).toBe(200);
    expect(again.body.publicId).toBe(first.body.publicId);
    expect((await reportRow(first.body.publicId)).reporterCatId).toBe(cat);
    expect((await draft({ clientRef: ref, catId: other })).status).toBe(204);
    expect((await reportRow(first.body.publicId)).reporterCatId).toBe(cat);
  });

  it("a draft names the cat but never sets cat_id", async () => {
    const cat = await seedCat();
    const ref = clientRef();
    await draft({ clientRef: ref, catId: cat });
    const [d] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
    expect(d!.catId).toBeNull();
  });
});

describe("PUT /api/reports/:publicId/photo", () => {
  it("test 10 [§8.6 #13]: strips GPS — a JPEG uploaded with a GPS block is stored with none", async () => {
    const tagged = await jpegWithGps();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const { body } = await submit();
    const res = await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: tagged.toString("base64") });
    expect(res.status).toBe(200);
    const row = await reportRow(body.publicId);
    expect(row.photoState).toBe("attached");
    const [photo] = await db
      .select()
      .from(welfareReportPhotosTable)
      .where(eq(welfareReportPhotosTable.reportId, row.id));
    expect(photo).toBeTruthy();
    expect((await sharp(photo!.bytes).metadata()).exif).toBeUndefined();
  });

  it("refuses a photo that isn't an image", async () => {
    const { body } = await submit();
    const res = await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: Buffer.from("not an image at all").toString("base64") });
    expect(res.status).toBe(400);
  });

  it("nit (review of #55): a refused photo marks the report's photo failed and sends the alert now, saying so", async () => {
    const { body } = await submit({ hasPhoto: true });
    const res = await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: Buffer.from("not an image at all").toString("base64") });
    expect(res.status).toBe(400);
    const row = await reportRow(body.publicId);
    expect(row.photoState).toBe("failed");
    // No ten-minute wait for a photo that can't come.
    await settleOutbox();
    await drainAll();
    const mine = sent.filter((s) => String(s.body["text"]).includes(body.publicId));
    expect(mine).toHaveLength(1);
    expect(String(mine[0]!.body["text"])).not.toContain("still uploading");
    expect(String(mine[0]!.body["text"])).toContain("The photo couldn't be received");
  });

  it("test 17: refuses a different device's secret, and a different device", async () => {
    const { body } = await submit();
    const jpeg = (await jpegWithGps()).toString("base64");
    const wrongSecret = await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", OTHER_SECRET)
      .send({ deviceId: DEVICE, photoBase64: jpeg });
    expect(wrongSecret.status).toBe(403);
    const otherDevice = await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", OTHER_SECRET)
      .send({ deviceId: OTHER_DEVICE, photoBase64: jpeg });
    expect(otherDevice.status).toBe(404);
    expect((await reportRow(body.publicId)).photoState).toBe("pending");
  });

  it("test 9 [§8.6 #12, public half]: the public photo route serves no report photo, by numeric or public id", async () => {
    const countPublic = async () =>
      Number(
        (await db.select({ n: sql<number>`count(*)` }).from(photosTable))[0]!.n,
      );
    const publicBefore = await countPublic();
    const { body } = await submit();
    await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: (await jpegWithGps()).toString("base64") });
    // Nothing was copied into the public table.
    expect(await countPublic()).toBe(publicBefore);
    const row = await reportRow(body.publicId);
    const [photo] = await db
      .select()
      .from(welfareReportPhotosTable)
      .where(eq(welfareReportPhotosTable.reportId, row.id));
    // A public photo may happen to share the report photo's numeric id (the
    // two tables number independently); what must never come back is the
    // report photo's bytes.
    for (const id of [String(photo!.id), photo!.publicId, body.publicId]) {
      const res = await request(app)
        .get(`/api/photos/${id}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      if (id !== String(photo!.id)) expect(res.status, `GET /api/photos/${id}`).not.toBe(200);
      expect(Buffer.isBuffer(res.body) && res.body.equals(photo!.bytes)).toBe(false);
    }
  });
});

describe("the alert email (item 1.5)", () => {
  it("test 8: with no photo yet, the alert waits about 10 minutes, then goes saying the photo is still uploading", async () => {
    const { body } = await submit({ hasPhoto: true });
    const row = await reportRow(body.publicId);
    const [alert] = await outboxFor(row.id);
    const waitMs = alert!.nextAttemptAt.getTime() - row.submittedAt!.getTime();
    expect(waitMs).toBeGreaterThanOrEqual(9.5 * 60_000);
    expect(waitMs).toBeLessThanOrEqual(10.5 * 60_000);
    await drainAll();
    expect(sent.filter((m) => String(m.body["text"]).includes(body.publicId))).toHaveLength(0);
    await makeAllDue();
    await drainAll();
    const mine = sent.filter((s) => String(s.body["text"]).includes(body.publicId));
    expect(mine).toHaveLength(1);
    expect(String(mine[0]!.body["text"])).toContain("The photo is still uploading.");
    expect(mine[0]!.body["attachments"]).toBeUndefined();
  });

  it("test 8: when the photo arrives after the alert went, a short follow-up carries it", async () => {
    const { body } = await submit({ hasPhoto: true, severity: "attention" });
    await makeAllDue();
    await drainAll();
    await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: (await jpegWithGps()).toString("base64") });
    await settleOutbox();
    await drainAll();
    const mine = sent.filter((s) => String(s.body["text"]).includes(body.publicId));
    expect(mine).toHaveLength(2);
    expect(mine[1]!.body["subject"]).toBe("Cat report: needs attention (photo)");
    expect((mine[1]!.body["attachments"] as unknown[]).length).toBe(1);
  });

  it("when the photo arrives in time, the alert goes at once with it attached", async () => {
    const { body } = await submit({ hasPhoto: true });
    await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: (await jpegWithGps()).toString("base64") });
    await settleOutbox();
    const mine = sent.filter((s) => String(s.body["text"]).includes(body.publicId));
    expect(mine).toHaveLength(1);
    expect(String(mine[0]!.body["text"])).toContain("Photo: attached");
    // Nit (review of #55): the key names the report as well as the outbox
    // row, so a reset table's reused row ids can never collide inside
    // Resend's 24-hour window.
    expect(mine[0]!.idempotencyKey).toMatch(new RegExp(`^welfare-${body.publicId}-\\d+-photo$`));
  });

  it("test 11 [§4.3]: the photo is an attachment, there's no link into any photo route, and no reporter contact", async () => {
    const { body } = await submit({ hasPhoto: true });
    await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: (await jpegWithGps()).toString("base64") });
    await settleOutbox();
    const mail = sent.find((s) => String(s.body["text"]).includes(body.publicId))!;
    const attachments = mail.body["attachments"] as { filename: string; content: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toMatch(/\.jpg$/);
    const everything = `${mail.body["text"]}\n${mail.body["html"]}`;
    expect(everything).not.toMatch(/\/api\/photos|report-photos|\/photo\b/);
    const links = everything.match(/https?:\/\/[^\s"<]+/g) ?? [];
    for (const link of links) expect(link).toMatch(/^https:\/\/(www\.google\.com\/maps|maps\.apple\.com)\//);
    expect(everything).not.toContain(DEVICE);
    expect(everything).toContain("No contact details were left.");
    expect(mail.body["to"]).toEqual(["alerts@example.org"]);
    expect(mail.body["from"]).toBe("Syros Cats via Cat Spotters <reports@mail.catspotters.com>");
  });

  it("the alert carries severity, the note (escaped), the exact place and both map links", async () => {
    const { body } = await submit({ hasPhoto: false, note: "<b>bleeding</b> & hiding" });
    await settleOutbox();
    const mail = sent.find((s) => String(s.body["text"]).includes(body.publicId))!;
    const text = String(mail.body["text"]);
    const html = String(mail.body["html"]);
    expect(text).toContain("<b>bleeding</b> & hiding");
    expect(html).toContain("&lt;b&gt;bleeding&lt;/b&gt; &amp; hiding");
    expect(html).not.toContain("<b>bleeding</b>");
    expect(text).toContain(`${LAT}, ${LNG}`);
    expect(text).toContain(`https://www.google.com/maps/search/?api=1&query=${LAT},${LNG}`);
    expect(text).toContain(`https://maps.apple.com/?ll=${LAT},${LNG}`);
    expect(text).toContain("No photo was taken.");
  });

  describe("SYC-245 (SYC-209 Decision 2B): map links near a feeding site", () => {
    const everything = (id: string) => {
      const mail = sent.find((s) => String(s.body["text"]).includes(id))!;
      return `${mail.body["text"]}\n${mail.body["html"]}`;
    };

    it("30 m from a feeding site: no map link, no words about a feeding site, still the exact place", async () => {
      await seedFeedingSite(northOf(LAT, 30), LNG);
      const { body } = await submit({ hasPhoto: false });
      await settleOutbox();
      const all = everything(body.publicId);
      expect(all).toContain(`${LAT}, ${LNG}`);
      expect(all).not.toContain("google.com/maps");
      expect(all).not.toContain("maps.apple.com");
      expect(all).not.toMatch(/feeding|site\b/i);
      expect(all).not.toContain("Open in Google Maps");
    });

    it("80 m from a feeding site: both links stay", async () => {
      await seedFeedingSite(northOf(LAT, 80), LNG);
      const { body } = await submit({ hasPhoto: false });
      await settleOutbox();
      const all = everything(body.publicId);
      expect(all).toContain(`https://www.google.com/maps/search/?api=1&query=${LAT},${LNG}`);
      expect(all).toContain(`https://maps.apple.com/?ll=${LAT},${LNG}`);
    });

    it("if the distance check hangs, the alert still sends after about 2 s, without map links", async () => {
      const spy = vi
        .spyOn(proximity, "isNearFeedingSite")
        .mockImplementation(() => new Promise<boolean>(() => {}));
      try {
        const { body } = await submit({ hasPhoto: false });
        await settleOutbox();
        const all = everything(body.publicId);
        expect(all).toContain(`${LAT}, ${LNG}`);
        expect(all).not.toContain("google.com/maps");
        expect(all).not.toContain("maps.apple.com");
        const [alert] = await outboxFor((await reportRow(body.publicId)).id);
        expect(alert!.state).toBe("sent");
      } finally {
        spy.mockRestore();
      }
    }, 10_000);

    it("a retry reuses the first attempt's decision: no links, even though the check now works", async () => {
      // Attempt 1: the check fails and the send fails (response lost).
      const spy = vi
        .spyOn(proximity, "isNearFeedingSite")
        .mockRejectedValue(new Error("db down"));
      failMail = true;
      let body: { publicId: string };
      try {
        ({ body } = await submit({ hasPhoto: false }));
        await settleOutbox();
      } finally {
        spy.mockRestore();
      }
      const row = await reportRow(body.publicId);
      const [queued] = await outboxFor(row.id);
      expect(queued!.state).toBe("queued");
      expect((queued!.payload as { withMapLinks?: boolean }).withMapLinks).toBe(false);
      // Attempt 2: the check would now say "far from any site" (links yes).
      failMail = false;
      const check = vi.spyOn(proximity, "isNearFeedingSite").mockResolvedValue(false);
      try {
        await makeAllDue();
        await drainAll();
      } finally {
        check.mockRestore();
      }
      const all = everything(body.publicId);
      expect(all).not.toContain("google.com/maps");
      expect(all).not.toContain("maps.apple.com");
      expect(check).not.toHaveBeenCalled();
    });

    it("if the distance check throws, the alert still sends, without map links", async () => {
      const spy = vi
        .spyOn(proximity, "isNearFeedingSite")
        .mockRejectedValue(new Error("db down"));
      try {
        const { body } = await submit({ hasPhoto: false });
        await settleOutbox();
        const all = everything(body.publicId);
        expect(all).toContain(`${LAT}, ${LNG}`);
        expect(all).not.toContain("google.com/maps");
        expect(all).not.toContain("maps.apple.com");
        expect(all).not.toMatch(/feeding/i);
        const [alert] = await outboxFor((await reportRow(body.publicId)).id);
        expect(alert!.state).toBe("sent");
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("test 12: urgent and attention have different subjects; kittens add ' · kittens'", async () => {
    const u = await submit({ hasPhoto: false, severity: "urgent" });
    const a = await submit({ hasPhoto: false, severity: "attention" });
    const k = await submit({ hasPhoto: false, severity: "attention", isLitter: true });
    await settleOutbox();
    const subject = (id: string) =>
      sent.find((s) => String(s.body["text"]).includes(id))!.body["subject"];
    expect(subject(u.body.publicId)).toBe("Urgent cat report: badly hurt or in danger");
    expect(subject(a.body.publicId)).toBe("Cat report: needs attention");
    expect(subject(k.body.publicId)).toBe("Cat report: needs attention · kittens");
  });
});

describe("test 19: logs", () => {
  it("logs for /api/reports* contain no note, coordinates or device id", async () => {
    const { body } = await submit({ hasPhoto: true });
    await request(app)
      .put(`/api/reports/${body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: (await jpegWithGps()).toString("base64") });
    await request(app)
      .post("/api/reports/draft")
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, clientRef: clientRef(), severity: "urgent", lat: LAT, lng: LNG, language: "en" });
    await settleOutbox();
    const log = spies.logLines.join("\n");
    expect(log).toContain("/api/reports");
    expect(log).not.toContain("Limping badly");
    expect(log).not.toContain(String(LAT));
    expect(log).not.toContain("37.444");
    expect(log).not.toContain(DEVICE);
    expect(log).not.toContain("alerts@example.org");
    expect(log).not.toContain(SECRET);
  });

  it("S1 (review of #55): a database error on a report route logs no note, coordinates or device id", async () => {
    // The insert fails, and the driver's error message carries the whole
    // query and its params. (A NUL byte used to cause this; SYC-406 now
    // refuses those with a 400 before the route, so the failure is forced.)
    spies.logLines.length = 0;
    const spy = vi
      .spyOn(db, "transaction")
      .mockRejectedValue(
        new Error(
          `Failed query: insert into "welfare_reports" ...\nparams: Bleeding by the bakery door,${LAT},${LNG},${DEVICE}`,
        ),
      );
    let res;
    try {
      res = await submit({ hasPhoto: false, note: "Bleeding by the bakery door" });
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(500);
    const log = spies.logLines.join("\n");
    expect(log).toContain("Unhandled route error");
    expect(log).not.toContain("Bleeding by the bakery");
    expect(log).not.toContain(String(LAT));
    expect(log).not.toContain(String(LNG));
    expect(log).not.toContain(DEVICE);
    expect(log).not.toMatch(/Failed query|params:/);
  });
});
