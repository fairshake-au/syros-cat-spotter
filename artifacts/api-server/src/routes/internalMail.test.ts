import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import {
  db,
  pool,
  mailOutboxTable,
  welfareReportsTable,
} from "@workspace/db";
import { eq, inArray, like, sql } from "drizzle-orm";
// The drain also sends the evening sighting round-up (data-spine.md PR 9).
// Stubbed here so a run after 20:00 Athens time can't push through this
// file's fake Resend `fetch`; sightingRoundUp.test.ts covers the real thing.
const sendDailyRoundUpMock = vi.hoisted(() =>
  vi.fn(async () => ({ status: "not_due" as const })),
);
vi.mock("../lib/sightingRoundUp", () => ({
  sendDailyRoundUp: sendDailyRoundUpMock,
  opportunisticRoundUp: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import app from "../app";
import { drainDue, settleOutbox } from "../lib/mail/outbox";
import { _resetIssueNotesSweepForTests } from "../lib/issues/retention";

// SYC-42 plan, Slice 1 item 1.6: making sure the email actually goes.
// Plan tests 14 (exactly once under parallel drains), 15 (the narrow drain
// token) and 16 (the drain fails loudly when an alert is over an hour late).

const DEVICE = `vitest-drain-${randomBytes(4).toString("hex")}`;
const DRAIN_TOKEN = randomBytes(24).toString("base64url");
const PEOPLE_TOKEN = randomBytes(24).toString("base64url");

let sentIds: string[] = [];

function installFakeResend(delayMs = 0) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const id = /Report: (\S+)/.exec(body.text)?.[1] ?? "?";
      sentIds.push(id);
      return new Response(JSON.stringify({ id: `re_${sentIds.length}` }), { status: 200 });
    }),
  );
}

/** A submitted report with its alert due now, written straight to the tables. */
async function seedReport(opts: { ageMinutes?: number } = {}) {
  const publicId = `pub-${randomBytes(10).toString("hex")}`;
  const createdAt = new Date(Date.now() - (opts.ageMinutes ?? 0) * 60_000);
  const [report] = await db
    .insert(welfareReportsTable)
    .values({
      publicId,
      severity: "urgent",
      lat: 37.44,
      lng: 24.94,
      reporterDevice: DEVICE,
      clientRef: randomBytes(6).toString("hex"),
      photoState: "none",
      submittedAt: createdAt,
      createdAt,
    })
    .returning();
  await db.insert(mailOutboxTable).values({
    purpose: "welfare_alert",
    reportId: report!.id,
    recipientHash: "0000000000000000",
    payload: { kind: "alert" },
    nextAttemptAt: createdAt,
    createdAt,
  });
  return report!;
}

async function cleanup() {
  const ids = (
    await db
      .select({ id: welfareReportsTable.id })
      .from(welfareReportsTable)
      .where(like(welfareReportsTable.reporterDevice, `${DEVICE}%`))
  ).map((r) => r.id);
  if (ids.length) {
    await db.delete(mailOutboxTable).where(inArray(mailOutboxTable.reportId, ids));
    await db.delete(welfareReportsTable).where(inArray(welfareReportsTable.id, ids));
  }
  // Leftovers from other files must not make this file's drains busy or overdue.
  await db.execute(sql`update mail_outbox set state = 'sent' where state in ('queued', 'sending')`);
}

const saved = { ...process.env };
beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  sentIds = [];
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  process.env["WELFARE_ALERT_TO"] = "alerts@example.org";
  process.env["MAIL_DRAIN_TOKEN"] = DRAIN_TOKEN;
  process.env["INTERNAL_PEOPLE_TOKEN"] = PEOPLE_TOKEN;
  installFakeResend();
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

function drain(token?: string) {
  const req = request(app).post("/api/internal/mail/drain");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req;
}

describe("test 14: two drains at once send each alert exactly once (SKIP LOCKED)", () => {
  it("parallel drains never double-send", async () => {
    installFakeResend(30);
    const reports = await Promise.all(Array.from({ length: 6 }, () => seedReport()));
    await Promise.all([drainDue(10), drainDue(10), drainDue(10)]);
    const mine = reports.map((r) => r.publicId);
    for (const id of mine) {
      expect(sentIds.filter((s) => s === id), id).toHaveLength(1);
    }
    const rows = await db
      .select()
      .from(mailOutboxTable)
      .where(inArray(mailOutboxTable.reportId, reports.map((r) => r.id)));
    expect(rows.every((r) => r.state === "sent")).toBe(true);
  });

  it("nit (review of #55): a row another server holds is skipped, not waited on (plain FOR UPDATE would block here)", async () => {
    installFakeResend();
    const held = await seedReport();
    const free = await seedReport();
    const other = await pool.connect();
    try {
      await other.query("begin");
      await other.query("select id from mail_outbox where report_id = $1 for update", [held.id]);
      const outcome = await Promise.race([
        drainDue(10).then(() => "drained" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 3_000)),
      ]);
      expect(outcome).toBe("drained");
      expect(sentIds).toContain(free.publicId);
      expect(sentIds).not.toContain(held.publicId);
    } finally {
      await other.query("rollback");
      other.release();
    }
  });
});

