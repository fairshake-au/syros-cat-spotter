import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import {
  db,
  pool,
  deviceCredentialsTable,
  mailOutboxTable,
  welfareReportsTable,
} from "@workspace/db";
import { eq, like, sql } from "drizzle-orm";

// SYC-170 PR 1.1 (plan docs/superpowers/plans/syc-44-report-an-issue.md;
// spec docs/specs/report-an-issue.md §9.2, §9.5): Turnstile on
// POST /api/reports and POST /api/reports/draft. Tests T1-1 … T1-7b; T1-8 (the
// queue page) is in team.queuePage.test.ts. Siteverify is faked at the
// fetch boundary, alongside the fake Resend the outbox sends through.

const spies = vi.hoisted(() => ({ logLines: [] as string[] }));

// T1-6 captures every log line, with the production redaction settings.
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
import { drainDue, settleOutbox, UNCHECKED_ALERTS_PER_HOUR } from "../lib/mail/outbox";
import { SITEVERIFY_URL } from "../lib/turnstile";

const DEVICE = `vitest-turnstile-${randomBytes(4).toString("hex")}`;
const SECRET = "vitest-turnstile-device-secret-aa";
const TURNSTILE_SECRET = "0x4AAAA-vitest-turnstile-secret-never-logged";
const TOKEN = "0.vitest-turnstile-token-must-never-be-logged-XYZ";
const LAT = 37.4441234;
const LNG = 24.9412345;

// ── The fake network ───────────────────────────────────────────────────────

type Siteverify = () => Response | Promise<Response>;
let siteverify: Siteverify;
let siteverifyCalls = 0;
let mailSent: { subject: string; text: string }[] = [];

const cf = (body: Record<string, unknown>, status = 200): Siteverify => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Cloudflare's "success" for this report and form, with any field overridden. */
const pass = (cdata: string, action = "welfare_report", over: Record<string, unknown> = {}) =>
  cf({ success: true, hostname: "apptest.catspotters.com", action, cdata, "error-codes": [], ...over });
const timeout: Siteverify = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};

function installFakeNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === SITEVERIFY_URL) {
        siteverifyCalls += 1;
        return siteverify();
      }
      const body = JSON.parse(String(init?.body)) as { subject: string; text: string };
      mailSent.push({ subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: `re_${mailSent.length}` }), { status: 200 });
    }),
  );
}

// ── Requests ───────────────────────────────────────────────────────────────

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}
const clientRef = () => `ref-${randomBytes(8).toString("hex")}`;

function submit(body: Record<string, unknown>, ip = freshIp()) {
  return request(app)
    .post("/api/reports")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", ip)
    .send({
      deviceId: DEVICE,
      severity: "urgent",
      isLitter: false,
      lat: LAT,
      lng: LNG,
      note: "Hurt cat by the harbour",
      language: "en",
      hasPhoto: false,
      ...body,
    });
}

function draft(body: Record<string, unknown>, ip = freshIp()) {
  return request(app)
    .post("/api/reports/draft")
    .set("X-Device-Secret", SECRET)
    .set("X-Forwarded-For", ip)
    .send({ deviceId: DEVICE, severity: "attention", lat: LAT, lng: LNG, language: "en", ...body });
}

async function rowsFor(ref: string) {
  return db.select().from(welfareReportsTable).where(eq(welfareReportsTable.clientRef, ref));
}

async function outboxFor(reportId: number) {
  return db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, reportId));
}

async function drainAll() {
  await settleOutbox(); // a send kicked after the reply may hold a row
  await db.execute(
    sql`update mail_outbox set next_attempt_at = now() - interval '1 second' where state = 'queued'`,
  );
  for (let i = 0; i < 50; i++) {
    if ((await drainDue(50)).claimed === 0) return;
  }
}

