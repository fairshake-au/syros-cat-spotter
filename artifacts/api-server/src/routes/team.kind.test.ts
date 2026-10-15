import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, like, sql } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  markLeft,
  observationsTable,
  photosTable,
  pool,
  reportStateEventsTable,
  welfareReportsTable,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { tieReportToCat } from "../lib/welfareTie";
import type { WelfareQueue } from "../lib/welfareQueue";

// SYC-44 PR 4.1 (plan Slice 4): the welfare queue made safe for "Report an
// issue" rows (welfare_reports.kind = 'content'). T4-1 to T4-4. The rows are
// seeded straight into the table: the issue route arrives in Slice 5.
//
// The mutation probes for these tests are in the PR description.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-kind-${RUN}-`;
const SUSAN = `vitest-kind-susan-${RUN}@example.com`;
const KEY = "vitest-kind-key-0123456789abcdef-0123456789ab";
const handoffKey = makeKey();

let cookie: string;
let susanId: string;
let n = 0;

async function cleanup() {
  await clearWelfareTables();
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function newPhoto(): Promise<number> {
  const k = ++n;
  const [p] = await db
    .insert(photosTable)
    .values({
      publicId: `${PREFIX}photo-${k}`,
      data: Buffer.from(`fake ${k}`).toString("base64"),
      mime: "image/jpeg",
    })
    .returning({ id: photosTable.id });
  return p!.id;
}

async function newCat(): Promise<number> {
  const k = ++n;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${k}`,
      description: "",
      primaryPhotoId: await newPhoto(),
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

const form = (path: string) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).type("form");

const moveState = (publicId: string, from: string, to: string) =>
  form(`/api/team/reports/${publicId}/state`).send({ from, to });

const tie = (publicId: string, catId: number, expected: number | null) =>
  form(`/api/team/reports/${publicId}/cat`).send({
    catId: String(catId),
    expectedCatId: expected === null ? "" : String(expected),
  });

const reportRow = async (publicId: string) =>
  (await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.publicId, publicId)))[0]!;

/** Observations that point at a "Report an issue" row, of either report kind. */
async function observationsAboutContentRows(): Promise<{ id: number; kind: string }[]> {
  const res = await db.execute(sql`
    select o.id, o.kind
      from observations o
      join welfare_reports r on o.value->>'reportId' = r.id::text
     where o.kind in ('welfare_report', 'welfare_outcome')
       and r.kind = 'content'`);
  return res.rows as { id: number; kind: string }[];
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
});

// Spec test 8, the structural half: whatever a test above did, no
// `welfare_report` (or `welfare_outcome`) observation was ever written for a
// content row. Checked after every test in this file.
afterEach(async () => {
  expect(await observationsAboutContentRows()).toEqual([]);
});

afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const getJson = async () => {
  const res = await request(app).get("/api/team/reports").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return { text: res.text, body: res.body as WelfareQueue };
};
const getHtml = async () => {
  const res = await request(app).get("/api/team").set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.text;
};

describe("T4-1: content rows never show in the welfare queue", () => {
  it("the queue's JSON and HTML are byte-for-byte what they were without them", async () => {
    // Half-minute offsets, so "N minutes ago" can't flip between two reads.
    const JPEG = { mime: "image/jpeg", bytes: Buffer.from("fake jpeg bytes") };
    await seedReport({ publicId: `${PREFIX}w-open`, sentMinutesAgo: 30.5 });
    await seedReport({ publicId: `${PREFIX}w-urgent`, severity: "urgent", isLitter: true, sentMinutesAgo: 90.5, photo: JPEG });
    await seedReport({ publicId: `${PREFIX}w-looking`, state: "looking", sentMinutesAgo: 150.5 });
    await seedReport({ publicId: `${PREFIX}w-done`, state: "done", sentMinutesAgo: 600.5 });
    await seedReport({ publicId: `${PREFIX}w-nothing`, state: "nothing_needed", sentMinutesAgo: 700.5 });
    await seedReport({ publicId: `${PREFIX}w-unchecked`, tokenChecked: false, sentMinutesAgo: 45.5 });
    await seedReport({ publicId: `${PREFIX}w-draft`, isDraft: true });
    await seedReport({ publicId: `${PREFIX}w-draft-unchecked`, isDraft: true, tokenChecked: false });
    await seedReport({ publicId: `${PREFIX}w-mail`, sentMinutesAgo: 20.5, mail: { state: "sent" } });

    const beforeJson = await getJson();
    const beforeHtml = await getHtml();
    expect(beforeJson.body.open.length).toBeGreaterThan(0);

    // Now every shape of content row: open, in progress, closed, unchecked,
    // a draft, tied to a cat, with a photo, with a team note and a sent email.
    const cat = await newCat();
    const photoId = await newPhoto();
    await seedReport({ publicId: `${PREFIX}c-open`, kind: "content", reason: "photo_private", photoId, sentMinutesAgo: 1.5 });
    await seedReport({ publicId: `${PREFIX}c-looking`, kind: "content", reason: "wrong_name", catId: cat, state: "looking", sentMinutesAgo: 200.5 });
    await seedReport({ publicId: `${PREFIX}c-done`, kind: "content", reason: "cat_died", catId: cat, state: "done", sentMinutesAgo: 900.5 });
    await seedReport({ publicId: `${PREFIX}c-nothing`, kind: "content", reason: "other", state: "nothing_needed", sentMinutesAgo: 905.5 });
    await seedReport({ publicId: `${PREFIX}c-unchecked`, kind: "content", reason: "wrong_info", tokenChecked: false, sentMinutesAgo: 5.5 });
    await seedReport({ publicId: `${PREFIX}c-draft`, kind: "content", reason: "other", isDraft: true });
    // The unchecked lists and counts have queries of their own (#170 review, finding 1).
    await seedReport({ publicId: `${PREFIX}c-draft-unchecked`, kind: "content", reason: "other", isDraft: true, tokenChecked: false });
    await seedReport({ publicId: `${PREFIX}c-note`, kind: "content", reason: "location_revealing", teamNote: "Checked", teamNoteBy: susanId, sentMinutesAgo: 10.5, mail: { state: "sent" } });
    const contentRows = await db
      .select({ id: welfareReportsTable.id })
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.kind, "content"));
    expect(contentRows).toHaveLength(8);
    // The fixture really has what the unchecked queries must ignore: an open
    // unchecked content row (c-unchecked) and an unchecked content draft.
    const uncheckedContent = await db
      .select({ publicId: welfareReportsTable.publicId })
      .from(welfareReportsTable)
      .where(sql`kind = 'content' and token_checked = false and state in ('new', 'looking')`);
    expect(uncheckedContent.map((r) => r.publicId).sort()).toEqual([
      `${PREFIX}c-draft-unchecked`,
      `${PREFIX}c-unchecked`,
    ]);
    // ...and the unchecked section it must not reach has welfare rows in it.
    expect(beforeJson.body.unchecked.reportsTotal).toBe(1);
    expect(beforeJson.body.unchecked.draftsTotal).toBe(1);

    const afterJson = await getJson();
    const afterHtml = await getHtml();
    expect(afterJson.text).toBe(beforeJson.text);
    expect(afterHtml).toBe(beforeHtml);
    for (const text of [afterJson.text, afterHtml]) expect(text).not.toContain(`${PREFIX}c-`);
  });

  it("a single content row's public id is not a welfare report", async () => {
    const r = await seedReport({ publicId: `${PREFIX}c-solo`, kind: "content", reason: "other" });
    const { body } = await getJson();
    expect([...body.open, ...body.closed, ...body.unchecked.reports].map((x) => x.id)).not.toContain(r.publicId);
    expect(body.closedTotal).toBe(0);
  });
});

describe("T4-2: the mail-failure banner counts both alert kinds", () => {
  it("a failed issue_alert on an open content row shows the banner and counts as failed", async () => {
    await seedReport({ publicId: `${PREFIX}c-fail`, kind: "content", reason: "other", mail: { state: "failed" } });
    const { body } = await getJson();
    expect(body.mail.failed).toBe(1);
    expect(await getHtml()).toContain('class="banner"');
  });

  it("a failed welfare_alert and a failed issue_alert add up", async () => {
    await seedReport({ publicId: `${PREFIX}w-fail`, mail: { state: "failed" } });
    await seedReport({ publicId: `${PREFIX}c-fail`, kind: "content", reason: "other", mail: { state: "failed" } });
    expect((await getJson()).body.mail.failed).toBe(2);
  });

  it("a failed issue_alert on a closed content row no longer counts (same rule as a welfare alert)", async () => {
    await seedReport({ publicId: `${PREFIX}c-closed`, kind: "content", reason: "other", state: "done", mail: { state: "failed" } });
    expect((await getJson()).body.mail.failed).toBe(0);
    expect(await getHtml()).not.toContain('class="banner"');
  });

  it("a late issue_alert counts as late", async () => {
    await seedReport({ publicId: `${PREFIX}c-late`, kind: "content", reason: "other", mail: { state: "queued", minutesAgo: 90 } });
    expect((await getJson()).body.mail.late).toBe(1);
  });
});

describe("T4-3 (spec test 8): closing a content row writes no welfare_outcome", () => {
  it("closing a content row tied to a cat moves it and writes no observation; closing a welfare row still writes one", async () => {
    const cat = await newCat();
    const content = await seedReport({ publicId: `${PREFIX}c-tied`, kind: "content", reason: "cat_died", catId: cat });
    const welfare = await seedReport({ publicId: `${PREFIX}w-tied`, catId: cat });

    const closeContent = await moveState(content.publicId, "new", "done");
    expect(closeContent.status).toBe(303);
    const row = await reportRow(content.publicId);
    expect(row.state).toBe("done");
    expect(row.stateChangedBy).toBe(susanId);
    const events = await db.select().from(reportStateEventsTable).where(eq(reportStateEventsTable.reportId, content.id));
    expect(events.map((e) => [e.fromState, e.toState])).toEqual([["new", "done"]]);
    expect(await db.select().from(observationsTable).where(eq(observationsTable.catId, cat))).toHaveLength(0);

    // "Nothing needed" and reopening, the other moves, write none either.
    expect((await moveState(content.publicId, "done", "new")).status).toBe(303);
    expect((await moveState(content.publicId, "new", "nothing_needed")).status).toBe(303);
    expect(await db.select().from(observationsTable).where(eq(observationsTable.catId, cat))).toHaveLength(0);

    // A welfare row on the same cat still leaves its mark.
    expect((await moveState(welfare.publicId, "new", "done")).status).toBe(303);
    const marks = await db.select().from(observationsTable).where(eq(observationsTable.catId, cat));
    expect(marks.map((o) => o.kind)).toEqual(["welfare_outcome"]);
    expect(marks[0]!.value).toEqual({ state: "done", reportId: welfare.id });
  });
});

describe("#170 review, finding 4: the JSON routes never answer 200 null for a content row", () => {
  const json = (path: string) =>
    request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie);

  it("state: 404 { error: 'not_found' }, although the move itself happened; a stale move too", async () => {
    const content = await seedReport({ publicId: `${PREFIX}c-json-state`, kind: "content", reason: "other" });
    const moved = await json(`/api/team/reports/${content.publicId}/state`).send({ from: "new", to: "done" });
    expect(moved.status).toBe(404);
    expect(moved.body).toEqual({ error: "not_found" });
    expect((await reportRow(content.publicId)).state).toBe("done");

    const stale = await json(`/api/team/reports/${content.publicId}/state`).send({ from: "new", to: "looking" });
    expect(stale.status).toBe(404);
    expect(stale.body).toEqual({ error: "not_found" });
  });

  it("note: 404 { error: 'not_found' }, although the note was written", async () => {
    const content = await seedReport({ publicId: `${PREFIX}c-json-note`, kind: "content", reason: "other" });
    const res = await json(`/api/team/reports/${content.publicId}/note`).send({ note: "Checked the photo" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect((await reportRow(content.publicId)).teamNote).toBe("Checked the photo");
  });

  it("a welfare row's JSON answers are unchanged", async () => {
    const welfare = await seedReport({ publicId: `${PREFIX}w-json` });
    const moved = await json(`/api/team/reports/${welfare.publicId}/state`).send({ from: "new", to: "looking" });
    expect(moved.status).toBe(200);
    expect(moved.body.id).toBe(welfare.publicId);
    const noted = await json(`/api/team/reports/${welfare.publicId}/note`).send({ note: "On it" });
    expect(noted.status).toBe(200);
    expect(noted.body.teamNote).toBe("On it");
  });
});

describe("T4-4 (spec test 8): a content row can never be tied to a cat", () => {
  it("the function refuses with not_welfare and the route answers 409; nothing is written", async () => {
    const cat = await newCat();
    const content = await seedReport({ publicId: `${PREFIX}c-notie`, kind: "content", reason: "cat_died" });

    const person = { id: susanId, scopes: [{ role: "staff", colonyId: null }] };
    const direct = await tieReportToCat({ person, publicId: content.publicId, catId: cat, expectedCatId: null });
    expect(direct).toEqual({ kind: "not_welfare" });

    const viaForm = await tie(content.publicId, cat, null);
    expect(viaForm.status).toBe(409);
    expect(viaForm.body.error).toBe("not_welfare");
    const viaJson = await request(app)
      .post(`/api/team/reports/${content.publicId}/cat`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: cat, expectedCatId: null });
    expect(viaJson.status).toBe(409);

    expect((await reportRow(content.publicId)).catId).toBeNull();
    expect(await db.select().from(observationsTable).where(eq(observationsTable.catId, cat))).toHaveLength(0);
  });

  it("a content row that already carries a cat can't be re-tied to another", async () => {
    const a = await newCat();
    const b = await newCat();
    const content = await seedReport({ publicId: `${PREFIX}c-retie`, kind: "content", reason: "wrong_cat", catId: a });
    const res = await tie(content.publicId, b, a);
    expect(res.status).toBe(409);
    expect((await reportRow(content.publicId)).catId).toBe(a);
  });

  it("a welfare row is still tied as before", async () => {
    const cat = await newCat();
    const welfare = await seedReport({ publicId: `${PREFIX}w-tie` });
    expect((await tie(welfare.publicId, cat, null)).status).toBe(303);
    expect((await reportRow(welfare.publicId)).catId).toBe(cat);
    const marks = await db.select().from(observationsTable).where(eq(observationsTable.catId, cat));
    expect(marks.map((o) => o.kind)).toEqual(["welfare_report"]);
  });
});