describe("retries", () => {
  it("a failed send backs off (1, 5, 15, 60 minutes, then hourly) and never gives up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const report = await seedReport();
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      await db.execute(sql`update mail_outbox set next_attempt_at = now() where report_id = ${report.id}`);
      const before = Date.now();
      await drainDue(5);
      const [row] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, report.id));
      expect(row!.state).toBe("queued");
      gaps.push(Math.round((row!.nextAttemptAt.getTime() - before) / 60_000));
    }
    expect(gaps).toEqual([1, 5, 15, 60, 60, 60]);
  });

  it("a row left in 'sending' by a server that died is picked up again after its lease", async () => {
    const report = await seedReport();
    await db.execute(
      sql`update mail_outbox set state = 'sending', next_attempt_at = now() - interval '1 second' where report_id = ${report.id}`,
    );
    await drainDue(5);
    expect(sentIds).toContain(report.publicId);
  });
});

describe("test 15: the drain path and its narrow token", () => {
  it("refuses without MAIL_DRAIN_TOKEN, and with the wrong token", async () => {
    expect((await drain()).status).toBe(401);
    expect((await drain("not-the-token")).status).toBe(401);
  });

  it("refuses the sign-in Worker's INTERNAL_PEOPLE_TOKEN (each token opens one thing)", async () => {
    expect((await drain(PEOPLE_TOKEN)).status).toBe(401);
  });

  it("works with the drain token", async () => {
    const report = await seedReport();
    const res = await drain(DRAIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBeGreaterThanOrEqual(1);
    expect(sentIds).toContain(report.publicId);
  });

  it("also clears the notes on issue reports closed over a year ago (SYC-44 PR 8.1)", async () => {
    const r = await db.execute(sql`
      insert into welfare_reports
        (public_id, kind, reason, severity, photo_state, note, team_note, reporter_device, client_ref,
         state, state_changed_at, submitted_at)
      values (${`vt-${randomBytes(6).toString("hex")}`}, 'content', 'other', 'attention', 'none',
              'Old words', 'Old team words', ${`${DEVICE}-retention`}, ${`ref-${randomBytes(6).toString("hex")}`},
              'done', now() - interval '2 years', now() - interval '2 years')
      returning id
    `);
    const id = (r.rows[0] as { id: number }).id;
    _resetIssueNotesSweepForTests();
    expect((await drain(DRAIN_TOKEN)).status).toBe(200);
    const after = await db.execute(sql`select note, team_note, note_cleared_at from welfare_reports where id = ${id}`);
    expect(after.rows[0]).toMatchObject({ note: null, team_note: null });
    expect((after.rows[0] as { note_cleared_at: unknown }).note_cleared_at).not.toBeNull();
  });

  it("also runs the evening sighting round-up, and its failure doesn't fail the drain", async () => {
    sendDailyRoundUpMock.mockClear();
    let res = await drain(DRAIN_TOKEN);
    expect(sendDailyRoundUpMock).toHaveBeenCalledTimes(1);
    expect(res.body.roundUp).toBe("not_due");

    sendDailyRoundUpMock.mockRejectedValueOnce(new Error("push service down"));
    res = await drain(DRAIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.roundUp).toBe("error");
  });

  it("the round-up never runs for a caller without the drain token", async () => {
    sendDailyRoundUpMock.mockClear();
    expect((await drain("not-the-token")).status).toBe(401);
    expect(sendDailyRoundUpMock).not.toHaveBeenCalled();
  });

  it("answers 503 not_configured when the server has no drain token", async () => {
    delete process.env["MAIL_DRAIN_TOKEN"];
    expect((await drain(DRAIN_TOKEN)).status).toBe(503);
  });

  it("the drain token opens nothing else under /api/internal", async () => {
    for (const p of ["/api/internal/people/allowed", "/api/internal/mail", "/api/internal/mail/drain/x", "/api/internal/anything"]) {
      const gateOn = { PRELAUNCH_GATE: "on" };
      Object.assign(process.env, gateOn);
      const res = await request(app).post(p).set("Authorization", `Bearer ${DRAIN_TOKEN}`);
      expect(res.status, p).toBe(401);
    }
  });

  it("with the pre-launch gate on, the drain token still reaches the drain (and only it)", async () => {
    process.env["PRELAUNCH_GATE"] = "on";
    process.env["PRELAUNCH_SESSION_KEYS"] = Buffer.alloc(32, 9).toString("base64url");
    process.env["PRELAUNCH_TESTER_KEYS"] = "a-tester-key";
    expect((await drain(DRAIN_TOKEN)).status).toBe(200);
    expect((await drain(PEOPLE_TOKEN)).status).toBe(401);
    expect(
      (await request(app).post("/api/internal/mail/drain").set("X-Prelaunch-Key", "a-tester-key")).status,
    ).toBe(401);
  });
});

describe("test 16: the drain fails loudly when an alert is over an hour late", () => {
  it("non-2xx when a welfare_alert has been unsent for over an hour", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await seedReport({ ageMinutes: 61 });
    const res = await drain(DRAIN_TOKEN);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("welfare_alert_overdue");
    expect(res.body.overdue).toBe(1);
  });

  it("2xx when the only unsent alert is younger than an hour", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await seedReport({ ageMinutes: 50 });
    expect((await drain(DRAIN_TOKEN)).status).toBe(200);
  });

  it("an old alert that the drain manages to send is not overdue", async () => {
    await seedReport({ ageMinutes: 90 });
    expect((await drain(DRAIN_TOKEN)).status).toBe(200);
  });
});