async function cleanup() {
  await db.execute(sql`delete from mail_outbox`);
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${DEVICE}%`));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
}

const saved = { ...process.env };
beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  siteverify = cf({ success: false, "error-codes": ["invalid-input-response"] });
  siteverifyCalls = 0;
  mailSent = [];
  spies.logLines.length = 0;
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
  process.env = { ...saved };
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

/** Nothing at all was written for this clientRef: no row, no draft, no mail. */
async function expectNothingWritten(ref: string) {
  expect(await rowsFor(ref)).toHaveLength(0);
  const mail = await db.execute(sql`select count(*)::int as n from mail_outbox`);
  expect((mail.rows[0] as { n: number }).n).toBe(0);
}

// ── T1-1 ───────────────────────────────────────────────────────────────────

describe("T1-1: a token that isn't good is 428 and writes nothing (spec test 13)", () => {
  const cases: [string, (ref: string, action: string) => { token: unknown; reply: Siteverify }][] = [
    ["missing", () => ({ token: undefined, reply: timeout })],
    ["malformed", () => ({ token: "not a token\u0000", reply: timeout })],
    ["over 2,048 characters", () => ({ token: "x".repeat(2049), reply: timeout })],
    ["success: false", () => ({ token: TOKEN, reply: cf({ success: false, "error-codes": ["invalid-input-response"] }) })],
    ["the wrong action", (ref, action) => ({ token: TOKEN, reply: pass(ref, action === "welfare_report" ? "welfare_draft" : "welfare_report") })],
    ["the wrong cdata (another report's token)", (_ref, action) => ({ token: TOKEN, reply: pass("ref-someone-else", action) })],
    ["hostname team.catspotters.com", (ref, action) => ({ token: TOKEN, reply: pass(ref, action, { hostname: "team.catspotters.com" }) })],
    ["a reused token (timeout-or-duplicate)", () => ({ token: TOKEN, reply: cf({ success: false, "error-codes": ["timeout-or-duplicate"] }) })],
  ];

  it.each(cases)("report: %s", async (_name, make) => {
    const ref = clientRef();
    const { token, reply } = make(ref, "welfare_report");
    siteverify = reply;
    const res = await submit({ clientRef: ref, turnstileToken: token });
    expect(res.status).toBe(428);
    expect(res.body).toEqual({ error: "challenge_required" });
    await expectNothingWritten(ref);
  });

  it.each(cases)("draft: %s", async (_name, make) => {
    const ref = clientRef();
    const { token, reply } = make(ref, "welfare_draft");
    siteverify = reply;
    const res = await draft({ clientRef: ref, turnstileToken: token });
    expect(res.status).toBe(428);
    expect(res.body).toEqual({ error: "challenge_required" });
    await expectNothingWritten(ref);
  });

  it("a good token for this report and form is accepted and marked checked", async () => {
    const ref = clientRef();
    siteverify = pass(ref);
    const res = await submit({ clientRef: ref, turnstileToken: TOKEN });
    expect(res.status).toBe(201);
    const [row] = await rowsFor(ref);
    expect(row!.tokenChecked).toBe(true);
    expect(await outboxFor(row!.id)).toHaveLength(1);
  });
});

// ── T1-2 ───────────────────────────────────────────────────────────────────

describe("T1-2: Cloudflare unreachable → an unchecked row, and its alert is emailed", () => {
  it.each([
    ["a timeout", timeout],
    ["a 503", cf({ error: "unavailable" }, 503)],
  ])("%s", async (_name, reply) => {
    siteverify = reply;
    const ref = clientRef();
    const res = await submit({ clientRef: ref, turnstileToken: TOKEN });
    expect(res.status).toBe(201);
    expect(siteverifyCalls).toBe(2); // one retry
    const [row] = await rowsFor(ref);
    expect(row!.tokenChecked).toBe(false);
    expect(row!.isDraft).toBe(false);
    await drainAll();
    expect(mailSent).toHaveLength(1);
    expect(mailSent[0]!.subject).toMatch(/^Urgent cat report/);
    const [mail] = await outboxFor(row!.id);
    expect(mail!.state).toBe("sent");
  });
});

// ── T1-3 ───────────────────────────────────────────────────────────────────

describe("T1-3: the unchecked limit, per address", () => {
  it("the 4th unchecked report from one address in an hour is 429; drafts have their own bucket", async () => {
    siteverify = timeout;
    const ip = freshIp();
    // Drafts during the outage don't use up the reports' three (finding 15).
    for (let i = 0; i < 3; i++) {
      expect((await draft({ clientRef: clientRef(), turnstileToken: TOKEN }, ip)).status).toBe(204);
    }
    for (let i = 0; i < 3; i++) {
      expect((await submit({ clientRef: clientRef(), turnstileToken: TOKEN }, ip)).status).toBe(201);
    }
    const ref = clientRef();
    const fourth = await submit({ clientRef: ref, turnstileToken: TOKEN }, ip);
    expect(fourth.status).toBe(429);
    expect(fourth.headers["retry-after"]).toBeDefined();
    expect(await rowsFor(ref)).toHaveLength(0);
    // A checked report from the same address still goes through.
    const ok = clientRef();
    siteverify = pass(ok);
    expect((await submit({ clientRef: ok, turnstileToken: TOKEN }, ip)).status).toBe(201);
  });

  it("drafts: the 11th unchecked draft from one address in an hour is 429, and reports are unaffected", async () => {
    siteverify = timeout;
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      expect((await draft({ clientRef: clientRef(), turnstileToken: TOKEN }, ip)).status).toBe(204);
    }
    const ref = clientRef();
    expect((await draft({ clientRef: ref, turnstileToken: TOKEN }, ip)).status).toBe(429);
    expect(await rowsFor(ref)).toHaveLength(0);
    expect((await submit({ clientRef: clientRef(), turnstileToken: TOKEN }, ip)).status).toBe(201);
  });

  it("an IPv6 address counts by its /56, like every other limit", async () => {
    siteverify = timeout;
    for (const ip of ["2001:db8:7:100::1", "2001:db8:7:1ab::2", "2001:db8:7:1ff::3"]) {
      expect((await submit({ clientRef: clientRef(), turnstileToken: TOKEN }, ip)).status).toBe(201);
    }
    expect((await submit({ clientRef: clientRef(), turnstileToken: TOKEN }, "2001:db8:7:1cd::9")).status).toBe(429);
    // Another /56 has its own allowance.
    expect((await submit({ clientRef: clientRef(), turnstileToken: TOKEN }, "2001:db8:7:200::1")).status).toBe(201);
  });
});

// ── T1-4 ───────────────────────────────────────────────────────────────────

describe("T1-4: the duplicate check comes before the token", () => {
  it("a resend of a sent report with no token gets its original 200, not 428", async () => {
    const ref = clientRef();
    siteverify = pass(ref);
    const first = await submit({ clientRef: ref, turnstileToken: TOKEN });
    expect(first.status).toBe(201);
    siteverify = timeout;
    const calls = siteverifyCalls;
    const again = await submit({ clientRef: ref });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ publicId: first.body.publicId });
    // A spent (reused) token gets the same answer.
    siteverify = cf({ success: false, "error-codes": ["timeout-or-duplicate"] });
    const reused = await submit({ clientRef: ref, turnstileToken: TOKEN });
    expect(reused.status).toBe(200);
    expect(reused.body).toEqual({ publicId: first.body.publicId });
    expect(siteverifyCalls).toBe(calls); // never asked
    const rows = await rowsFor(ref);
    expect(rows).toHaveLength(1);
    expect(await outboxFor(rows[0]!.id)).toHaveLength(1);
  });

  it("a late draft call for a sent report, with no token, is still 204 and changes nothing", async () => {
    const ref = clientRef();
    siteverify = pass(ref);
    await submit({ clientRef: ref, turnstileToken: TOKEN });
    const res = await draft({ clientRef: ref });
    expect(res.status).toBe(204);
    const [row] = await rowsFor(ref);
    expect(row!.isDraft).toBe(false);
    expect(row!.severity).toBe("urgent");
  });

  it("a report whose draft exists still needs a token (a draft is not a sent report)", async () => {
    const ref = clientRef();
    siteverify = pass(ref, "welfare_draft");
    expect((await draft({ clientRef: ref, turnstileToken: TOKEN })).status).toBe(204);
    expect((await submit({ clientRef: ref })).status).toBe(428);
    const [row] = await rowsFor(ref);
    expect(row!.isDraft).toBe(true);
  });
});

// ── T1-5 ───────────────────────────────────────────────────────────────────

describe("T1-5: the draft route (spec test 15)", () => {
  it("no token is 428 and writes nothing", async () => {
    const ref = clientRef();
    const res = await draft({ clientRef: ref });
    expect(res.status).toBe(428);
    await expectNothingWritten(ref);
  });

  it("a good draft token (action welfare_draft, cdata = clientRef) writes a checked draft", async () => {
    const ref = clientRef();
    siteverify = pass(ref, "welfare_draft");
    expect((await draft({ clientRef: ref, turnstileToken: TOKEN })).status).toBe(204);
    const [row] = await rowsFor(ref);
    expect(row!.isDraft).toBe(true);
    expect(row!.tokenChecked).toBe(true);
  });

  it("during an outage it writes an unchecked draft, and sends nothing", async () => {
    siteverify = timeout;
    const ref = clientRef();
    expect((await draft({ clientRef: ref, turnstileToken: TOKEN })).status).toBe(204);
    const [row] = await rowsFor(ref);
    expect(row!.isDraft).toBe(true);
    expect(row!.tokenChecked).toBe(false);
    expect(await outboxFor(row!.id)).toHaveLength(0);
  });

  it("an unchecked draft sent later with a good token becomes a checked report", async () => {
    siteverify = timeout;
    const ref = clientRef();
    await draft({ clientRef: ref, turnstileToken: TOKEN });
    siteverify = pass(ref);
    expect((await submit({ clientRef: ref, turnstileToken: TOKEN })).status).toBe(201);
    const [row] = await rowsFor(ref);
    expect(row!.isDraft).toBe(false);
    expect(row!.tokenChecked).toBe(true);
  });
});

// ── T1-6 ───────────────────────────────────────────────────────────────────

describe("T1-6: neither the token nor the secret ever reaches a log line (spec test 13)", () => {
  it("across every outcome and mode", async () => {
    const replies: Siteverify[] = [
      pass("ref-x"),
      cf({ success: false, "error-codes": ["timeout-or-duplicate"] }),
      timeout,
      cf({}, 503),
      cf({}, 429),
      cf({ success: false, "error-codes": ["invalid-input-secret"] }),
    ];
    for (const mode of ["enforce", "observe"]) {
      process.env["TURNSTILE_MODE"] = mode;
      for (const reply of replies) {
        siteverify = reply;
        await submit({ clientRef: clientRef(), turnstileToken: TOKEN });
        await draft({ clientRef: clientRef(), turnstileToken: TOKEN });
      }
    }
    await drainAll();
    expect(spies.logLines.length).toBeGreaterThan(0);
    expect(spies.logLines.some((l) => l.includes('"turnstile"'))).toBe(true);
    for (const line of spies.logLines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(TURNSTILE_SECRET);
    }
  });
});

// ── T1-7 ───────────────────────────────────────────────────────────────────

describe("T1-7: TURNSTILE_MODE", () => {
  it("observe refuses nothing and logs the outcome (no token)", async () => {
    process.env["TURNSTILE_MODE"] = "observe";
    siteverify = pass("ref-not-this-one", "welfare_report", { hostname: "team.catspotters.com" });
    const ref = clientRef();
    const res = await submit({ clientRef: ref, turnstileToken: TOKEN });
    expect(res.status).toBe(201);
    const [row] = await rowsFor(ref);
    expect(row!.tokenChecked).toBeNull(); // nothing was enforced
    const line = spies.logLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l["turnstile"]);
    expect(line).toMatchObject({
      turnstile: "rejected",
      mode: "observe",
      action: "welfare_report",
      hostname: "team.catspotters.com",
      hostnameMatch: false,
      actionMatch: true,
      cdataMatch: false,
    });
    expect(Array.isArray(line!["errorCodes"])).toBe(true);
  });

  it("observe: no token at all is accepted too, and an ok one is marked checked", async () => {
    process.env["TURNSTILE_MODE"] = "observe";
    const a = clientRef();
    expect((await submit({ clientRef: a })).status).toBe(201);
    const b = clientRef();
    siteverify = pass(b);
    expect((await submit({ clientRef: b, turnstileToken: TOKEN })).status).toBe(201);
    expect((await rowsFor(b))[0]!.tokenChecked).toBe(true);
  });

  it("off checks nothing and writes token_checked null", async () => {
    process.env["TURNSTILE_MODE"] = "off";
    const ref = clientRef();
    expect((await submit({ clientRef: ref })).status).toBe(201);
    expect(siteverifyCalls).toBe(0);
    expect((await rowsFor(ref))[0]!.tokenChecked).toBeNull();
  });

  it.each(["off", "observe"])("in production with the pre-launch pass off, %s is ignored and enforce applies", async (mode) => {
    process.env["NODE_ENV"] = "production";
    process.env["PRELAUNCH_GATE"] = "off";
    process.env["TURNSTILE_MODE"] = mode;
    const ref = clientRef();
    const res = await submit({ clientRef: ref });
    expect(res.status).toBe(428);
    await expectNothingWritten(ref);
    const health = await request(app).get("/api/healthz");
    expect(health.body.turnstile.mode).toBe("enforce");
  });
});

// ── T1-7b ──────────────────────────────────────────────────────────────────

describe("T1-7b: our side's failures", () => {
  it.each(["invalid-input-secret", "missing-input-secret"])(
    "Cloudflare says %s: 503, no row, never an unchecked row",
    async (code) => {
      siteverify = cf({ success: false, "error-codes": [code] });
      const ref = clientRef();
      const res = await submit({ clientRef: ref, turnstileToken: TOKEN });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: "turnstile_not_configured" });
      await expectNothingWritten(ref);
      const d = clientRef();
      expect((await draft({ clientRef: d, turnstileToken: TOKEN })).status).toBe(503);
      await expectNothingWritten(d);
    },
  );

  it("no secret configured: 503 without calling Cloudflare", async () => {
    delete process.env["TURNSTILE_SECRET_KEY"];
    const ref = clientRef();
    const res = await submit({ clientRef: ref, turnstileToken: TOKEN });
    expect(res.status).toBe(503);
    expect(siteverifyCalls).toBe(0);
    await expectNothingWritten(ref);
  });

  it("a 429 from Cloudflare is unreachable: accepted unchecked", async () => {
    siteverify = cf({}, 429);
    const ref = clientRef();
    expect((await submit({ clientRef: ref, turnstileToken: TOKEN })).status).toBe(201);
    expect((await rowsFor(ref))[0]!.tokenChecked).toBe(false);
  });

  it("a reply that isn't JSON is unreachable: accepted unchecked", async () => {
    siteverify = () => new Response("<html>bad gateway</html>", { status: 200 });
    const ref = clientRef();
    expect((await submit({ clientRef: ref, turnstileToken: TOKEN })).status).toBe(201);
    expect((await rowsFor(ref))[0]!.tokenChecked).toBe(false);
  });
});

// ── Item 6: the unchecked alert cap ────────────────────────────────────────

describe("unchecked alerts: 10 an hour, then one \"N waiting\" email an hour", () => {
  it("the 11th and 12th unchecked reports in an hour get no alert of their own, and one waiting email counts them", async () => {
    siteverify = timeout;
    const ids: number[] = [];
    for (let i = 0; i < UNCHECKED_ALERTS_PER_HOUR + 2; i++) {
      const ref = clientRef();
      expect((await submit({ clientRef: ref, turnstileToken: TOKEN, hasPhoto: i === 10 })).status).toBe(201);
      ids.push((await rowsFor(ref))[0]!.id);
    }
    for (const [i, id] of ids.entries()) {
      expect(await outboxFor(id), `report ${i + 1}`).toHaveLength(i < UNCHECKED_ALERTS_PER_HOUR ? 1 : 0);
    }
    const waiting = await db.execute(
      sql`select count(*)::int as n from mail_outbox where payload->>'kind' = 'unchecked_waiting'`,
    );
    expect((waiting.rows[0] as { n: number }).n).toBe(1);

    // The 11th report's photo arriving later doesn't walk round the cap with
    // a "photo" follow-up email.
    const [eleventh] = await db
      .select({ publicId: welfareReportsTable.publicId })
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.id, ids[10]!));
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#a33" } })
      .jpeg()
      .toBuffer();
    const photo = await request(app)
      .put(`/api/reports/${eleventh!.publicId}/photo`)
      .set("X-Device-Secret", SECRET)
      .send({ deviceId: DEVICE, photoBase64: jpeg.toString("base64") });
    expect(photo.status).toBe(200);
    expect(await outboxFor(ids[10]!)).toHaveLength(0);

    // A checked report is never held back by the cap.
    const ok = clientRef();
    siteverify = pass(ok);
    expect((await submit({ clientRef: ok, turnstileToken: TOKEN })).status).toBe(201);
    expect(await outboxFor((await rowsFor(ok))[0]!.id)).toHaveLength(1);

    await drainAll();
    const waitingMail = mailSent.filter((m) => m.subject.includes("waiting"));
    expect(waitingMail).toHaveLength(1);
    expect(waitingMail[0]!.subject).toBe("2 unchecked cat reports waiting in the welfare queue");
    expect(waitingMail[0]!.text).toContain("Unchecked (Cloudflare was unreachable)");
    expect(waitingMail[0]!.text).not.toContain("Hurt cat by the harbour");
    expect(mailSent.filter((m) => /cat report/i.test(m.subject) && !m.subject.includes("waiting"))).toHaveLength(
      UNCHECKED_ALERTS_PER_HOUR + 1,
    );
  });
});
