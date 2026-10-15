/**
 * SYC-42 Slice 3: the reporter's email, end to end through the real routes.
 * Plan tests 31 (F7b), 33 (one outcome), 35 (suppressed and limited
 * addresses still file the report), 36 (bounce webhook and its signature),
 * plus the confirm/forget/delete links, "Delete my data" (SYC-63) and the
 * 7-day sweep.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHmac, randomBytes } from "node:crypto";
import {
  addPerson,
  db,
  emailContactsTable,
  emailSuppressionsTable,
  mailDeliveriesTable,
  mailOutboxTable,
  pool,
  reportStateEventsTable,
  welfareReportsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));
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
import { drainDue, settleOutbox } from "../lib/mail/outbox";
import { addressFingerprint } from "../lib/mail/fingerprint";
import { moveReportState, type ReportState } from "../lib/welfareActions";
import { severPerson } from "../lib/severPerson";
import { sweepKeepSafe } from "../lib/keepSafe/sweep";
import { publicAppOrigin } from "../lib/keepSafe/links";
import { clearWelfareTables } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

type Sent = { to: string; from: string; subject: string; text: string; replyTo: string | null; id: string };
let sent: Sent[] = [];

function installFakeResend() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).endsWith("/emails")) throw new Error(`unexpected fetch ${String(url)}`);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const id = `re_rep_${randomBytes(6).toString("hex")}`;
      sent.push({
        to: (body["to"] as string[])[0]!,
        from: String(body["from"]),
        subject: String(body["subject"]),
        text: String(body["text"]),
        replyTo: (body["reply_to"] as string | undefined) ?? null,
        id,
      });
      return new Response(JSON.stringify({ id }), { status: 200 });
    }),
  );
}

const STAFF = "vitest-reporter-email-staff@example.com";
const WEBHOOK_KEY = randomBytes(24);
let staff: { id: string; scopes: [] };
let ip = 0;

beforeAll(async () => {
  await removeTestPerson(STAFF);
  const p = await addPerson({ email: STAFF, name: "Staff", addedBy: "cli:vitest" });
  staff = { id: p.id, scopes: [] };
});

beforeEach(async () => {
  await settleOutbox();
  await clearWelfareTables();
  await db.execute(sql`delete from mail_outbox where purpose in ('public_verify', 'report_ack', 'report_outcome')`);
  await db.execute(sql`delete from email_contacts where purpose = 'report'`);
  await consentEvents(sql`delete from email_consent_events where purpose = 'report' or purpose is null`);
  await db.execute(sql`delete from email_suppressions`);
  await db.execute(sql`delete from mail_requests`);
  await db.execute(sql`delete from mail_deliveries`);
  sent = [];
  spies.logLines.length = 0;
  installFakeResend();
  process.env["RESEND_API_KEY"] = "re_test_transactional";
  process.env["RESEND_NEWS_API_KEY"] = "re_test_news";
  process.env["WELFARE_ALERT_TO"] = "alerts@example.org";
  process.env["RESEND_WEBHOOK_SECRET"] = `whsec_${WEBHOOK_KEY.toString("base64")}`;
  delete process.env["REPORTER_EMAIL"];
});

afterAll(async () => {
  await settleOutbox();
  vi.unstubAllGlobals();
  await clearWelfareTables();
  await removeTestPerson(STAFF);
  await pool.end();
});

/** The consent record is append-only (a trigger); tests lift it for their own set-up only. */
async function consentEvents(query: ReturnType<typeof sql>) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table email_consent_events disable trigger email_consent_events_append_only`);
    await tx.execute(query);
    await tx.execute(sql`alter table email_consent_events enable trigger email_consent_events_append_only`);
  });
}
const ageReportEvents = () =>
  consentEvents(sql`update email_consent_events set occurred_at = occurred_at - interval '25 hours' where purpose = 'report'`);

const address = () => `Reporter.${randomBytes(3).toString("hex")}@Example.org`;
const device = () => ({ id: `vitest-rep-${randomBytes(4).toString("hex")}`, secret: `vitest-rep-secret-${randomBytes(8).toString("hex")}` });

async function fileReport(body: Record<string, unknown> = {}, d = device()) {
  ip += 1;
  const res = await request(app)
    .post("/api/reports")
    .set("X-Device-Secret", d.secret)
    .set("X-Forwarded-For", `198.51.100.${ip % 250}`)
    .send({
      deviceId: d.id,
      clientRef: `ref-${randomBytes(8).toString("hex")}`,
      severity: "urgent",
      isLitter: false,
      lat: 37.44,
      lng: 24.94,
      note: "Limping by the harbour",
      language: "en",
      hasPhoto: false,
      ...body,
    });
  await settleOutbox();
  return { res, device: d };
}

async function report(publicId: string) {
  const [r] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.publicId, publicId));
  return r!;
}

/** Everything due, sent; then only the mail to this address. */
async function mailTo(to: string) {
  for (let i = 0; i < 20 && (await drainDue(50)).claimed > 0; i++);
  await settleOutbox();
  return sent.filter((m) => m.to === to.trim().toLowerCase());
}

function tokenIn(mail: Sent, path: "/api/mail/confirm" | "/api/mail/forget"): string {
  const m = mail.text.match(new RegExp(`${path.replace(/\//g, "\\/")}\\?t=([A-Za-z0-9_-]+)`));
  if (!m) throw new Error(`no ${path} link`);
  return m[1]!;
}

async function press(path: "/api/mail/confirm" | "/api/mail/forget", token: string) {
  const res = await request(app).post(path).set("Origin", publicAppOrigin()).type("form").send({ t: token });
  await settleOutbox();
  return res;
}

async function move(publicId: string, from: ReportState, to: ReportState, reporterSentence?: string) {
  await moveReportState({ publicId, from, to, person: staff, reporterSentence, onQueued: () => undefined });
}

describe("test 31: nothing but the one 'is this you?' reaches an unconfirmed address (F7b)", () => {
  it("files the report, sends one verification from news., and holds the acknowledgement until confirmed", async () => {
    const to = address();
    const { res } = await fileReport({ email: to });
    expect(res.status).toBe(201);
    const r = await report(res.body.publicId);
    expect(r.reporterContactId).not.toBeNull();

    let mine = await mailTo(to);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.from).toBe("Cat Spotters <news@news.catspotters.com>");
    expect(mine[0]!.subject).toBe("Is this you? — Cat Spotters");
    expect(mine[0]!.text).not.toMatch(/report|harbour|limping/i);

    // Time passes, the team closes it: still nothing but the one message.
    await move(res.body.publicId, "new", "done");
    await db.execute(sql`update mail_outbox set next_attempt_at = now() - interval '1 second' where state = 'queued'`);
    expect(await mailTo(to)).toHaveLength(1);

    // Confirmed: the acknowledgement (from mail., Reply-To the charity), then the held outcome.
    expect((await press("/api/mail/confirm", tokenIn(mine[0]!, "/api/mail/confirm"))).status).toBe(200);
    await db.execute(sql`update mail_outbox set next_attempt_at = now() - interval '1 second' where state = 'queued'`);
    mine = await mailTo(to);
    expect(mine.map((m) => m.subject)).toEqual([
      "Is this you? — Cat Spotters",
      "Your cat report reached Syros Cats",
      "About the cat you reported",
    ]);
    for (const m of mine.slice(1)) {
      expect(m.from).toBe("Syros Cats via Cat Spotters <reports@mail.catspotters.com>");
      expect(m.replyTo).toBe("admin@syroscats.com");
    }
  });

  it("the queue and the alert never carry the address", async () => {
    const to = address();
    const { res } = await fileReport({ email: to });
    const alert = sent.find((m) => m.to === "alerts@example.org")!;
    expect(alert.text).toContain("The reporter left contact details — reply from the dashboard.");
    expect(alert.text.toLowerCase()).not.toContain(to.toLowerCase());
    const [row] = await db.select().from(mailOutboxTable).where(
      and(eq(mailOutboxTable.purpose, "public_verify"), eq(mailOutboxTable.reportId, (await report(res.body.publicId)).id)),
    );
    expect(JSON.stringify(row!.payload).toLowerCase()).not.toContain(to.toLowerCase());
  });

  it("the address never reaches the logs", async () => {
    const to = address();
    await fileReport({ email: to });
    await mailTo(to);
    expect(spies.logLines.join("\n").toLowerCase()).not.toContain(to.toLowerCase());
  });
});

