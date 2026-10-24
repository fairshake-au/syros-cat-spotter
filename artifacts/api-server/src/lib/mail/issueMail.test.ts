import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import {
  catsTable,
  db,
  issueDigestRunsTable,
  mailOutboxTable,
  peopleTable,
  photosTable,
  pool,
  welfareReportsTable,
} from "@workspace/db";
import { eq, inArray, like, sql } from "drizzle-orm";

// The drain also sends the evening sighting round-up; stubbed as internalMail.test does.
vi.mock("../sightingRoundUp", () => ({
  sendDailyRoundUp: vi.fn(async () => ({ status: "not_due" as const })),
  opportunisticRoundUp: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// T5-15 needs the shared counter to fail on demand: the wrapper passes every
// call through to the real `consume`, unless the switch is on, when it runs a
// statement that errors INSIDE the caller's transaction (the real hazard).
const counter = vi.hoisted(() => ({ fail: false }));
vi.mock("../limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../limits")>();
  const { db: pool } = await import("@workspace/db");
  const { sql: s } = await import("drizzle-orm");
  return {
    ...actual,
    consume: async (...args: Parameters<typeof actual.consume>) => {
      if (counter.fail) await (args[4] ?? pool).execute(s`select 1 / 0`);
      return actual.consume(...args);
    },
  };
});

import app from "../../app";
import { buildIssueAlert, buildIssueDigest } from "../issues/alertEmail";
import {
  claimDue,
  drainDue,
  enqueueIssueAlert,
  ISSUE_ALERTS_PER_HOUR,
  sendIssueDigestIfDue,
  settleOutbox,
} from "./outbox";
import { mailHealth } from "../welfareQueue";
import { NEVER_SHED_PURPOSES } from "./send";

// SYC-44 PR 5.2 (plan T5-13 to T5-18): the team's issue emails, their cap,
// the daily digest, and the first mail shedding.

const DEVICE = `vitest-issuemail-${randomBytes(4).toString("hex")}`;
const DRAIN_TOKEN = randomBytes(24).toString("base64url");
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

type Sent = {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: string; content_id?: string }[];
};
let sent: Sent[] = [];
let resendDown = false;

function installFakeResend() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (resendDown) return new Response("down", { status: 503 });
      sent.push(JSON.parse(String(init?.body)) as Sent);
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
    }),
  );
}

let cat: { id: number; name: string };
let photoId: number;
const photoIds: number[] = [];
const catIds: number[] = [];

async function seedPhoto(bytes: Buffer | null = PHOTO): Promise<number> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: bytes ? bytes.toString("base64") : "", mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  photoIds.push(p!.id);
  return p!.id;
}

async function seedCat(name: string, primaryPhotoId: number) {
  const [c] = await db
    .insert(catsTable)
    .values({ name, primaryPhotoId, lat: 37.44, lng: 24.94, discovererDeviceId: DEVICE })
    .returning({ id: catsTable.id, name: catsTable.name });
  catIds.push(c!.id);
  return c!;
}

/** A "Report an issue" row, written straight to the table. */
async function seedIssue(
  opts: { reason?: string; note?: string | null; photoId?: number | null; catId?: number; state?: string; ageMinutes?: number } = {},
) {
  const createdAt = new Date(Date.now() - (opts.ageMinutes ?? 0) * 60_000);
  const reason = opts.reason ?? "photo_private";
  const photo = opts.photoId === undefined ? photoId : opts.photoId;
  const [r] = await db
    .insert(welfareReportsTable)
    .values({
      publicId: `pub-${randomBytes(10).toString("hex")}`,
      kind: "content",
      severity: "attention",
      reason,
      note: opts.note === undefined ? "the note" : opts.note,
      photoId: photo,
      catId: opts.catId ?? cat.id,
      state: opts.state ?? "new",
      reporterDevice: DEVICE,
      clientRef: randomBytes(6).toString("hex"),
      photoState: "none",
      createdAt,
      submittedAt: createdAt,
    })
    .returning();
  return r!;
}