describe("T4-5 (SYC-44 PR 4.1): a welfare_alert for a 'Report an issue' row is never sent", () => {
  it("is marked failed wrong_kind, never built with the welfare copy, and the welfare alert beside it still goes", async () => {
    const welfare = await seedReport();
    // Someone queues a welfare_alert for a content row. It is given a
    // position here (the database allows one) so that the KIND, not a missing
    // position, is what stops the email.
    const [content] = await db
      .insert(welfareReportsTable)
      .values({
        publicId: `pub-${randomBytes(10).toString("hex")}`,
        kind: "content",
        reason: "other",
        severity: "attention",
        lat: 37.44,
        lng: 24.94,
        reporterDevice: DEVICE,
        clientRef: randomBytes(6).toString("hex"),
        photoState: "none",
        submittedAt: new Date(),
      })
      .returning();
    await db.insert(mailOutboxTable).values({
      purpose: "welfare_alert",
      reportId: content!.id,
      recipientHash: "0000000000000000",
      payload: { kind: "alert" },
      nextAttemptAt: new Date(Date.now() - 1000),
    });

    await drainDue(10);

    const [row] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, content!.id));
    expect(row!.state).toBe("failed");
    expect(row!.lastError).toBe("wrong_kind");
    expect(row!.sentAt).toBeNull();
    // Only the welfare report's email went out; nothing mentions the content row.
    expect(sentIds).toEqual([welfare.publicId]);
    expect(sentIds).not.toContain(content!.publicId);
  });

  // #170 review, finding 2: the "N unchecked cat reports waiting" email counts
  // open unchecked reports that never got an alert. An issue row never gets a
  // welfare_alert, so unless the count is welfare-only it would be counted for ever.
  it("the 'unchecked reports waiting' count ignores open unchecked content rows", async () => {
    const insertUnchecked = (kind: "welfare" | "content") =>
      db.insert(welfareReportsTable).values({
        publicId: `pub-${randomBytes(10).toString("hex")}`,
        kind,
        ...(kind === "content" ? { reason: "other" } : { lat: 37.44, lng: 24.94 }),
        severity: "attention",
        reporterDevice: DEVICE,
        clientRef: randomBytes(6).toString("hex"),
        photoState: "none",
        submittedAt: new Date(),
        tokenChecked: false,
      });
    const waitingRow = async () => {
      const [row] = await db
        .insert(mailOutboxTable)
        .values({
          purpose: "welfare_alert",
          reportId: null,
          recipientHash: "0000000000000000",
          payload: { kind: "unchecked_waiting" },
          nextAttemptAt: new Date(Date.now() - 1000),
        })
        .returning();
      await drainDue(10);
      const [after] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.id, row!.id));
      return after!;
    };

    // Only a content row is waiting: nothing to say, nothing sent.
    await insertUnchecked("content");
    const none = await waitingRow();
    expect((none.payload as { waiting: number }).waiting).toBe(0);
    expect(sentIds).toEqual([]);

    // A welfare row beside it is counted; the content row still is not.
    await insertUnchecked("welfare");
    const one = await waitingRow();
    expect((one.payload as { waiting: number }).waiting).toBe(1);
    expect(sentIds).toHaveLength(1);
  });
});