describe("test 33: one outcome email per report", () => {
  async function confirmed() {
    const to = address();
    const { res } = await fileReport({ email: to });
    const [verify] = await mailTo(to);
    await press("/api/mail/confirm", tokenIn(verify!, "/api/mail/confirm"));
    await mailTo(to);
    return { to, publicId: res.body.publicId as string };
  }

  it("Looking at it sends nothing; Done sends one; re-opening and re-closing sends no second", async () => {
    const { to, publicId } = await confirmed();
    const before = (await mailTo(to)).length;
    await move(publicId, "new", "looking");
    expect(await mailTo(to)).toHaveLength(before);
    await move(publicId, "looking", "done", "We found her and took her to the vet.");
    let mine = await mailTo(to);
    expect(mine).toHaveLength(before + 1);
    expect(mine.at(-1)!.subject).toBe("About the cat you reported");
    expect(mine.at(-1)!.text).toContain("We found her and took her to the vet.");
    await move(publicId, "done", "new");
    await move(publicId, "new", "nothing_needed");
    mine = await mailTo(to);
    expect(mine).toHaveLength(before + 1);
    const events = await db.select().from(reportStateEventsTable)
      .where(eq(reportStateEventsTable.reportId, (await report(publicId)).id));
    expect(events.filter((e) => e.reporterMessage === "report_outcome")).toHaveLength(1);
  });

  it("the team sentence goes with Done only", async () => {
    const { to, publicId } = await confirmed();
    await move(publicId, "new", "nothing_needed", "This should not go.");
    const last = (await mailTo(to)).at(-1)!;
    expect(last.subject).toBe("About the cat you reported");
    expect(last.text).not.toContain("This should not go.");
  });

  it("a second report from a confirmed address is acknowledged without another 'is this you?' (after 24 hours)", async () => {
    const { to } = await confirmed();
    await db.execute(sql`update mail_outbox set created_at = now() - interval '25 hours' where purpose = 'report_ack'`);
    await fileReport({ email: to });
    const mine = await mailTo(to);
    expect(mine.filter((m) => m.subject.startsWith("Is this you?"))).toHaveLength(1);
    expect(mine.filter((m) => m.subject === "Your cat report reached Syros Cats")).toHaveLength(2);
  });
});