async function seedWelfare(opts: { ageMinutes?: number } = {}) {
  const createdAt = new Date(Date.now() - (opts.ageMinutes ?? 0) * 60_000);
  const [report] = await db
    .insert(welfareReportsTable)
    .values({
      publicId: `pub-${randomBytes(10).toString("hex")}`,
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

/** Queue the "Photo hidden" alert for a report, the way PR 5.1 will: inside its transaction. */
async function queueAlert(reportId: number) {
  return db.transaction((tx) => enqueueIssueAlert(tx, reportId));
}

async function cleanup() {
  await db.execute(sql`delete from mail_outbox`);
  await db.execute(sql`delete from issue_digest_runs`);
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.reporterDevice, `${DEVICE}%`));
  if (catIds.length) await db.delete(catsTable).where(inArray(catsTable.id, catIds));
  if (photoIds.length) await db.delete(photosTable).where(inArray(photosTable.id, photoIds));
  catIds.length = 0;
  photoIds.length = 0;
}

const savedEnv = { ...process.env };
beforeAll(cleanup);
beforeEach(async () => {
  await cleanup();
  sent = [];
  resendDown = false;
  counter.fail = false;
  process.env["RESEND_API_KEY"] = "re_test_not_real";
  process.env["WELFARE_ALERT_TO"] = "alerts@example.org";
  process.env["MAIL_DRAIN_TOKEN"] = DRAIN_TOKEN;
  delete process.env["MAIL_DAILY_BUDGET"];
  delete process.env["MAIL_NEVER_SHED_RESERVE"];
  installFakeResend();
  photoId = await seedPhoto();
  cat = await seedCat(`Mimi-${randomBytes(3).toString("hex")}`, photoId);
});
afterEach(async () => {
  await settleOutbox();
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("T5-13: the Photo hidden email", () => {
  const report = {
    publicId: "9f3c2a71-4b1e-4c8a-9d2e-7a1b2c3d4e5f",
    reason: "photo_private",
    note: `<script>alert("x")</script> & 'quotes'\nsecond line`,
    createdAt: new Date("2026-10-14T10:00:00Z"),
    submittedAt: new Date("2026-10-14T10:00:00Z"),
    // Things the builder must never be able to print, even if handed a whole row.
    reporterDevice: "DEVICE-SECRET-123",
    reporterContactId: 4242,
  };
  const catName = `Mimi <b>"The Cat"</b> & co`;

  it("has the fixed subject, the reason's label, the escaped note, the cat with a team link, and the photo attached inline", () => {
    const out = buildIssueAlert(report, { id: 7, name: catName }, { bytes: PHOTO, mime: "image/jpeg" });
    expect(out.subject).toBe("Photo hidden: possible private or offensive content");
    expect(out.text).toContain("Why: It shows a person or a private place");
    expect(out.text).toMatch(/Team page: https:\/\/[^\s]+\/api\/team\/cats\/7/);
    expect(out.attachments).toEqual([
      { filename: "reported-photo-9f3c2a71.jpg", content: PHOTO, contentId: "reported-photo" },
    ]);
    expect(out.html).toContain('<img src="cid:reported-photo"');
    expect(out.html).toMatch(/<a href="https:\/\/[^"]+\/api\/team\/cats\/7"[^>]*>/);
  });

  it("escapes every typed string: the note and the cat's name", () => {
    const out = buildIssueAlert(report, { id: 7, name: catName }, { bytes: PHOTO, mime: "image/jpeg" });
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<b>");
    expect(out.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;\nsecond line");
    expect(out.html).toContain("Mimi &lt;b&gt;&quot;The Cat&quot;&lt;/b&gt; &amp; co");
    expect(out.html).toContain("white-space:pre-wrap");
    // Nothing typed goes into the subject.
    expect(out.subject).not.toContain("script");
  });

  it("carries no reporter details of any kind", () => {
    const out = buildIssueAlert(report, { id: 7, name: catName }, { bytes: PHOTO, mime: "image/jpeg" });
    for (const part of [out.subject, out.text, out.html, JSON.stringify(out.attachments?.map((a) => a.filename))]) {
      expect(part).not.toContain("DEVICE-SECRET-123");
      expect(part).not.toContain("4242");
      expect(part).not.toMatch(/contact details|reply from the dashboard|@/i);
    }
  });

  it("says so in a line when the photo's bytes are gone, and attaches nothing", () => {
    const out = buildIssueAlert(report, { id: 7, name: "Mimi" }, null);
    expect(out.attachments).toBeUndefined();
    expect(out.html).not.toContain("cid:");
    expect(out.text).toContain("The reported photo is no longer available");
    expect(out.html).toContain("The reported photo is no longer available");
  });

  it("goes through the outbox to WELFARE_ALERT_TO with the real photo bytes attached", async () => {
    const r = await seedIssue({ note: "<i>that is my son</i>" });
    expect(await queueAlert(r.id)).toBe("alert");
    const result = await drainDue(10);
    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, shed: 0 });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toEqual(["alerts@example.org"]);
    expect(mail.subject).toBe("Photo hidden: possible private or offensive content");
    expect(mail.html).toContain("&lt;i&gt;that is my son&lt;/i&gt;");
    expect(mail.html).toContain(cat.name);
    expect(mail.attachments).toHaveLength(1);
    expect(Buffer.from(mail.attachments![0]!.content, "base64").equals(PHOTO)).toBe(true);
    expect(mail.attachments![0]!.content_id).toBe("reported-photo");
  });

  it("sends with a line instead of an attachment when the photo's bytes have been deleted", async () => {
    const gone = await seedPhoto(null);
    const r = await seedIssue({ photoId: gone });
    await queueAlert(r.id);
    await drainDue(10);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toBeUndefined();
    expect(sent[0]!.text).toContain("no longer available");
  });

  it("T16 (SYC-462): a photo removed for good is sent with the line, never an attachment", async () => {
    const photoId = await seedPhoto();
    const [remover] = await db
      .insert(peopleTable)
      .values({ email: `vitest-issuemail-remover-${Date.now()}@example.com`, name: "Remover", addedBy: "cli:vitest" })
      .returning({ id: peopleTable.id });
    await db
      .update(photosTable)
      .set({ data: null, removedAt: sql`now()`, removedBy: remover!.id, removedReason: "SYC-462" })
      .where(eq(photosTable.id, photoId));
    const r = await seedIssue({ photoId });
    await queueAlert(r.id);
    await drainDue(10);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toBeUndefined();
    expect(sent[0]!.text).toContain("no longer available");
  });

  it("a non-content row queued as an issue_alert is marked failed wrong_kind and never sent", async () => {
    const welfare = await seedWelfare();
    await db.execute(sql`delete from mail_outbox`);
    await db.insert(mailOutboxTable).values({
      purpose: "issue_alert",
      reportId: welfare.id,
      recipientHash: "0000000000000000",
      payload: { kind: "alert" },
    });
    const result = await drainDue(10);
    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(sent).toHaveLength(0);
    const [row] = await db.select().from(mailOutboxTable);
    expect(row).toMatchObject({ state: "failed", lastError: "wrong_kind" });
  });
});

describe("T5-14: issue alerts never sit in front of a welfare alert", () => {
  it("with 500 issue alerts queued first, a welfare_alert queued after them goes in the first drain batch", async () => {
    const r = await seedIssue({ ageMinutes: 120 });
    await db.insert(mailOutboxTable).values(
      Array.from({ length: 500 }, (_, i) => ({
        purpose: "issue_alert",
        reportId: r.id,
        recipientHash: "0000000000000000",
        payload: { kind: "alert" },
        // Older than the welfare alert, every one of them due.
        nextAttemptAt: new Date(Date.now() - (200 - i / 10) * 60_000),
        createdAt: new Date(Date.now() - 200 * 60_000),
      })),
    );
    const welfare = await seedWelfare();

    const result = await drainDue(25);
    expect(result.claimed).toBe(25);
    const [row] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, welfare.id));
    expect(row!.state).toBe("sent");
    expect(sent.some((m) => m.subject.startsWith("Urgent cat report"))).toBe(true);
    // The 24 other places in the batch went to issue alerts, oldest first.
    expect(sent.filter((m) => m.subject.startsWith("Photo hidden"))).toHaveLength(24);
  });

  // SYC-537. Postgres 16 always de-duplicates the limited subquery first, so
  // no setting makes the old `id in (select … limit n for update skip locked)`
  // over-claim here (tried: hash/merge join, material, hashagg, sort off, cost
  // zeroing, generic plan). CI once saw 501 for a limit of 25, so the claim is
  // pinned as a CTE and checked under every join shape the planner can be held to.
  const PLANS = [
    "",
    "set local enable_hashjoin = off",
    "set local enable_hashjoin = off; set local enable_mergejoin = off; set local enable_material = off",
    "set local enable_hashjoin = off; set local enable_mergejoin = off; set local enable_hashagg = off; set local enable_sort = off",
    "set local enable_nestloop = off",
    "set local enable_seqscan = off; set local enable_indexscan = off",
  ];
  it.each(PLANS)("the claim never takes more than its limit, whatever the plan (%s)", async (settings) => {
    const r = await seedIssue({ ageMinutes: 120 });
    await db.insert(mailOutboxTable).values(
      Array.from({ length: 500 }, (_, i) => ({
        purpose: "issue_alert",
        reportId: r.id,
        recipientHash: "0000000000000000",
        payload: { kind: "alert" },
        nextAttemptAt: new Date(Date.now() - (200 - i / 10) * 60_000),
      })),
    );
    const welfare = await seedWelfare();

    const claimed = await db.transaction(async (tx) => {
      for (const stmt of settings.split(";").filter((x) => x.trim())) await tx.execute(sql.raw(stmt));
      return claimDue(25, undefined, tx);
    });
    expect(claimed).toHaveLength(25);
    expect(claimed.some((row) => row.reportId === welfare.id)).toBe(true);
    const leased = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.state, "sending"));
    expect(leased).toHaveLength(25);
  });

  it("restore links are in the first group too, and the group is the never-shed list", () => {
    expect(NEVER_SHED_PURPOSES).toEqual(["welfare_alert", "restore_link"]);
  });
});

