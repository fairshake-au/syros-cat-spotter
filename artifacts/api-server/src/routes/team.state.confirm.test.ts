import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { addPerson, db, pool, reportStateEventsTable, welfareReportsTable } from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { addressFingerprint } from "../lib/mail/fingerprint";
import { REPORT_OUTCOME_CLOSE, REPORT_OUTCOME_LEAD } from "../lib/mail/reportTemplates";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-515 B2: Done and Nothing needed ask first when an email would go.

const SUSAN = "vitest-confirm-susan@example.com";
const KEY = "vitest-confirm-key-0123456789abcdef-0123456789";
const REPORTER = "vitest-confirm-reporter@example.org";
const handoffKey = makeKey();
let cookie: string;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  // Tests only: nothing here may ever reach a real provider.
  delete process.env["RESEND_API_KEY"];
  delete process.env["RESEND_NEWS_API_KEY"];
  await removeTestPerson(SUSAN);
  const susan = await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest" });
  cookie = await signInThroughHandoff(app, handoffKey, susan.id);
});

async function wipe() {
  await clearWelfareTables();
  await db.execute(sql`delete from mail_outbox where purpose in ('public_verify', 'report_ack', 'report_outcome')`);
  await db.execute(sql`delete from email_contacts where purpose = 'report'`);
  await db.execute(sql`delete from email_suppressions`);
}

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await wipe();
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await wipe();
  await removeTestPerson(SUSAN);
  await pool.end();
});

async function withContact(status: "pending" | "confirmed") {
  const r = await seedReport({ state: "new" });
  const [c] = (
    await db.execute(sql`
      insert into email_contacts (purpose, address, address_hmac, address_mask, device_id, status, confirmed_at)
      values ('report', ${REPORTER}, ${addressFingerprint("report", REPORTER)}, 'v•••@example.org', 'vitest-confirm-dev', ${status},
              ${status === "confirmed" ? sql`now()` : null})
      returning id
    `)
  ).rows as { id: number }[];
  await db.execute(sql`update welfare_reports set reporter_contact_id = ${c!.id} where id = ${r.id}`);
  return { ...r, contactId: c!.id };
}

const form = (publicId: string, body: Record<string, string>) =>
  request(app)
    .post(`/api/team/reports/${publicId}/state`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .type("form")
    .send(body);

const stateOf = async (id: number) =>
  (await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.id, id)))[0]!.state;
const events = (id: number) => db.select().from(reportStateEventsTable).where(eq(reportStateEventsTable.reportId, id));
const outbox = async () =>
  (await db.execute(sql`select payload from mail_outbox where purpose = 'report_outcome'`)).rows as {
    payload: Record<string, unknown>;
  }[];