describe("test 35: a suppressed or limited address gets nothing, and the report is still written", () => {
  it("a suppressed address: no email, no stored address, report written", async () => {
    const to = address();
    await db.insert(emailSuppressionsTable).values({ addressHmac: addressFingerprint("all", to), reason: "complaint", scope: "all" });
    const { res } = await fileReport({ email: to });
    expect(res.status).toBe(201);
    expect((await report(res.body.publicId)).reporterContactId).toBeNull();
    expect(await mailTo(to)).toHaveLength(0);
  });

  it("one 'is this you?' per address per 24 hours, then three in a lifetime and suppression", async () => {
    const to = address();
    const first = await fileReport({ email: to });
    const second = await fileReport({ email: to });
    expect(first.res.status).toBe(201);
    expect(second.res.status).toBe(201);
    expect(await mailTo(to)).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      await ageReportEvents();
      await fileReport({ email: to });
    }
    expect(await mailTo(to)).toHaveLength(3);
    const [cap] = await db.select().from(emailSuppressionsTable)
      .where(eq(emailSuppressionsTable.addressHmac, addressFingerprint("report", to)));
    expect(cap!.reason).toBe("verify_cap");
  });

  it("a report from an unconfirmed address waits on the first 'is this you?': confirming acknowledges both (one a day)", async () => {
    const to = address();
    await fileReport({ email: to });
    await fileReport({ email: to });
    const [verify] = await mailTo(to);
    await press("/api/mail/confirm", tokenIn(verify!, "/api/mail/confirm"));
    const mine = await mailTo(to);
    expect(mine.filter((m) => m.subject === "Your cat report reached Syros Cats")).toHaveLength(1);
    const contacts = await db.select().from(emailContactsTable).where(eq(emailContactsTable.addressHmac, addressFingerprint("report", to)));
    expect(contacts.map((c) => c.status)).toEqual(["confirmed", "confirmed"]);
  });

  it("a bad address, or the box switched off, is ignored and the report is written", async () => {
    const bad = await fileReport({ email: "not an address" });
    expect(bad.res.status).toBe(201);
    expect((await report(bad.res.body.publicId)).reporterContactId).toBeNull();
    process.env["REPORTER_EMAIL"] = "off";
    const to = address();
    const off = await fileReport({ email: to });
    expect(off.res.status).toBe(201);
    expect((await report(off.res.body.publicId)).reporterContactId).toBeNull();
    expect(await mailTo(to)).toHaveLength(0);
  });

  it("the app is told to offer the box only when the news key is set", async () => {
    const opts = () => request(app).get("/api/reports/options");
    expect((await opts()).body).toEqual({ reporterEmail: true });
    delete process.env["RESEND_NEWS_API_KEY"];
    expect((await opts()).body).toEqual({ reporterEmail: false });
  });

  it("the answer is the same with or without an address", async () => {
    const plain = await fileReport({});
    const withEmail = await fileReport({ email: address() });
    expect(Object.keys(withEmail.res.body)).toEqual(Object.keys(plain.res.body));
    expect(withEmail.res.status).toBe(plain.res.status);
  });
});