describe("T5-15: at most 10 Photo hidden alerts an hour, island-wide", () => {
  it("the 11th in an hour is not enqueued; the report is left for the digest", async () => {
    const results: string[] = [];
    for (let i = 0; i < ISSUE_ALERTS_PER_HOUR + 2; i++) {
      const r = await seedIssue();
      results.push(await queueAlert(r.id));
    }
    expect(results.slice(0, 10)).toEqual(Array(10).fill("alert"));
    expect(results.slice(10)).toEqual(["digest", "digest"]);
    const rows = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.purpose, "issue_alert"));
    expect(rows).toHaveLength(10);
  });

  it("a counter that errors folds the report into the digest, and does not poison the report's transaction", async () => {
    const r = await seedIssue();
    counter.fail = true;
    const outcome = await db.transaction(async (tx) => {
      const out = await enqueueIssueAlert(tx, r.id);
      // The caller's own work after the failed counter still commits.
      await tx.update(welfareReportsTable).set({ teamNote: "still saved" }).where(eq(welfareReportsTable.id, r.id));
      return out;
    });
    counter.fail = false;
    expect(outcome).toBe("digest");
    const [after] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.id, r.id));
    expect(after!.teamNote).toBe("still saved");
    expect(await db.select().from(mailOutboxTable)).toHaveLength(0);
  });
});

