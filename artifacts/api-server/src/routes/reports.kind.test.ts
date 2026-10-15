import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import {
  db,
  pool,
  deviceCredentialsTable,
  mailOutboxTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";
import app from "../app";

// SYC-44 PR 4.1 (plan Slice 4): the public report routes and "Report an
// issue" rows. T4-6 (spec test 10) and T4-8.
//
// WHY THE OLD KEY IS DROPPED HERE. PR 4.1 adds the key
// (reporter_device, kind, client_ref) BESIDE the old (reporter_device,
// client_ref), because the live code names the old one until 4.1 is
// published; PR 4.2 drops it. While both exist, a welfare row and a content
// row with the same device and reference cannot coexist (the old key refuses
// the pair), which is also why no content row can exist before 4.2. T4-6 is
// about the key that survives, so this file drops the old one for its own run
// (simulating 4.2) and puts it back afterwards. PR 4.2 deletes that step.

const DEVICE = `vitest-kind-${randomBytes(4).toString("hex")}`;
const SECRET = "vitest-kind-secret-aaaaaaaa";
const LAT = 37.4441234;
const LNG = 24.9412345;
const OLD_KEY = "welfare_reports_device_client_ref_key";

let ipCounter = 0;
const freshIp = () => `198.18.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const clientRef = () => `ref-${randomBytes(8).toString("hex")}`;

const submit = (body: Partial<Record<string, unknown>> = {}) =>
  request(app)
    .post("/api/reports")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", freshIp())
    .send({
      deviceId: DEVICE,
      clientRef: clientRef(),
      severity: "urgent",
      isLitter: false,
      lat: LAT,
      lng: LNG,
      language: "en",
      hasPhoto: false,
      ...body,
    });

const draft = (body: Partial<Record<string, unknown>> = {}) =>
  request(app)
    .post("/api/reports/draft")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", freshIp())
    .send({ deviceId: DEVICE, clientRef: clientRef(), severity: "attention", lat: LAT, lng: LNG, language: "en", ...body });

/** A "Report an issue" row, written straight to the table (the route arrives in Slice 5). */
async function contentRow(ref: string, device: string | null = DEVICE) {
  const [row] = await db
    .insert(welfareReportsTable)
    .values({
      publicId: `c-${randomBytes(10).toString("hex")}`,
      kind: "content",
      reason: "other",
      severity: "attention",
      lat: null,
      lng: null,
      reporterDevice: device,
      clientRef: ref,
      photoState: "none",
      submittedAt: new Date(),
    })
    .returning();
  return row!;
}

const rowsFor = (ref: string) =>
  db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref)).orderBy(welfareReportsTable.id);

async function cleanup() {
  await db.execute(
    sql`delete from mail_outbox where report_id in (select id from welfare_reports where reporter_device like ${DEVICE + "%"})`,
  );
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${DEVICE}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
}

async function tinyJpeg(): Promise<string> {
  const buf = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#369" } }).jpeg().toBuffer();
  return buf.toString("base64");
}

beforeAll(async () => {
  await cleanup();
  await db.execute(sql.raw(`drop index if exists ${OLD_KEY}`));
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await db.execute(
    sql.raw(`create unique index if not exists ${OLD_KEY} on welfare_reports using btree (reporter_device, client_ref)`),
  );
  await pool.end();
});

describe("T4-6 (spec test 10): the same device and reference, two kinds, two reports", () => {
  it("a welfare report is sent although a content row has the same device and clientRef; the content row is left alone", async () => {
    const ref = clientRef();
    const content = await contentRow(ref);

    const res = await submit({ clientRef: ref });
    expect(res.status).toBe(201);
    expect(res.body.publicId).not.toBe(content.publicId);

    const rows = await rowsFor(ref);
    expect(rows.map((r) => r.kind).sort()).toEqual(["content", "welfare"]);
    const welfare = rows.find((r) => r.kind === "welfare")!;
    expect(welfare.publicId).toBe(res.body.publicId);
    expect(welfare.isDraft).toBe(false);
    expect(welfare.lat).toBe(LAT);
    // The content row is exactly as it was.
    expect(rows.find((r) => r.kind === "content")).toEqual(content);
    // Only the welfare report queued an alert.
    const mail = await db.select().from(mailOutboxTable).where(sql`report_id in (${welfare.id}, ${content.id})`);
    expect(mail.map((m) => [m.reportId, m.purpose])).toEqual([[welfare.id, "welfare_alert"]]);
  });

  it("a resend of that welfare report is still recognised as already sent, and answers with the welfare report, never the content row", async () => {
    const ref = clientRef();
    const content = await contentRow(ref);
    const first = await submit({ clientRef: ref });
    const again = await submit({ clientRef: ref });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.publicId).toBe(first.body.publicId);
    expect(again.body.publicId).not.toBe(content.publicId);
    expect(await rowsFor(ref)).toHaveLength(2);
  });

  it("a content row never blocks a welfare report that arrives before it either: both orders give two reports", async () => {
    const ref = clientRef();
    const first = await submit({ clientRef: ref });
    expect(first.status).toBe(201);
    await contentRow(ref);
    expect((await rowsFor(ref)).map((r) => r.kind).sort()).toEqual(["content", "welfare"]);
    // And a resend of the welfare report still finds only itself.
    const again = await submit({ clientRef: ref });
    expect(again.status).toBe(200);
    expect(again.body.publicId).toBe(first.body.publicId);
  });

  it("a draft with that clientRef is a welfare draft of its own, and then becomes the report; the content row is left alone", async () => {
    const ref = clientRef();
    const content = await contentRow(ref);
    expect((await draft({ clientRef: ref })).status).toBe(204);
    let rows = await rowsFor(ref);
    expect(rows.map((r) => [r.kind, r.isDraft]).sort()).toEqual([
      ["content", false],
      ["welfare", true],
    ]);
    const sent = await submit({ clientRef: ref, severity: "attention" });
    expect(sent.status).toBe(201);
    rows = await rowsFor(ref);
    expect(rows).toHaveLength(2);
    const welfare = rows.find((r) => r.kind === "welfare")!;
    expect([welfare.isDraft, welfare.publicId]).toEqual([false, sent.body.publicId]);
    expect(rows.find((r) => r.kind === "content")).toEqual(content);
  });

  it("a draft call for a ref whose content row exists is not swallowed as 'already sent'", async () => {
    const ref = clientRef();
    await contentRow(ref);
    expect((await draft({ clientRef: ref })).status).toBe(204);
    const welfareDrafts = (await rowsFor(ref)).filter((r) => r.kind === "welfare");
    expect(welfareDrafts).toHaveLength(1);
    expect(welfareDrafts[0]!.isDraft).toBe(true);
  });
});

describe("T4-8: a photo can't be aimed at a 'Report an issue' row", () => {
  it("PUT /reports/:publicId/photo on the reporter's own content row is 404, writes nothing, and leaves the row unchanged", async () => {
    // Registers the device's secret on first use.
    expect((await submit()).status).toBe(201);
    const content = await contentRow(clientRef());

    const res = await request(app)
      .put(`/api/reports/${content.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: await tinyJpeg() });
    expect(res.status).toBe(404);

    const [after] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.id, content.id));
    expect(after).toEqual(content);
    expect(after!.photoState).toBe("none");
    const photos = await db
      .select({ id: welfareReportPhotosTable.id })
      .from(welfareReportPhotosTable)
      .where(eq(welfareReportPhotosTable.reportId, content.id));
    expect(photos).toHaveLength(0);
  });

  it("the same call on the reporter's own welfare report still attaches the photo", async () => {
    const sent = await submit({ hasPhoto: true });
    expect(sent.status).toBe(201);
    const res = await request(app)
      .put(`/api/reports/${sent.body.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: await tinyJpeg() });
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ photoState: welfareReportsTable.photoState })
      .from(welfareReportsTable)
      .where(and(eq(welfareReportsTable.publicId, sent.body.publicId), eq(welfareReportsTable.kind, "welfare")));
    expect(row!.photoState).toBe("attached");
  });
});