describe("forgetting and deleting", () => {
  it("'Forget this address' in the 'is this you?' suppresses it: the report stays, typed again it gets nothing", async () => {
    const to = address();
    const { res } = await fileReport({ email: to });
    const [verify] = await mailTo(to);
    const page = await request(app).get(`/api/mail/forget?t=${tokenIn(verify!, "/api/mail/forget")}`);
    expect(page.text).toContain("Forget this address");
    expect((await press("/api/mail/forget", tokenIn(verify!, "/api/mail/forget"))).status).toBe(200);
    expect((await report(res.body.publicId)).reporterContactId).toBeNull();
    await ageReportEvents();
    await fileReport({ email: to });
    expect(await mailTo(to)).toHaveLength(1);
  });

  it("'Delete my details' in the acknowledgement takes the address off the report, without suppressing it", async () => {
    const to = address();
    const { res } = await fileReport({ email: to });
    const [verify] = await mailTo(to);
    await press("/api/mail/confirm", tokenIn(verify!, "/api/mail/confirm"));
    const ack = (await mailTo(to)).find((m) => m.subject === "Your cat report reached Syros Cats")!;
    const del = tokenIn(ack, "/api/mail/forget");
    expect((await request(app).get(`/api/mail/forget?t=${del}`)).text).toContain("Delete my details");
    const done = await press("/api/mail/forget", del);
    expect(done.text).toContain("We&#39;ve deleted your email address".replace("&#39;", "'"));
    const r = await report(res.body.publicId);
    expect(r.reporterContactId).toBeNull();
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.addressHmac, addressFingerprint("report", to)))).toHaveLength(0);
    expect(await db.select().from(emailSuppressionsTable).where(eq(emailSuppressionsTable.addressHmac, addressFingerprint("report", to)))).toHaveLength(0);
    // Closing it now mails nobody.
    await move(res.body.publicId, "new", "done");
    expect((await mailTo(to)).filter((m) => m.subject === "About the cat you reported")).toHaveLength(0);
  });

  it("Delete my data (SYC-63) erases the reporter's address and its emails; the report stays", async () => {
    const to = address();
    const { res, device: d } = await fileReport({ email: to });
    await mailTo(to);
    await db.transaction((tx) => severPerson(tx, { deviceId: d.id, reason: "deleted by the person" }));
    const r = await report(res.body.publicId);
    expect(r.reporterContactId).toBeNull();
    expect(r.reporterDevice).toBeNull();
    const left = await db.execute(sql`select count(*)::int as n from email_contacts where purpose = 'report'`);
    expect((left.rows[0] as { n: number }).n).toBe(0);
    const mail = await db.execute(sql`select count(*)::int as n from mail_outbox where purpose in ('public_verify', 'report_ack', 'report_outcome')`);
    expect((mail.rows[0] as { n: number }).n).toBe(0);
  });

  it("the sweep forgets an unconfirmed address after 7 days; the report stays", async () => {
    const to = address();
    const { res } = await fileReport({ email: to });
    await db.execute(sql`update email_contacts set created_at = now() - interval '8 days' where purpose = 'report'`);
    await sweepKeepSafe();
    expect((await report(res.body.publicId)).reporterContactId).toBeNull();
    expect(await db.select().from(emailContactsTable).where(eq(emailContactsTable.purpose, "report"))).toHaveLength(0);
  });
});