describe("SYC-515: closing a report that would email the reporter asks first", () => {
  it("will_send: first post shows the page, changes nothing, queues nothing", async () => {
    const r = await withContact("confirmed");
    const res = await form(r.publicId, { from: "new", to: "done" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Close this report and email the person who sent it?");
    expect(res.text).toContain(REPORT_OUTCOME_LEAD);
    expect(res.text).toContain(REPORT_OUTCOME_CLOSE);
    expect(res.text).toContain("Close and send the email");
    expect(res.text).toContain("Back to the Queue (nothing changed)");
    expect(res.text).toContain(`href="/api/team?open=${r.publicId}#r-${r.publicId}"`);
    expect(res.text).toContain('name="reporterSentence"');
    expect(res.text).toContain('name="expect" value="will_send"');
    expect(res.text).not.toContain(REPORTER);
    expect(await stateOf(r.id)).toBe("new");
    expect(await events(r.id)).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });

  it("will_send on Nothing needed: no line box", async () => {
    const r = await withContact("confirmed");
    const res = await form(r.publicId, { from: "new", to: "nothing_needed" });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('name="reporterSentence"');
  });

  it("will_send: confirming moves it and queues one email carrying the sentence", async () => {
    const r = await withContact("confirmed");
    const res = await form(r.publicId, {
      from: "new",
      to: "done",
      confirm: "1",
      expect: "will_send",
      reporterSentence: "Thanks",
    });
    expect(res.status).toBe(303);
    expect(await stateOf(r.id)).toBe("done");
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload["teamSentence"]).toBe("Thanks");
  });

  it("held: the page has no sentence box and says why; confirming moves it and queues nothing", async () => {
    const r = await withContact("pending");
    const res = await form(r.publicId, { from: "new", to: "done" });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('name="reporterSentence"');
    expect(res.text).toContain("They haven&#39;t confirmed their email yet.");
    expect(res.text).toContain("Close the report");
    const go = await form(r.publicId, { from: "new", to: "done", confirm: "1", expect: "held" });
    expect(go.status).toBe(303);
    expect(await stateOf(r.id)).toBe("done");
    expect(await outbox()).toHaveLength(0);
  });

  it("may_not_arrive: the page says the last email didn't arrive", async () => {
    const r = await withContact("confirmed");
    await db.execute(sql`
      insert into email_suppressions (address_hmac, reason, scope)
      values (${addressFingerprint("all", REPORTER)}, 'bounce', 'all')
    `);
    const res = await form(r.publicId, { from: "new", to: "done" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Our last email to them didn&#39;t arrive, so this one may not either.");
    expect(res.text).toContain('name="reporterSentence"');
  });

  it("none: one tap, as today", async () => {
    const r = await seedReport({ state: "new" });
    const res = await form(r.publicId, { from: "new", to: "done" });
    expect(res.status).toBe(303);
    expect(await stateOf(r.id)).toBe("done");
  });

  it("already_sent: one tap, as today", async () => {
    const r = await withContact("confirmed");
    await form(r.publicId, { from: "new", to: "done", confirm: "1", expect: "will_send" });
    await form(r.publicId, { from: "done", to: "looking" });
    const res = await form(r.publicId, { from: "looking", to: "done" });
    expect(res.status).toBe(303);
    expect(await stateOf(r.id)).toBe("done");
    expect(await outbox()).toHaveLength(1);
  });

  it("Looking at it never asks", async () => {
    const r = await withContact("confirmed");
    const res = await form(r.publicId, { from: "new", to: "looking" });
    expect(res.status).toBe(303);
  });

  it("Review Focus 3: the address is confirmed while the 'held' page is open; pressing the button sends nothing", async () => {
    const r = await withContact("pending");
    const page = await form(r.publicId, { from: "new", to: "done" });
    expect(page.text).toContain('name="expect" value="held"');
    await db.execute(sql`update email_contacts set status = 'confirmed', confirmed_at = now() where id = ${r.contactId}`);
    const res = await form(r.publicId, { from: "new", to: "done", confirm: "1", expect: "held" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team?changed=${r.publicId}&open=${r.publicId}#r-${r.publicId}`);
    expect(await stateOf(r.id)).toBe("new");
    expect(await events(r.id)).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });

  it("confirmed contact with no device: one tap, no page, no outbox row", async () => {
    const r = await withContact("confirmed");
    await db.execute(sql`update email_contacts set device_id = null where id = ${r.contactId}`);
    const res = await form(r.publicId, { from: "new", to: "done" });
    expect(res.status).toBe(303);
    expect(await stateOf(r.id)).toBe("done");
    expect(await outbox()).toHaveLength(0);
  });

  it("a confirm press without expect is a 400 and changes nothing", async () => {
    const r = await withContact("confirmed");
    const res = await form(r.publicId, { from: "new", to: "done", confirm: "1" });
    expect(res.status).toBe(400);
    expect(await stateOf(r.id)).toBe("new");
    expect(await outbox()).toHaveLength(0);
  });

  it("a JSON caller acts in one step, as before", async () => {
    const r = await withContact("confirmed");
    const res = await request(app)
      .post(`/api/team/reports/${r.publicId}/state`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ from: "new", to: "done" });
    expect(res.status).toBe(200);
    expect(await stateOf(r.id)).toBe("done");
    expect(await outbox()).toHaveLength(1);
  });
});