describe("T5-16: the digest", () => {
  const athensToday = () =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(),
    );

  it("is queued only if there are open issue rows, and a quiet day claims nothing", async () => {
    // TEMP SYC-537 diagnostic
    console.log("STRAYS", JSON.stringify((await db.execute(sql`select reporter_device, reason, state, created_at, count(*)::int n from welfare_reports where kind = 'content' and state in ('new','looking') group by 1,2,3,4`)).rows));
    expect(await sendIssueDigestIfDue()).toBe("nothing_waiting");
    expect(await db.select().from(issueDigestRunsTable)).toHaveLength(0);
    await seedIssue({ state: "done" });
    expect(await sendIssueDigestIfDue()).toBe("nothing_waiting");
    await seedIssue();
    expect(await sendIssueDigestIfDue()).toBe("queued");
  });

  it("goes once a day even with two drains at the same moment, lists reasons and cats, and carries no notes", async () => {
    await seedIssue({ reason: "wrong_name", note: "TOP-SECRET-NOTE-1" });
    await seedIssue({ reason: "wrong_name", note: "TOP-SECRET-NOTE-4" });
    await seedIssue({ reason: "cat_died", note: "TOP-SECRET-NOTE-2" });
    const other = await seedCat(`Other-${randomBytes(3).toString("hex")}`, photoId);
    await seedIssue({ reason: "wrong_name", note: "TOP-SECRET-NOTE-3", catId: other.id });

    const tries = await Promise.all([sendIssueDigestIfDue(), sendIssueDigestIfDue(), sendIssueDigestIfDue()]);
    expect(tries.filter((t) => t === "queued")).toHaveLength(1);
    expect(tries.filter((t) => t === "already_sent_today")).toHaveLength(2);

    // And through the real drain route, twice at once, plus the queue is drained.
    const call = () => request(app).post("/api/internal/mail/drain").set("Authorization", `Bearer ${DRAIN_TOKEN}`);
    const [a, b] = await Promise.all([call(), call()]);
    expect([a.status, b.status]).toEqual([200, 200]);

    const digests = sent.filter((m) => m.subject.startsWith("Issue reports:"));
    expect(digests).toHaveLength(1);
    const mail = digests[0]!;
    expect(mail.subject).toBe("Issue reports: 4 waiting");
    expect(mail.text).toContain(`The name is wrong, or not OK (2): ${cat.name}`);
    expect(mail.text).toContain("This cat has died");
    expect(mail.text).toContain(cat.name);
    expect(mail.text).toContain(other.name);
    expect(mail.text).toMatch(/\/api\/team\/cats\/\d+/);
    for (const part of [mail.text, mail.html]) expect(part).not.toContain("TOP-SECRET-NOTE");
    const runs = await db.select().from(issueDigestRunsTable);
    expect(runs.map((r) => r.day)).toEqual([athensToday()]);
    expect(runs[0]!.sentAt).not.toBeNull();

    // A later drain the same day sends no second one.
    await call();
    expect(sent.filter((m) => m.subject.startsWith("Issue reports:"))).toHaveLength(1);
  });

  it("a failed send is retried by the outbox, not lost, and the day stays claimed", async () => {
    await seedIssue();
    expect(await sendIssueDigestIfDue()).toBe("queued");
    resendDown = true;
    expect(await drainDue(10)).toMatchObject({ retry: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    let [row] = await db.select().from(mailOutboxTable);
    expect(row!.state).toBe("queued");
    expect(await sendIssueDigestIfDue()).toBe("already_sent_today");

    resendDown = false;
    await db.execute(sql`update mail_outbox set next_attempt_at = now()`);
    expect(await drainDue(10)).toMatchObject({ sent: 1 });
    expect(sent.map((m) => m.subject)).toEqual(["Issue reports: 1 waiting"]);
    [row] = await db.select().from(mailOutboxTable);
    expect(row!.state).toBe("sent");
    const [run] = await db.select().from(issueDigestRunsTable);
    expect(run!.sentAt).not.toBeNull();
    expect(await db.select().from(mailOutboxTable)).toHaveLength(1);
  });

  it("the day is claimed together with its outbox row: if the outbox insert fails, the day is not taken", async () => {
    await seedIssue();
    // An outbox insert that fails (a lease column check) must roll the claim back too.
    await db.execute(sql`alter table mail_outbox add constraint t5_16_refuse check (purpose <> 'issue_alert')`);
    try {
      await expect(sendIssueDigestIfDue()).rejects.toThrow();
    } finally {
      await db.execute(sql`alter table mail_outbox drop constraint t5_16_refuse`);
    }
    expect(await db.select().from(issueDigestRunsTable)).toHaveLength(0);
    expect(await sendIssueDigestIfDue()).toBe("queued");
  });
});

describe("T5-17: shedding at the daily budget", () => {
  /** n emails already sent today, as the budget counts them. */
  async function seedSentToday(n: number) {
    await db.insert(mailOutboxTable).values(
      Array.from({ length: n }, (_, i) => ({
        purpose: "report_ack",
        recipientHash: "0000000000000000",
        payload: {},
        state: "sent",
        providerMessageId: `re_seed_${i}_${randomBytes(3).toString("hex")}`,
        sentAt: new Date(),
      })),
    );
  }

  it("at the budget less the reserve, issue_alert is shed and welfare_alert still sends", async () => {
    process.env["MAIL_DAILY_BUDGET"] = "10";
    process.env["MAIL_NEVER_SHED_RESERVE"] = "4";
    await seedSentToday(6);
    const issue = await seedIssue();
    await queueAlert(issue.id);
    const welfare = await seedWelfare();

    const result = await drainDue(25);
    expect(result).toMatchObject({ claimed: 2, sent: 1, shed: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/^Urgent cat report/);
    const [shedRow] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, issue.id));
    expect(shedRow).toMatchObject({ state: "failed", lastError: "shed" });
    const [welfareRow] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, welfare.id));
    expect(welfareRow!.state).toBe("sent");
  });

  it("under the threshold, issue_alert sends as normal", async () => {
    process.env["MAIL_DAILY_BUDGET"] = "10";
    process.env["MAIL_NEVER_SHED_RESERVE"] = "4";
    await seedSentToday(5);
    const issue = await seedIssue();
    await queueAlert(issue.id);
    expect(await drainDue(25)).toMatchObject({ sent: 1, shed: 0 });
  });

  it("the budget counts as the batch sends: the first alert goes, the next is shed", async () => {
    process.env["MAIL_DAILY_BUDGET"] = "10";
    process.env["MAIL_NEVER_SHED_RESERVE"] = "4";
    await seedSentToday(5);
    for (let i = 0; i < 2; i++) await queueAlert((await seedIssue()).id);
    expect(await drainDue(25)).toMatchObject({ sent: 1, shed: 1 });
  });

  it("defaults to 100 a day with 20 held back, and a nonsense setting falls back to them", async () => {
    process.env["MAIL_DAILY_BUDGET"] = "lots";
    process.env["MAIL_NEVER_SHED_RESERVE"] = "";
    await seedSentToday(79);
    const a = await seedIssue();
    await queueAlert(a.id);
    expect(await drainDue(25)).toMatchObject({ sent: 1, shed: 0 });
    const b = await seedIssue();
    await queueAlert(b.id);
    expect(await drainDue(25)).toMatchObject({ sent: 0, shed: 1 });
  });

  it("a shed row doesn't trip the mail banner, but a real failure does", async () => {
    process.env["MAIL_DAILY_BUDGET"] = "10";
    process.env["MAIL_NEVER_SHED_RESERVE"] = "4";
    await seedSentToday(6);
    const issue = await seedIssue();
    await queueAlert(issue.id);
    await drainDue(25);
    const [shedRow] = await db.select().from(mailOutboxTable).where(eq(mailOutboxTable.reportId, issue.id));
    expect(shedRow!.lastError).toBe("shed");
    expect(await mailHealth()).toEqual({ failed: 0, late: 0 });

    // The same open report with a row that failed for a real reason does count.
    await db.update(mailOutboxTable).set({ lastError: "wrong_kind" }).where(eq(mailOutboxTable.id, shedRow!.id));
    expect(await mailHealth()).toEqual({ failed: 1, late: 0 });
  });
});