describe("test 36: the Resend webhook", () => {
  function sign(body: string, opts: { at?: number; key?: Buffer } = {}) {
    const id = `msg_${randomBytes(6).toString("hex")}`;
    const ts = String(Math.floor((opts.at ?? Date.now()) / 1000));
    const sig = createHmac("sha256", opts.key ?? WEBHOOK_KEY).update(`${id}.${ts}.${body}`).digest("base64");
    return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
  }
  function post(body: string, headers: Record<string, string>) {
    return request(app).post("/api/internal/resend/webhook").set(headers).set("Content-Type", "application/json").send(body);
  }

  it("a bounce suppresses the address, so a later 'is this you?' isn't sent", async () => {
    const to = address();
    await fileReport({ email: to });
    const [verify] = await mailTo(to);
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: verify!.id, to: [to.toLowerCase()], bounce: { type: "Permanent" } } });
    expect((await post(body, sign(body))).status).toBe(200);
    const [delivery] = await db.select().from(mailDeliveriesTable).where(eq(mailDeliveriesTable.providerMessageId, verify!.id));
    expect(delivery!.state).toBe("bounced");
    await ageReportEvents();
    const again = await fileReport({ email: to });
    expect(again.res.status).toBe(201);
    expect(await mailTo(to)).toHaveLength(1);
  });

  it("a late 'delivered' never hides a bounce", async () => {
    const to = address();
    await fileReport({ email: to });
    const [verify] = await mailTo(to);
    for (const type of ["email.bounced", "email.delivered"]) {
      const body = JSON.stringify({ type, data: { email_id: verify!.id, to: [to] } });
      await post(body, sign(body));
    }
    const [delivery] = await db.select().from(mailDeliveriesTable).where(eq(mailDeliveriesTable.providerMessageId, verify!.id));
    expect(delivery!.state).toBe("bounced");
  });

  it("refuses a bad signature, a stale one, and no signature, and changes nothing", async () => {
    const to = address();
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "re_x", to: [to] } });
    expect((await post(body, sign(body, { key: randomBytes(24) }))).status).toBe(401);
    expect((await post(body, sign(body, { at: Date.now() - 10 * 60_000 }))).status).toBe(401);
    expect((await post(body, {})).status).toBe(401);
    expect((await post(`${body} `, sign(body))).status).toBe(401);
    expect(await db.select().from(emailSuppressionsTable)).toHaveLength(0);
  });

  it("with no secret configured it refuses, and the internal token doesn't open it", async () => {
    delete process.env["RESEND_WEBHOOK_SECRET"];
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "re_x", to: [address()] } });
    const res = await post(body, { Authorization: `Bearer ${process.env["INTERNAL_PEOPLE_TOKEN"] ?? "x"}` });
    expect(res.status).toBe(503);
    expect(await db.select().from(emailSuppressionsTable)).toHaveLength(0);
  });
});