describe("T5-18: an issue alert never waits for a photo", () => {
  it("is due the moment it is queued (no ten-minute wait), goes in the first drain, and never mentions an upload", async () => {
    const r = await seedIssue();
    const before = Date.now();
    await queueAlert(r.id);
    const [row] = await db.select().from(mailOutboxTable);
    expect(row!.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(await drainDue(10)).toMatchObject({ sent: 1 });
    const text = `${sent[0]!.text}\n${sent[0]!.html}`;
    expect(text).not.toMatch(/still uploading|photo is still|has now arrived/i);
  });

  it("is enqueued by enqueueIssueAlert with no welfare-style photo follow-up row", async () => {
    const r = await seedIssue();
    await queueAlert(r.id);
    const rows = await db.select().from(mailOutboxTable);
    expect(rows.map((x) => (x.payload as { kind: string }).kind)).toEqual(["alert"]);
  });
});

describe("the digest builder", () => {
  it("lists reasons and cats and says nothing typed", () => {
    const out = buildIssueDigest(2, [
      { reason: "wrong_name", catId: 3, catName: "Mimi <b>", count: 2 },
      { reason: "other", catId: null, catName: null, count: 1 },
    ]);
    expect(out.subject).toBe("Issue reports: 2 waiting");
    expect(out.html).toContain("Mimi &lt;b&gt;");
    expect(out.html).not.toContain("<b>");
    expect(out.text).toContain("no longer in the catalogue");
  });
});
